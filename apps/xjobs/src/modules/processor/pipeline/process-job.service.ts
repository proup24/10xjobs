import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { z } from 'zod';
import {
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from '../config/processor.config';
import {
  ExtractionInvalidError,
  ModelOutputError,
  ModelRequestError,
  TransientModelError,
} from '../models/errors';
import {
  DecisionModel,
  type DecisionAnswer,
  ExtractionModel,
  type DecisionQuestion,
  type ModelCallMeta,
  type PostingInput,
} from '../models/types';
import { promptHash, systemPrompt } from '../prompts/prompt';
import {
  type Claim,
  type FinishOutcome,
  type NewAttempt,
  ProcessorRepository,
  type ReuseKey,
} from '../repositories/processor.repository';
import {
  cityKey,
  VocabRepository,
  type Vocabulary,
} from '../repositories/vocab.repository';
import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractionDocument,
  extractionDocumentSchema,
  type ModelOutput,
  modelOutputJsonSchema,
  modelOutputSchema,
} from '../schema';
import type { ListName } from '../vocab/lists';
import { resolveTerms } from '../vocab/resolve';
import { buildPostingInput, inputHash } from './input';
import { buildDecisionQuestions } from './questions';
import { resolveFacts, selectFallback } from './resolve-facts';
import { deriveTypedColumns } from './typed-columns';
import { checkConsistency, checkQuotes, needsReview } from './validate';

export type ProcessOutcome =
  | 'processed'
  | 'reused'
  | 'closed'
  | 'superseded'
  | 'not_claimed'
  | 'over_budget'
  | 'retry'
  | 'failed';

/** Injectable clock for the budget day; defaults to the system clock. */
export const PROCESSOR_CLOCK = Symbol('PROCESSOR_CLOCK');

type Step = NewAttempt['step'];

/** The extraction output failed twice: the job fails with these errors. */
class ExtractionFailed extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
  }
}

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

/**
 * Processes one normalized job end to end (spec §4): budget, claim, reuse,
 * Jev, Opus with one schema-fix retry, resolution, validation, save, finish.
 * Every model call made is recorded as an attempt, whatever the outcome.
 */
@Injectable()
export class ProcessJobService {
  private readonly logger = new Logger(ProcessJobService.name);
  private readonly now: () => Date;

  constructor(
    private readonly repo: ProcessorRepository,
    private readonly vocab: VocabRepository,
    private readonly decision: DecisionModel,
    private readonly extraction: ExtractionModel,
    @Inject(PROCESSOR_CONFIG) private readonly config: ProcessorConfig,
    @Optional() @Inject(PROCESSOR_CLOCK) now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  /**
   * The budget is checked before each claim against the spend already
   * logged, so jobs in flight at the same time can overshoot the limit by up
   * to `concurrency - 1` jobs.
   */
  async process(jobId: string): Promise<ProcessOutcome> {
    const spent = await this.repo.spendSince(startOfUtcDay(this.now()));
    if (spent >= this.config.dailyBudgetUsd) {
      this.logger.warn(
        `Daily budget reached (${spent.toFixed(2)} of ${this.config.dailyBudgetUsd} USD); not claiming ${jobId}`,
      );
      return 'over_budget';
    }

    const claim = await this.repo.claim(jobId);
    if (!claim) return 'not_claimed';

    const attempts: NewAttempt[] = [];
    try {
      return await this.run(claim, attempts);
    } catch (error) {
      try {
        await this.repo.recordAttempts(attempts);
        return await this.fail(claim, error);
      } catch (cleanup) {
        // Recording the attempts or finishing the claim failed too: the job
        // stays `processing`, and the stale sweep returns it to `pending`.
        this.logger.error(
          `Could not end the claim on ${claim.jobId}; the stale sweep will release it`,
          cleanup instanceof Error ? cleanup.stack : String(cleanup),
        );
        throw cleanup;
      }
    }
  }

  private async run(
    claim: Claim,
    attempts: NewAttempt[],
  ): Promise<ProcessOutcome> {
    const { jobId } = claim;
    const job = await this.repo.loadJob(jobId);
    if (!job)
      return this.end(
        claim,
        { status: 'failed', error: `job ${jobId} not found` },
        'failed',
      );
    if (job.closed)
      return this.end(
        claim,
        { status: 'processed', extractionId: null },
        'closed',
      );

    const input = buildPostingInput(job);
    const vocabulary = await this.vocab.snapshot();
    const questions = buildDecisionQuestions(vocabulary.options);
    const key: ReuseKey = {
      inputHash: inputHash(input),
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptHash: promptHash(questions),
      decisionModel: this.config.decisionModel,
      extractionModel: this.config.extractionModel,
    };

    const reusable = await this.repo.findReusable(key);
    if (reusable) {
      const extractionId =
        reusable.jobId === jobId
          ? reusable.id
          : await this.repo.copyExtraction(reusable.id, jobId);
      return this.end(claim, { status: 'processed', extractionId }, 'reused');
    }

    const decided = await this.decide(jobId, input, questions, attempts);
    const fallback = selectFallback(
      decided.answers,
      questions,
      input.evidence,
      this.config.decisionModel,
    );
    const doc = await this.extractDocument(
      jobId,
      input,
      vocabulary,
      decided,
      fallback,
      attempts,
    );
    const extractionId = await this.repo.saveExtraction({
      ...key,
      ...deriveTypedColumns(doc, vocabulary.regionCountries),
      jobId,
      data: doc,
      needsReview: needsReview(doc),
      costUsd: attempts.reduce((sum, a) => sum + a.costUsd, 0),
    });
    await this.repo.recordAttempts(
      attempts.map((a) => ({ ...a, extractionId })),
    );
    // Recorded: a later failure must not record them a second time.
    attempts.length = 0;
    for (const [list, codes] of usedCodes(doc))
      await this.vocab.bumpOccurrences(list, codes);
    return this.end(claim, { status: 'processed', extractionId }, 'processed');
  }

  /** Jev; malformed or absent answers cost money, never accuracy: Opus gets every question. */
  private async decide(
    jobId: string,
    input: PostingInput,
    questions: DecisionQuestion[],
    attempts: NewAttempt[],
  ): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta | null }> {
    const model = this.config.decisionModel;
    try {
      const { answers, meta } = await this.decision.decide(input, questions);
      attempts.push(attempt(jobId, 'decision', meta, model, 'ok', null));
      return { answers, meta };
    } catch (error) {
      if (error instanceof ModelOutputError) {
        attempts.push(
          attempt(jobId, 'decision', error.meta, model, 'invalid', error),
        );
        return { answers: [], meta: null };
      }
      attempts.push(
        attempt(jobId, 'decision', errorMeta(error), model, 'error', error),
      );
      throw error;
    }
  }

  /**
   * Opus, then the merge and every check after it. Any failure that a better
   * output could fix (schema, unparseable JSON, an unapproved code, the final
   * document shape) takes the one schema-fix retry, with its errors.
   */
  private async extractDocument(
    jobId: string,
    input: PostingInput,
    vocabulary: Vocabulary,
    decided: { answers: DecisionAnswer[]; meta: ModelCallMeta | null },
    fallback: DecisionQuestion[],
    attempts: NewAttempt[],
  ): Promise<ExtractionDocument> {
    const schema = modelOutputSchema(vocabulary.options, fallback);
    const jsonSchema = modelOutputJsonSchema(vocabulary.options, fallback);
    let retryErrors: string[] | undefined;

    for (const step of ['extraction', 'extraction_retry'] as const) {
      const call = await this.callExtraction(
        jobId,
        step,
        input,
        schema,
        jsonSchema,
        retryErrors,
        attempts,
      );
      if ('errors' in call) {
        retryErrors = call.errors;
        continue;
      }
      const last = attempts[attempts.length - 1];
      try {
        const built = await this.buildDocument(
          call.output,
          decided.answers,
          fallback,
          input,
          vocabulary,
        );
        built.doc.models = {
          decision: decided.meta?.model ?? this.config.decisionModel,
          extraction: call.meta.model,
        };
        const doc = this.validDocument(built.doc);
        last.quoteFailures = built.quoteFailures;
        return doc;
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const message = invalidMessage(error);
        last.outcome = 'invalid';
        last.error = message;
        retryErrors = [message];
      }
    }
    throw new ExtractionFailed(retryErrors ?? []);
  }

  /** One Opus call, recorded as an attempt; errors a retry can fix are returned. */
  private async callExtraction(
    jobId: string,
    step: Step,
    input: PostingInput,
    schema: ReturnType<typeof modelOutputSchema>,
    jsonSchema: object,
    retryErrors: string[] | undefined,
    attempts: NewAttempt[],
  ): Promise<
    { output: ModelOutput; meta: ModelCallMeta } | { errors: string[] }
  > {
    const model = this.config.extractionModel;
    try {
      const { output, meta } = await this.extraction.extract(input, {
        systemPrompt: systemPrompt(),
        jsonSchema,
        ...(retryErrors ? { retryErrors } : {}),
      });
      const parsed = schema.safeParse(output);
      if (parsed.success) {
        attempts.push(attempt(jobId, step, meta, model, 'ok', null));
        return { output: parsed.data, meta };
      }
      const errors = zodErrors(parsed.error);
      attempts.push(
        attempt(jobId, step, meta, model, 'invalid', errors.join('; ')),
      );
      return { errors };
    } catch (error) {
      if (!(error instanceof ModelOutputError)) {
        attempts.push(
          attempt(jobId, step, errorMeta(error), model, 'error', error),
        );
        throw error;
      }
      attempts.push(attempt(jobId, step, error.meta, model, 'invalid', error));
      return { errors: [error.message] };
    }
  }

  /** Resolution, quote and consistency checks, terms and cities. */
  private async buildDocument(
    output: ModelOutput,
    answers: DecisionAnswer[],
    fallback: DecisionQuestion[],
    input: PostingInput,
    vocabulary: Vocabulary,
  ): Promise<{ doc: ExtractionDocument; quoteFailures: number }> {
    const resolved = resolveFacts({
      output,
      answers,
      fallback,
      input,
      models: {
        decision: this.config.decisionModel,
        extraction: this.config.extractionModel,
      },
    });
    const quoted = checkQuotes(resolved, input);
    const consistent = checkConsistency(quoted.doc);
    const { doc, proposals, cities } = resolveTerms(
      consistent,
      vocabulary.vocab,
    );
    const cityIds = await this.vocab.upsertCities(cities);
    for (const opening of doc.openings)
      for (const place of opening.places)
        if (place.kind === 'city' && place.countryCode !== null)
          place.cityId =
            cityIds.get(
              cityKey({ name: place.name, countryCode: place.countryCode }),
            ) ?? null;
    await this.vocab.propose(proposals);
    return { doc, quoteFailures: quoted.quoteFailures };
  }

  /** The final shape check; a failure here is a merge bug, reported with its path. */
  private validDocument(doc: ExtractionDocument): ExtractionDocument {
    const parsed = extractionDocumentSchema.safeParse(doc);
    if (parsed.success) return parsed.data;
    const errors = zodErrors(parsed.error);
    throw new ExtractionInvalidError(
      parsed.error.issues[0]?.path.join('.') ?? '',
      errors.join('; '),
    );
  }

  private async fail(claim: Claim, error: unknown): Promise<ProcessOutcome> {
    const message =
      error instanceof ExtractionInvalidError
        ? invalidMessage(error)
        : error instanceof Error
          ? error.message
          : String(error);
    const permanent =
      error instanceof ModelRequestError ||
      error instanceof ExtractionInvalidError ||
      error instanceof ExtractionFailed;
    if (!permanent && claim.attempts < this.config.maxAttempts) {
      if (!(error instanceof TransientModelError))
        this.logger.error(
          `Processing ${claim.jobId} failed unexpectedly; will retry`,
          error instanceof Error ? error.stack : undefined,
        );
      return this.end(claim, { status: 'pending', error: message }, 'retry');
    }
    return this.end(claim, { status: 'failed', error: message }, 'failed');
  }

  private async end(
    claim: Claim,
    outcome: FinishOutcome,
    result: ProcessOutcome,
  ): Promise<ProcessOutcome> {
    const finished = await this.repo.finish(claim, outcome);
    return finished === 'superseded' ? 'superseded' : result;
  }
}

/** `path: message`; the final document check already puts paths in its message. */
function invalidMessage(error: ExtractionInvalidError): string {
  return error.message.startsWith(`${error.path}:`)
    ? error.message
    : `${error.path}: ${error.message}`;
}

function errorMeta(error: unknown): Partial<ModelCallMeta> | undefined {
  return error instanceof TransientModelError ||
    error instanceof ModelRequestError ||
    error instanceof ModelOutputError
    ? error.meta
    : undefined;
}

function attempt(
  jobId: string,
  step: Step,
  meta: Partial<ModelCallMeta> | undefined,
  model: string,
  outcome: NewAttempt['outcome'],
  error: unknown,
): NewAttempt {
  return {
    jobId,
    extractionId: null,
    eval: false,
    step,
    outcome,
    error:
      error === null
        ? null
        : error instanceof Error
          ? error.message
          : String(error),
    quoteFailures: 0,
    model: meta?.model ?? model,
    providerRequestId: meta?.providerRequestId ?? null,
    inputTokens: meta?.inputTokens ?? 0,
    outputTokens: meta?.outputTokens ?? 0,
    cachedInputTokens: meta?.cachedInputTokens ?? 0,
    costUsd: meta?.costUsd ?? 0,
    latencyMs: meta?.latencyMs ?? 0,
  };
}

/** Every approved code the document uses, per list; repeats count each time. */
function usedCodes(doc: ExtractionDocument): [ListName, string[]][] {
  const used: Record<string, string[]> = {};
  const add = (list: ListName, code: string | null | undefined) => {
    if (code) (used[list] ??= []).push(code);
  };
  add('seniorities', doc.seniority.value);
  add('arrangements', doc.arrangement.value);
  add('roleKinds', doc.position.value?.roleKind);
  add('contractTypes', doc.contractType.value);
  add('engagements', doc.engagement.value);
  for (const f of doc.junkFlags.value ?? []) add('junkFlags', f.code);
  for (const o of doc.openings) {
    for (const a of o.arrangements) add('arrangements', a);
    for (const p of o.places) {
      if (p.kind === 'region') add('regions', p.code);
      else if (p.kind === 'country') add('countries', p.code);
      else if (p.kind === 'city') add('countries', p.countryCode);
    }
  }
  const stack = doc.techStack.value;
  if (stack) {
    const terms = [
      ...stack.mainStack.flatMap((g) => g.anyOf),
      ...stack.mustHaves.flatMap((g) => g.anyOf),
      ...stack.niceToHaves,
    ];
    for (const t of terms) add('techTags', t.code);
  }
  return Object.entries(used) as [ListName, string[]][];
}

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
      await this.repo.recordAttempts(attempts);
      return this.fail(claim, error);
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
    const extracted = await this.extract(
      jobId,
      input,
      vocabulary,
      fallback,
      attempts,
    );
    const lastExtraction = attempts[attempts.length - 1];

    let doc: ExtractionDocument;
    let quoteFailures: number;
    try {
      ({ doc, quoteFailures } = await this.buildDocument(
        extracted.output,
        decided.answers,
        fallback,
        input,
        vocabulary,
      ));
    } catch (error) {
      if (error instanceof ExtractionInvalidError) {
        lastExtraction.outcome = 'invalid';
        lastExtraction.error = error.message;
      }
      throw error;
    }
    lastExtraction.quoteFailures = quoteFailures;
    doc.models = {
      decision: decided.meta?.model ?? this.config.decisionModel,
      extraction: extracted.meta.model,
    };
    doc = this.validDocument(doc);

    const extractionId = await this.repo.saveExtraction({
      ...key,
      ...deriveTypedColumns(doc, vocabulary.regionCountries),
      jobId,
      data: doc,
      needsReview: needsReview(doc),
      costUsd: attempts.reduce((sum, a) => sum + a.costUsd, 0),
    });
    await this.repo.recordAttempts(
      attempts.splice(0).map((a) => ({ ...a, extractionId })),
    );
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

  /** Opus, with one schema-fix retry carrying the validation errors. */
  private async extract(
    jobId: string,
    input: PostingInput,
    vocabulary: Vocabulary,
    fallback: DecisionQuestion[],
    attempts: NewAttempt[],
  ): Promise<{ output: ModelOutput; meta: ModelCallMeta }> {
    const schema = modelOutputSchema(vocabulary.options, fallback);
    const jsonSchema = modelOutputJsonSchema(vocabulary.options, fallback);
    const model = this.config.extractionModel;
    let retryErrors: string[] | undefined;

    for (const step of ['extraction', 'extraction_retry'] as const) {
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
        retryErrors = zodErrors(parsed.error);
        attempts.push(
          attempt(jobId, step, meta, model, 'invalid', retryErrors.join('; ')),
        );
      } catch (error) {
        if (!(error instanceof ModelOutputError)) {
          attempts.push(
            attempt(jobId, step, errorMeta(error), model, 'error', error),
          );
          throw error;
        }
        retryErrors = [error.message];
        attempts.push(
          attempt(jobId, step, error.meta, model, 'invalid', error),
        );
      }
    }
    throw new ExtractionFailed(retryErrors ?? []);
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
            cityIds.get(`${place.name}|${place.countryCode}`) ?? null;
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
      error instanceof ExtractionInvalidError &&
      !error.message.includes(error.path)
        ? `${error.path}: ${error.message}`
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

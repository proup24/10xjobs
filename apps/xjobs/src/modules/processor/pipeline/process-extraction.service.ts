import type { z } from 'zod';
import type { ProcessorConfig } from '../config/processor.config';
import {
  ExtractionInvalidError,
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
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
import { systemPrompt } from '../prompts/prompt';
import type { NewAttempt } from '../repositories/processor.repository';
import {
  cityKey,
  VocabRepository,
  type Vocabulary,
} from '../repositories/vocab.repository';
import {
  type ExtractionDocument,
  extractionDocumentSchema,
  type ModelOutput,
  modelOutputJsonSchema,
  modelOutputSchema,
} from '../schema';
import { resolveTerms } from '../vocab/resolve';
import { buildDecisionQuestions } from './questions';
import { resolveFacts, selectFallback } from './resolve-facts';
import { checkConsistency, checkQuotes } from './validate';

type Step = NewAttempt['step'];

/** The extraction output failed twice: the job fails with these errors. */
export class ExtractionFailed extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
  }
}

/** Owns model calls, extraction retries, validation, and vocabulary resolution. */
export class ProcessExtractionService {
  constructor(
    private readonly vocab: VocabRepository,
    private readonly decision: DecisionModel,
    private readonly extraction: ExtractionModel,
    private readonly config: ProcessorConfig,
  ) {}

  async extract(
    jobId: string,
    input: PostingInput,
    vocabulary: Vocabulary,
    attempts: NewAttempt[],
  ): Promise<ExtractionDocument> {
    const questions = buildDecisionQuestions(vocabulary.options);
    const decided = await this.decide(jobId, input, questions, attempts);
    const fallback = selectFallback(
      decided.answers,
      questions,
      input.evidence,
      this.config.decisionModel,
    );
    return this.extractDocument(
      jobId,
      input,
      vocabulary,
      decided,
      fallback,
      attempts,
    );
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
}

/** `path: message`; the final document check already puts paths in its message. */
export function invalidMessage(error: ExtractionInvalidError): string {
  return error.message.startsWith(`${error.path}:`)
    ? error.message
    : `${error.path}: ${error.message}`;
}

function errorMeta(error: unknown): Partial<ModelCallMeta> | undefined {
  return error instanceof TransientModelError ||
    error instanceof ModelRequestError ||
    error instanceof ProviderUnavailableError ||
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

const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

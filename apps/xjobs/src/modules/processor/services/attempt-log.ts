import {
  ModelOutputError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import type { ModelCallMeta } from '../models/types';
import type { NewAttempt } from '../repositories/processor.repository';

export type AttemptStep = NewAttempt['step'];

/**
 * Every model call of one run, in order, as `processing_attempts` rows. The
 * services append to it as they call models; the processor writes it once,
 * whatever the run's outcome, so every paid call is counted exactly once.
 */
export class AttemptLog {
  private readonly rows: NewAttempt[] = [];

  /** `jobId` null for a preview, which is not tied to a normalized job. */
  constructor(private readonly jobId: string | null) {}

  ok(step: AttemptStep, model: string, meta: ModelCallMeta): void {
    this.push(step, model, meta, 'ok', null);
  }

  /** The call answered, but its output was unusable. */
  invalid(
    step: AttemptStep,
    model: string,
    meta: Partial<ModelCallMeta> | undefined,
    error: string,
  ): void {
    this.push(step, model, meta, 'invalid', error);
  }

  /** The call failed; the provider's cost, if any, is still counted. */
  failed(step: AttemptStep, model: string, error: unknown): void {
    this.push(step, model, metaOf(error), 'error', messageOf(error));
  }

  /** The last call answered, but the document built from it was invalid. */
  markLastInvalid(error: string): void {
    const last = this.rows.at(-1);
    if (last) Object.assign(last, { outcome: 'invalid', error });
  }

  setLastQuoteFailures(count: number): void {
    const last = this.rows.at(-1);
    if (last) last.quoteFailures = count;
  }

  get costUsd(): number {
    return this.rows.reduce((sum, row) => sum + row.costUsd, 0);
  }

  /** The rows to write, tied to the saved extraction when there is one. */
  entries(extractionId: string | null = null): NewAttempt[] {
    return this.rows.map((row) => ({ ...row, extractionId }));
  }

  private push(
    step: AttemptStep,
    model: string,
    meta: Partial<ModelCallMeta> | undefined,
    outcome: NewAttempt['outcome'],
    error: string | null,
  ): void {
    this.rows.push({
      jobId: this.jobId,
      extractionId: null,
      eval: false,
      step,
      outcome,
      error,
      quoteFailures: 0,
      model: meta?.model ?? model,
      providerRequestId: meta?.providerRequestId ?? null,
      inputTokens: meta?.inputTokens ?? 0,
      outputTokens: meta?.outputTokens ?? 0,
      cachedInputTokens: meta?.cachedInputTokens ?? 0,
      costUsd: meta?.costUsd ?? 0,
      latencyMs: meta?.latencyMs ?? 0,
    });
  }
}

function metaOf(error: unknown): Partial<ModelCallMeta> | undefined {
  return error instanceof TransientModelError ||
    error instanceof ModelRequestError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ModelOutputError
    ? error.meta
    : undefined;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

import {
  ExtractionInvalidError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import type { FinishOutcome } from '../repositories/processor.repository';
import { ExtractionFailed } from './extraction-pipeline.service';
import { invalidMessage } from './fact-assembler.service';

export type FailureOutcome = 'retry' | 'failed' | 'provider_unavailable';

/** What a failed run does to its job. */
export interface FailureDecision {
  finish: FinishOutcome;
  outcome: FailureOutcome;
  /** An unexpected error (a bug or an outage), worth a stack trace in the logs. */
  unexpected: boolean;
}

/**
 * The one place that decides what an error means for the job:
 *
 * | Error                                        | Job                         |
 * | -------------------------------------------- | --------------------------- |
 * | ProviderUnavailableError (401/402/403)        | pending, attempt given back |
 * | ModelRequestError, ExtractionInvalidError,    | failed                      |
 * |   ExtractionFailed (first generation invalid) |                             |
 * | TransientModelError, anything else            | pending until maxAttempts,  |
 * |                                              |   then failed               |
 */
export function decideFailure(
  error: unknown,
  attempts: number,
  maxAttempts: number,
): FailureDecision {
  const message = describe(error);
  if (error instanceof ProviderUnavailableError)
    return {
      finish: { status: 'pending', error: message, refundAttempt: true },
      outcome: 'provider_unavailable',
      unexpected: false,
    };
  const permanent =
    error instanceof ModelRequestError ||
    error instanceof ExtractionInvalidError ||
    error instanceof ExtractionFailed;
  if (!permanent && attempts < maxAttempts)
    return {
      finish: { status: 'pending', error: message },
      outcome: 'retry',
      unexpected: !(error instanceof TransientModelError),
    };
  return {
    finish: { status: 'failed', error: message },
    outcome: 'failed',
    unexpected: !permanent && !(error instanceof TransientModelError),
  };
}

function describe(error: unknown): string {
  if (error instanceof ExtractionInvalidError) return invalidMessage(error);
  return error instanceof Error ? error.message : String(error);
}

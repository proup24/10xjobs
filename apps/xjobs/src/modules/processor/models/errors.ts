import type { LimitObservation } from './claude/stream';
import type { ModelCallMeta } from './types';

/** The merged extraction cannot be saved: a code is not approved or the shape is wrong. */
export class ExtractionInvalidError extends Error {
  constructor(
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `invalid extraction at ${path}`);
    this.name = 'ExtractionInvalidError';
  }
}

/** Network, 408, 429, 5xx, an error body with a 200, or empty `choices`. Retried. */
export class TransientModelError extends Error {
  constructor(
    message: string,
    readonly meta?: Partial<ModelCallMeta>,
  ) {
    super(message);
    this.name = 'TransientModelError';
  }
}

/**
 * 401, 402 or 403 (also as a 200 error body): the key, credit or account is
 * the problem, not the job. The job goes back to `pending` without using an
 * attempt, and this process pauses claiming.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly meta?: Partial<ModelCallMeta>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

/** Claude refused the credential (expired or revoked token, bad key). */
export class ClaudeAuthError extends ProviderUnavailableError {
  constructor(meta?: Partial<ModelCallMeta>) {
    super('claude authentication failed', meta);
    this.name = 'ClaudeAuthError';
  }
}

/** Any other 4xx: the request itself is wrong. Not retried. */
export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly meta?: Partial<ModelCallMeta>,
  ) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

/**
 * Unparseable JSON, output the schema rejects, or a call that ran out of
 * turns. Goes to the schema-fix retry, which sends back `retryErrors` when
 * set (empty: no feedback), otherwise the message.
 */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly meta?: Partial<ModelCallMeta>,
    readonly retryErrors?: string[],
  ) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

/** The Claude subscription's usage limit is reached: pause until `limit.resetsAt`. */
export class UsageLimitError extends Error {
  constructor(
    message: string,
    readonly limit: LimitObservation | null,
    readonly meta?: Partial<ModelCallMeta>,
  ) {
    super(message);
    this.name = 'UsageLimitError';
  }
}

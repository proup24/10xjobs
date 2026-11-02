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

/** Unparseable JSON or `finish_reason: 'length'`. Goes to the schema-fix retry. */
export class ModelOutputError extends Error {
  constructor(
    message: string,
    readonly meta?: Partial<ModelCallMeta>,
  ) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

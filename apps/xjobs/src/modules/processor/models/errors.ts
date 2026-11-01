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

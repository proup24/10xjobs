/**
 * A collector failed before it could start any paid run (for example a
 * LinkedIn place with no geoId): nothing was or could be charged, so the run
 * counts nothing toward the daily spend.
 */
export class SearchNotStartedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SearchNotStartedError';
  }
}

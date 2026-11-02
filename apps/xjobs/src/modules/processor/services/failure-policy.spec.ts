import {
  ExtractionInvalidError,
  ModelRequestError,
  ProviderUnavailableError,
  TransientModelError,
} from '../models/errors';
import { ExtractionFailed } from './extraction-pipeline.service';
import { decideFailure } from './failure-policy';

describe('decideFailure', () => {
  it('gives the attempt back and keeps the job pending when the provider refuses the key', () => {
    expect(decideFailure(new ProviderUnavailableError('401'), 3, 3)).toEqual({
      finish: { status: 'pending', error: '401', refundAttempt: true },
      outcome: 'provider_unavailable',
      unexpected: false,
    });
  });

  it.each([
    ['a request error', new ModelRequestError('400')],
    ['an invalid code', new ExtractionInvalidError('seniority', 'unknown')],
    ['output invalid twice', new ExtractionFailed(['a: b'])],
  ])('fails the job at once on %s', (_, error) => {
    const decision = decideFailure(error, 1, 3);
    expect(decision.outcome).toBe('failed');
    expect(decision.finish.status).toBe('failed');
    expect(decision.unexpected).toBe(false);
  });

  it('retries a transient error until the last attempt', () => {
    const error = new TransientModelError('503');
    expect(decideFailure(error, 2, 3)).toMatchObject({
      outcome: 'retry',
      finish: { status: 'pending', error: '503' },
      unexpected: false,
    });
    expect(decideFailure(error, 3, 3).outcome).toBe('failed');
  });

  it('retries an unexpected error too, but flags it for the logs', () => {
    expect(decideFailure(new Error('db down'), 1, 3)).toMatchObject({
      outcome: 'retry',
      unexpected: true,
    });
  });

  it('reports an invalid code with its path', () => {
    const decision = decideFailure(
      new ExtractionInvalidError('openings.0.places.0.code', 'unknown region'),
      1,
      3,
    );
    expect(decision.finish).toEqual({
      status: 'failed',
      error: 'openings.0.places.0.code: unknown region',
    });
  });
});

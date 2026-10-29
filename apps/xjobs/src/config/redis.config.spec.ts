import { ConfigService } from '@nestjs/config';
import { getRedisConfig, validateWorkerEnvironment } from './index';

describe('Redis configuration', () => {
  it('boots a standalone worker without API credentials', () => {
    expect(validateWorkerEnvironment({})).toMatchObject({
      REDIS_URL: 'redis://127.0.0.1:6379',
      REDIS_CACHE_URL: 'redis://127.0.0.1:6380',
      JOBS_CONCURRENCY: 5,
    });
  });

  it.each([
    { REDIS_URL: 'https://localhost' },
    { REDIS_CACHE_URL: 'garbage' },
    { REDIS_PREFIX: 'bad:prefix' },
    { CACHE_TTL_SECONDS: 0 },
    { JOBS_CONCURRENCY: -1 },
    { REDIS_COMMAND_TIMEOUT_MS: 0 },
  ])('rejects invalid settings: %j', (input) => {
    expect(() => validateWorkerEnvironment(input)).toThrow();
  });

  it('accepts authenticated TLS connections', () => {
    expect(
      validateWorkerEnvironment({
        REDIS_URL: 'rediss://u:p@example.com:6380/2',
      }).REDIS_URL,
    ).toBe('rediss://u:p@example.com:6380/2');
  });
});

describe('Redis config accessor', () => {
  it('uses validated ConfigService values for API and worker consumers', () => {
    const env = validateWorkerEnvironment({
      REDIS_URL: 'redis://example.com:6390',
      JOBS_CONCURRENCY: '8',
    });
    expect(getRedisConfig(new ConfigService(env))).toMatchObject({
      url: 'redis://example.com:6390',
      jobsConcurrency: 8,
      cacheTtlSeconds: 300,
    });
  });
});

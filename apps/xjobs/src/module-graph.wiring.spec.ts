import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

/**
 * Resolves the API's and the worker's whole Nest dependency graph, as the built
 * engine does at startup, without creating a single provider (preview mode): a
 * provider whose module does not see one of its dependencies fails here, not
 * only when the engine boots. Runs in the `wiring` vitest project, whose
 * transform emits the decorator metadata Nest reads.
 */
const dummyEnvironment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/none',
  REDIS_URL: 'redis://127.0.0.1:1',
  REDIS_CACHE_URL: 'redis://127.0.0.1:1',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy',
  ENGINE_API_KEY: 'dummy-engine-key-000000000000000000',
  XJOBS_OPERATOR_ENDPOINTS: '1',
};

describe('Nest module graph', () => {
  beforeAll(() => {
    vi.stubEnv('XJOBS_SKIP_ENV_FILES', '1');
    for (const [key, value] of Object.entries(dummyEnvironment))
      vi.stubEnv(key, value);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('resolves every API provider', async () => {
    const { AppModule } = await import('src/app');
    const app = await NestFactory.create(AppModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });
    await app.close();
  });

  it('resolves every worker provider', async () => {
    const { WorkerModule } = await import(
      'src/infrastructure/worker/worker.module'
    );
    const app = await NestFactory.createApplicationContext(WorkerModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });
    await app.close();
  });
});

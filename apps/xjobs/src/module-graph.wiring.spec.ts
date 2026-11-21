import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app';
import { WorkerModule } from 'src/infrastructure/worker/worker.module';

/**
 * Resolves the API's and the worker's whole Nest dependency graph, as the built
 * engine does at startup, without creating a single provider (preview mode): a
 * provider whose module does not see one of its dependencies fails here, not
 * only when the engine boots. Runs in the `wiring` vitest project, whose
 * transform emits the decorator metadata Nest reads and whose `env` holds the
 * dummy variables the modules validate when imported.
 */
describe('Nest module graph', () => {
  it('resolves every API provider', async () => {
    const app = await NestFactory.create(AppModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });
    await app.close();
  });

  it('resolves every worker provider', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, {
      preview: true,
      abortOnError: false,
      logger: false,
    });
    await app.close();
  });
});

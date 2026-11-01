import './environment';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './infrastructure/worker/worker.module';
import { WorkerService } from './infrastructure/worker/worker.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  if (!app.get(WorkerService).active) {
    // A disabled channel has removed its scheduler and has nothing to run.
    await app.close();
    process.exit(0);
  }
}

void bootstrap().catch((error: unknown) => {
  // Only env validation messages are printed: connection errors can carry credentials.
  const invalidEnvironment =
    error instanceof Error &&
    error.message.startsWith('Invalid environment variables');
  Logger.error(
    invalidEnvironment
      ? error.message
      : 'Worker startup failed; check Redis, database and Apify configuration',
    undefined,
    'Worker',
  );
  process.exit(1);
});

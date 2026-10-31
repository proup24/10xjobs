import './environment';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './infrastructure/jobs/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

void bootstrap().catch(() => {
  Logger.error(
    'Worker startup failed; check Redis configuration and availability',
    undefined,
    'Worker',
  );
  process.exit(1);
});

import './environment';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Channel } from './common/enums';
import { workerChannelSchema } from './config';
import {
  COLLECTION_JOBS,
  CollectionWorkerModule,
} from './infrastructure/jobs/collection';
import { WorkerModule } from './infrastructure/jobs/worker.module';

/**
 * `WORKER_CHANNEL` unset: the infrastructure worker. Set to a channel: that
 * channel's own collection job, alone in this process.
 */
async function bootstrap(channel: Channel | undefined) {
  if (!channel) {
    const app = await NestFactory.createApplicationContext(WorkerModule);
    app.enableShutdownHooks();
    return;
  }
  const app = await NestFactory.createApplicationContext(
    CollectionWorkerModule,
  );
  app.enableShutdownHooks();
  if (!(await app.get(COLLECTION_JOBS[channel]).start())) {
    // A disabled channel has removed its scheduler and has nothing to run.
    await app.close();
    process.exit(0);
  }
}

const parsed = workerChannelSchema.safeParse(
  process.env.WORKER_CHANNEL || undefined,
);
if (!parsed.success) {
  Logger.error(
    `Invalid WORKER_CHANNEL "${process.env.WORKER_CHANNEL}"; expected one of the Channel values`,
    undefined,
    'Worker',
  );
  process.exit(1);
}
const channel = parsed.data;

void bootstrap(channel).catch(() => {
  Logger.error(
    `${channel ?? 'Infrastructure'} worker startup failed; check Redis, database and Apify configuration`,
    undefined,
    'Worker',
  );
  process.exit(1);
});

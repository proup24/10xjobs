import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type {
  RedisConfig,
  WorkerProcessEnvironmentVariables,
} from 'src/config';
import {
  AshbyCollectionJob,
  COLLECT_JOB,
  type CollectionJob,
  GreenhouseCollectionJob,
  LinkedinJobBoardCollectionJob,
  LinkedinPostsCollectionJob,
} from 'src/infrastructure/jobs/collection';
import { INFRASTRUCTURE_QUEUE } from 'src/infrastructure/jobs/jobs.service';
import { processInfrastructureJob } from 'src/infrastructure/jobs/processor';
import { REDIS_SETTINGS } from 'src/infrastructure/redis/settings.module';
import { syncCollectionScheduler } from './scheduler';

const STARTUP_TIMEOUT_MS = 15000;

/**
 * Runs the infrastructure queue, or, when `WORKER_CHANNEL` names a channel,
 * that channel's collection job on its own queue and cron schedule.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly job?: CollectionJob;
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  /** False once the channel turned out to be disabled; the process should exit. */
  active = true;

  constructor(
    @Inject(REDIS_SETTINGS) private readonly settings: RedisConfig,
    config: ConfigService<WorkerProcessEnvironmentVariables, true>,
    ashby: AshbyCollectionJob,
    greenhouse: GreenhouseCollectionJob,
    linkedinJobBoard: LinkedinJobBoardCollectionJob,
    linkedinPosts: LinkedinPostsCollectionJob,
  ) {
    const channel = config.get('WORKER_CHANNEL', { infer: true });
    this.job = [ashby, greenhouse, linkedinJobBoard, linkedinPosts].find(
      (job) => job.channel === channel,
    );
  }

  async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.settings.url, {
      // Blocking workers must retry indefinitely; never use producer timeouts here.
      maxRetriesPerRequest: null,
      connectTimeout: this.settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Worker Redis connection unavailable'),
    );
    if (this.job) await this.startCollection(this.job, this.connection);
    else this.startInfrastructure(this.connection);
    if (this.worker) {
      this.worker.on('error', () =>
        this.logger.error('Worker Redis operation failed'),
      );
      this.worker.on('failed', (job, error) =>
        this.logger.warn(
          `Job ${job?.id ?? 'unknown'} failed: ${error.message}`,
        ),
      );
      await withTimeout(this.worker.waitUntilReady());
      this.logger.log(`Worker ready on ${this.worker.name}`);
    }
  }

  private startInfrastructure(connection: Redis): void {
    this.worker = new Worker(INFRASTRUCTURE_QUEUE, processInfrastructureJob, {
      connection,
      prefix: this.settings.prefix,
      concurrency: this.settings.jobsConcurrency,
    });
  }

  private async startCollection(
    job: CollectionJob,
    connection: Redis,
  ): Promise<void> {
    this.queue = new Queue(job.queueName, {
      connection,
      prefix: this.settings.prefix,
    });
    this.queue.on('error', () => this.logger.warn('Queue operation failed'));
    await withTimeout(this.queue.waitUntilReady());
    if ((await syncCollectionScheduler(this.queue, job.config)) === 'removed') {
      this.active = false;
      this.logger.log(`${job.channel} disabled; scheduler removed`);
      return;
    }
    this.worker = new Worker(
      job.queueName,
      async (bullJob) => {
        if (bullJob.name !== COLLECT_JOB)
          throw new UnrecoverableError(`Unsupported job: ${bullJob.name}`);
        return job.run();
      },
      {
        connection,
        prefix: this.settings.prefix,
        concurrency: job.config.concurrency,
      },
    );
    this.logger.log(
      `Collecting ${job.channel} on ${job.config.schedule.pattern} ${job.config.schedule.timezone}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    // Stop accepting jobs and await active handlers before releasing Redis.
    try {
      await this.worker?.close();
      await this.queue?.close();
    } finally {
      this.connection?.disconnect();
    }
    this.logger.log('Worker stopped');
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Worker Redis startup timed out')),
          STARTUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

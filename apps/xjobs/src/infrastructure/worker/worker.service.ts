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
import { Channel } from 'src/common/enums';
import {
  COLLECT_JOB,
  CollectionService,
  channelJobsConfig,
} from 'src/infrastructure/jobs/steps/collect';
import {
  INGEST_QUEUE,
  IngestQueue,
  ingestWorkerConfig,
  processIngestJob,
} from 'src/infrastructure/jobs/steps/ingest';
import { INFRASTRUCTURE_QUEUE } from 'src/infrastructure/jobs/jobs.service';
import { processInfrastructureJob } from 'src/infrastructure/jobs/processor';
import { REDIS_SETTINGS } from 'src/infrastructure/redis/settings.module';
import {
  BatchIngestService,
  RawStorageRepository,
  ingestConfig,
} from 'src/modules/ingest';
import { StorageService } from 'src/modules/storage';
import { syncCollectionScheduler, syncSweepScheduler } from './scheduler';

const STARTUP_TIMEOUT_MS = 15000;

/**
 * Runs one of: the ingest queue (`WORKER_ROLE=ingest`), a channel's collection
 * job on its own queue and cron schedule (`WORKER_CHANNEL`), or else the
 * infrastructure queue.
 */
@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly channel?: Channel;
  private readonly role?: 'ingest';
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  /** False once the channel turned out to be disabled; the process should exit. */
  active = true;

  constructor(
    @Inject(REDIS_SETTINGS) private readonly settings: RedisConfig,
    config: ConfigService<WorkerProcessEnvironmentVariables, true>,
    private readonly collection: CollectionService,
    private readonly storage: StorageService,
    private readonly ingest: BatchIngestService,
    private readonly rawStorage: RawStorageRepository,
    private readonly ingestQueue: IngestQueue,
  ) {
    this.role = config.get('WORKER_ROLE', { infer: true });
    this.channel = config.get('WORKER_CHANNEL', { infer: true });
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
    if (this.role === 'ingest') await this.startIngest(this.connection);
    else if (this.channel)
      await this.startCollection(this.channel, this.connection);
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

  private async startIngest(connection: Redis): Promise<void> {
    await this.storage.ensureBucket(ingestConfig.bucket);
    this.queue = new Queue(INGEST_QUEUE, {
      connection,
      prefix: this.settings.prefix,
    });
    this.queue.on('error', () => this.logger.warn('Queue operation failed'));
    await withTimeout(this.queue.waitUntilReady());
    await syncSweepScheduler(this.queue);
    this.worker = new Worker(
      INGEST_QUEUE,
      (bullJob) =>
        processIngestJob(bullJob, {
          ingest: this.ingest,
          repo: this.rawStorage,
          queue: this.ingestQueue,
        }),
      {
        connection,
        prefix: this.settings.prefix,
        concurrency: ingestWorkerConfig.concurrency,
      },
    );
    this.logger.log(
      `Ingesting collection batches; sweeping every ${ingestConfig.sweepEveryMs / 1000}s`,
    );
  }

  private async startCollection(
    channel: Channel,
    connection: Redis,
  ): Promise<void> {
    await this.storage.ensureBucket(ingestConfig.bucket);
    const config = channelJobsConfig[channel];
    this.queue = new Queue(config.queueName, {
      connection,
      prefix: this.settings.prefix,
    });
    this.queue.on('error', () => this.logger.warn('Queue operation failed'));
    await withTimeout(this.queue.waitUntilReady());
    if ((await syncCollectionScheduler(this.queue, config)) === 'removed') {
      this.active = false;
      this.logger.log(`${channel} disabled; scheduler removed`);
      return;
    }
    this.worker = new Worker(
      config.queueName,
      async (bullJob) => {
        if (bullJob.name !== COLLECT_JOB)
          throw new UnrecoverableError(`Unsupported job: ${bullJob.name}`);
        return this.collection.collect(channel);
      },
      {
        connection,
        prefix: this.settings.prefix,
        concurrency: config.concurrency,
      },
    );
    this.logger.log(
      `Collecting ${channel} on ${config.schedule.pattern} ${config.schedule.timezone}`,
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

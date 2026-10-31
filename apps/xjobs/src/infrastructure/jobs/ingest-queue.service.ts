import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { RedisConfig } from '../../config';
import { REDIS_SETTINGS } from '../redis/settings.module';

/** Queue the ingest worker consumes. */
export const INGEST_QUEUE = 'ingest';
/** Ingest one stored collection batch: `{ batchId }`. */
export const INGEST_BATCH_JOB = 'ingest-batch';
/** Re-enqueue pending batches nothing picked up. */
export const SWEEP_JOB = 'sweep';

/** Attempts per batch before ingest marks it failed. */
export const INGEST_ATTEMPTS = 5;

/**
 * Hands stored batches to the ingest worker. The batch row is the source of
 * truth; this message only nudges, and the sweeper covers a lost one.
 */
@Injectable()
export class IngestQueue implements OnApplicationShutdown {
  readonly queue: Queue;
  private readonly connection: Redis;
  private readonly logger = new Logger(IngestQueue.name);

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    this.connection = new Redis(settings.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: settings.commandTimeoutMs,
      commandTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Ingest queue Redis connection unavailable'),
    );
    this.queue = new Queue(INGEST_QUEUE, {
      connection: this.connection,
      prefix: settings.prefix,
      defaultJobOptions: {
        attempts: INGEST_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
    this.queue.on('error', () =>
      this.logger.warn('Ingest queue operation failed'),
    );
  }

  /** The job id is the batch id, so a batch is never queued twice at once. */
  async enqueue(batchId: string): Promise<void> {
    await this.queue.add(INGEST_BATCH_JOB, { batchId }, { jobId: batchId });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      this.connection.disconnect();
    }
  }
}

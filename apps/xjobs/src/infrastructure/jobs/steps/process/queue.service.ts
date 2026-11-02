import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { RedisConfig } from '../../../../config';
import { PROCESSOR_CONFIG, type ProcessorConfig } from 'src/modules/processor';
import { REDIS_SETTINGS } from '../../../redis/settings.module';

/** Queue the processor worker consumes. */
export const PROCESS_QUEUE = 'process';
/** Process one normalized job: `{ jobId }`. */
export const PROCESS_JOB = 'process-job';
/** Release stale claims and re-enqueue pending jobs nothing picked up. */
export const PROCESS_SWEEP_JOB = 'sweep';

/**
 * Hands normalized jobs to the processor worker. The job row is the source of
 * truth; this message only nudges, and the sweeper covers a lost one.
 */
@Injectable()
export class ProcessQueue implements OnApplicationShutdown {
  readonly queue: Queue;
  private readonly connection: Redis;
  private readonly logger = new Logger(ProcessQueue.name);

  constructor(
    @Inject(REDIS_SETTINGS) settings: RedisConfig,
    @Inject(PROCESSOR_CONFIG) config: ProcessorConfig,
  ) {
    this.connection = new Redis(settings.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: settings.commandTimeoutMs,
      commandTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Process queue Redis connection unavailable'),
    );
    this.queue = new Queue(PROCESS_QUEUE, {
      connection: this.connection,
      prefix: settings.prefix,
      defaultJobOptions: {
        attempts: config.maxAttempts,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 86_400 },
        removeOnFail: { age: 604_800 },
      },
    });
    this.queue.on('error', () =>
      this.logger.warn('Process queue operation failed'),
    );
  }

  /** The BullMQ job id is the job id, so a job is never queued twice at once. */
  async enqueue(jobId: string): Promise<void> {
    await this.queue.add(PROCESS_JOB, { jobId }, { jobId });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      this.connection.disconnect();
    }
  }
}

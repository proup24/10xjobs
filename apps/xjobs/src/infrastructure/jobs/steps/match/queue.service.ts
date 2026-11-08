import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { RedisConfig } from '../../../../config';
import { REDIS_SETTINGS } from '../../../redis/settings.module';

/** Queue the match worker consumes. */
export const MATCH_QUEUE = 'match';
/** Match one processed job against the published profiles: `{ jobId, force? }`. */
export const MATCH_JOB = 'match-job';
/** Delete matches of inactive jobs and re-enqueue jobs with stale matches. */
export const MATCH_SWEEP_JOB = 'sweep';

/**
 * Hands processed jobs to the match worker. The job row is the truth; this
 * message only nudges, and the sweeper covers a lost one.
 */
@Injectable()
export class MatchQueue implements OnApplicationShutdown {
  readonly queue: Queue;
  private readonly connection: Redis;
  private readonly logger = new Logger(MatchQueue.name);

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    this.connection = new Redis(settings.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: settings.commandTimeoutMs,
      commandTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Match queue Redis connection unavailable'),
    );
    this.queue = new Queue(MATCH_QUEUE, {
      connection: this.connection,
      prefix: settings.prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.queue.on('error', () =>
      this.logger.warn('Match queue operation failed'),
    );
  }

  /**
   * The BullMQ job id is the job id, so a job is never queued twice at once;
   * a finished one is removed, so the same id can be queued again.
   */
  async enqueue(jobId: string, opts?: { force?: boolean }): Promise<void> {
    await this.queue.add(
      MATCH_JOB,
      { jobId, force: opts?.force },
      { jobId, removeOnComplete: true, removeOnFail: true },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      this.connection.disconnect();
    }
  }
}

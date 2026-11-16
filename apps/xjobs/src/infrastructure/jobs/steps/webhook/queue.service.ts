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
import type { WebhookEnqueuer } from '../match/processor';

/** Queue the webhook worker consumes. */
export const WEBHOOK_QUEUE = 'webhook';
/** Send one delivery: `{ deliveryId }`. */
export const WEBHOOK_SEND_JOB = 'send';
/** Return stuck rows, apply retention and re-enqueue due rows. */
export const WEBHOOK_SWEEP_JOB = 'sweep';

/**
 * Hands deliveries to the webhook worker. The delivery row is the truth (status, attempts,
 * next attempt); this message only nudges, and the sweeper covers a lost one.
 */
@Injectable()
export class WebhookQueue implements OnApplicationShutdown, WebhookEnqueuer {
  readonly queue: Queue;
  private readonly connection: Redis;
  private readonly logger = new Logger(WebhookQueue.name);

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    this.connection = new Redis(settings.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: settings.commandTimeoutMs,
      commandTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Webhook queue Redis connection unavailable'),
    );
    this.queue = new Queue(WEBHOOK_QUEUE, {
      connection: this.connection,
      prefix: settings.prefix,
      defaultJobOptions: {
        // The retries are ours and live in the row: one BullMQ attempt.
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.queue.on('error', () =>
      this.logger.warn('Webhook queue operation failed'),
    );
  }

  /**
   * The BullMQ job id is the delivery id, so a delivery is never queued twice at once; a
   * finished one is removed, so the sweeper can queue it again for its next attempt.
   */
  async enqueue(deliveryId: string): Promise<void> {
    await this.queue.add(
      WEBHOOK_SEND_JOB,
      { deliveryId },
      { jobId: deliveryId, removeOnComplete: true, removeOnFail: true },
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

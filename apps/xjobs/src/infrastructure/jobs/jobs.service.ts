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

export const INFRASTRUCTURE_QUEUE = 'infrastructure';

@Injectable()
export class JobsService implements OnApplicationShutdown {
  readonly queue: Queue;
  private readonly connection: Redis;
  private readonly logger = new Logger(JobsService.name);

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    this.connection = new Redis(settings.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: settings.commandTimeoutMs,
      commandTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Queue Redis connection unavailable'),
    );
    this.queue = new Queue(INFRASTRUCTURE_QUEUE, {
      connection: this.connection,
      prefix: settings.prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
    this.queue.on('error', () => this.logger.warn('Queue operation failed'));
  }

  async enqueuePing(token: string) {
    if (!token || token.length > 200)
      throw new Error('Ping token must contain 1–200 characters');
    // BullMQ waits for initial readiness before sending commands, outside the
    // ioredis command timeout. Refuse now rather than enqueue later unexpectedly.
    if (this.connection.status !== 'ready')
      throw new Error('Queue Redis is not ready');
    return this.queue.add('ping', { token });
  }

  /** Round-trips PING on the queue connection; rejects at once while it is not ready. */
  async ping(): Promise<void> {
    await this.connection.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.queue.close();
    } finally {
      this.connection.disconnect();
    }
  }
}

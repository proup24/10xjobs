import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Processor, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { RedisConfig } from 'src/config';
import { REDIS_SETTINGS } from 'src/infrastructure/redis/settings.module';

const STARTUP_TIMEOUT_MS = 15000;

/** Owns the Redis resources for the single worker selected in this process. */
@Injectable()
export class WorkerRuntimeService {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(@Inject(REDIS_SETTINGS) private readonly settings: RedisConfig) {}

  connect(): Redis {
    this.connection = new Redis(this.settings.url, {
      // Blocking workers must retry indefinitely; never use producer timeouts here.
      maxRetriesPerRequest: null,
      connectTimeout: this.settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Worker Redis connection unavailable'),
    );
    return this.connection;
  }

  async createQueue(name: string, connection: Redis): Promise<Queue> {
    const queue = new Queue(name, {
      connection,
      prefix: this.settings.prefix,
    });
    // Retain the queue for shutdown even if readiness fails.
    this.queue = queue;
    queue.on('error', () => this.logger.warn('Queue operation failed'));
    await withTimeout(queue.waitUntilReady());
    return queue;
  }

  startWorker(
    name: string,
    processor: Processor,
    concurrency: number,
    connection: Redis,
  ): void {
    this.worker = new Worker(name, processor, {
      connection,
      prefix: this.settings.prefix,
      concurrency,
    });
  }

  async waitUntilReady(): Promise<void> {
    if (!this.worker) return;

    this.worker.on('error', () =>
      this.logger.error('Worker Redis operation failed'),
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Job ${job?.id ?? 'unknown'} failed: ${error.message}`),
    );
    await withTimeout(this.worker.waitUntilReady());
    this.logger.log(`Worker ready on ${this.worker.name}`);
  }

  async close(): Promise<void> {
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

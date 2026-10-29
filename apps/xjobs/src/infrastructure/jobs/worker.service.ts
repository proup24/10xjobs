import {
  Inject, Injectable, Logger,
  type OnModuleInit, type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { RedisConfig } from '../../config';
import { REDIS_SETTINGS } from '../redis/redis-settings.module';
import { INFRASTRUCTURE_QUEUE } from './jobs.service';
import { processInfrastructureJob } from './processor';

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name);
  private readonly connection: Redis;
  private readonly worker: Worker;

  constructor(@Inject(REDIS_SETTINGS) settings: RedisConfig) {
    this.connection = new Redis(settings.url, {
      // Blocking workers must retry indefinitely; never use producer timeouts here.
      maxRetriesPerRequest: null,
      connectTimeout: settings.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () => this.logger.warn('Worker Redis connection unavailable'));
    this.worker = new Worker(INFRASTRUCTURE_QUEUE, processInfrastructureJob, {
      connection: this.connection,
      prefix: settings.prefix,
      concurrency: settings.jobsConcurrency,
    });
    this.worker.on('error', () => this.logger.error('Worker Redis operation failed'));
    this.worker.on('failed', (job) => this.logger.warn(`Job ${job?.id ?? 'unknown'} failed`));
  }

  async onModuleInit(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.worker.waitUntilReady(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Worker Redis startup timed out')), 15000);
        }),
      ]);
      this.logger.log('Worker ready');
    } finally {
      clearTimeout(timer);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Stop accepting jobs and await active handlers before releasing Redis.
    try { await this.worker.close(); } finally { this.connection.disconnect(); }
    this.logger.log('Worker stopped');
  }
}

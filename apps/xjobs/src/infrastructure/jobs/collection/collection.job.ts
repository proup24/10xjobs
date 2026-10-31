import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Channel } from 'src/common/enums';
import type { RedisConfig } from 'src/config';
import type { QuerySearchBuilderRow } from 'src/database';
import type { CollectedJob, Collector } from 'src/modules/collectors';
import { type IngestService, ingestConfig } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { type ChannelJobConfig, channelJobsConfig } from '../config';

/** Scheduler id and job name of a channel's recurring collect job. */
export const COLLECT_JOB = 'collect';

const STARTUP_TIMEOUT_MS = 15000;

/** What one collect run did. */
export interface CollectionSummary {
  channel: Channel;
  builders: number;
  succeeded: number;
  failed: number;
  collected: number;
  truncated: number;
  incomplete: number;
  inserted: number;
  updated: number;
  duplicate: number;
  invalid: number;
}

/** Makes the queue's cron scheduler match the channel's config; idempotent. */
export async function syncCollectionScheduler(
  queue: Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>,
  config: ChannelJobConfig,
): Promise<'scheduled' | 'removed'> {
  if (!config.enabled) {
    await queue.removeJobScheduler(COLLECT_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    COLLECT_JOB,
    { pattern: config.schedule.pattern, tz: config.schedule.timezone },
    { name: COLLECT_JOB, opts: { attempts: config.attempts } },
  );
  return 'scheduled';
}

/**
 * A channel's collection job: on its own cron schedule and queue, it searches
 * the channel's active query search builders with the channel's collector and
 * saves each builder's results through ingest.
 */
export abstract class CollectionJob implements OnApplicationShutdown {
  abstract readonly channel: Channel;
  abstract readonly queueName: string;
  protected readonly logger = new Logger(this.constructor.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    protected readonly collector: Collector,
    protected readonly queries: QuerySearchService,
    protected readonly ingest: IngestService,
    protected readonly redis: RedisConfig,
  ) {}

  /**
   * Registers the cron scheduler and starts consuming the queue. Returns false,
   * after removing the scheduler, when the channel is disabled.
   */
  async start(): Promise<boolean> {
    const config = channelJobsConfig[this.channel];
    this.connection = new Redis(this.redis.url, {
      // Blocking workers must retry indefinitely; never use producer timeouts here.
      maxRetriesPerRequest: null,
      connectTimeout: this.redis.commandTimeoutMs,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
    });
    this.connection.on('error', () =>
      this.logger.warn('Redis connection unavailable'),
    );
    this.queue = new Queue(this.queueName, {
      connection: this.connection,
      prefix: this.redis.prefix,
    });
    this.queue.on('error', () => this.logger.warn('Queue operation failed'));
    await withTimeout(this.queue.waitUntilReady());

    if ((await syncCollectionScheduler(this.queue, config)) === 'removed') {
      this.logger.log('Channel disabled; scheduler removed');
      return false;
    }

    this.worker = new Worker(
      this.queueName,
      async (job) => {
        if (job.name !== COLLECT_JOB)
          throw new UnrecoverableError(`Unsupported job: ${job.name}`);
        return this.run();
      },
      {
        connection: this.connection,
        prefix: this.redis.prefix,
        concurrency: config.concurrency,
      },
    );
    this.worker.on('error', () => this.logger.error('Worker Redis failed'));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Job ${job?.id ?? 'unknown'} failed: ${error.message}`),
    );
    await withTimeout(this.worker.waitUntilReady());
    this.logger.log(
      `Collecting ${this.channel} on ${config.schedule.pattern} ${config.schedule.timezone}`,
    );
    return true;
  }

  /** One collect run over the channel's active builders. */
  async run(): Promise<CollectionSummary> {
    // One observation time and one snapshot of the builders for the whole run.
    const observedAt = new Date();
    const builders = await this.queries.listActive(this.channel);
    const summary: CollectionSummary = {
      channel: this.channel,
      builders: builders.length,
      succeeded: 0,
      failed: 0,
      collected: 0,
      truncated: 0,
      incomplete: 0,
      inserted: 0,
      updated: 0,
      duplicate: 0,
      invalid: 0,
    };

    for (const builder of builders) {
      try {
        await this.collectBuilder(builder, observedAt, summary);
        summary.succeeded += 1;
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(
          `Builder ${builder.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      Object.entries(summary)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
    if (summary.builders > 0 && summary.succeeded === 0)
      throw new Error(
        `${this.channel} collection failed for all ${summary.failed} builders`,
      );
    return summary;
  }

  private async collectBuilder(
    builder: QuerySearchBuilderRow,
    observedAt: Date,
    summary: CollectionSummary,
  ): Promise<void> {
    const result = await this.collector.collect({
      id: builder.id,
      channel: this.channel,
      keyword: builder.keyword,
      params: builder.params as Record<string, unknown>,
    });
    summary.collected += result.jobs.length;
    if (result.truncated) summary.truncated += 1;
    if (!result.complete) summary.incomplete += 1;

    for (const items of chunks(result.jobs, ingestConfig.maxBatchItems)) {
      const report = await this.ingest.ingest({
        queryId: builder.id,
        observedAt,
        channel: this.channel,
        items,
      });
      summary.inserted += report.inserted;
      summary.updated += report.updated;
      summary.duplicate += report.duplicate;
      summary.invalid += report.invalid;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // Stop taking jobs and let the active run finish before releasing Redis.
    try {
      await this.worker?.close();
      await this.queue?.close();
    } finally {
      this.connection?.disconnect();
    }
  }
}

function chunks(items: CollectedJob[], size: number): CollectedJob[][] {
  const out: CollectedJob[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis startup timed out')),
          STARTUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

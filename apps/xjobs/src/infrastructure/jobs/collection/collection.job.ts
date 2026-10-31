import { Logger } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import type { CollectedJob, Collector } from 'src/modules/collectors';
import { type IngestService, ingestConfig } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import { type ChannelJobConfig, channelJobsConfig } from '../config';

/** Scheduler id and job name of a channel's recurring collect job. */
export const COLLECT_JOB = 'collect';

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

/**
 * A channel's collection job: its queue, its schedule config, and one run that
 * searches the channel's active query search builders with the channel's
 * collector and saves each builder's results through ingest. A worker process
 * schedules and consumes it.
 */
export abstract class CollectionJob {
  abstract readonly channel: Channel;
  abstract readonly queueName: string;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly collector: Collector,
    protected readonly queries: QuerySearchService,
    protected readonly ingest: IngestService,
  ) {}

  get config(): ChannelJobConfig {
    return channelJobsConfig[this.channel];
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
}

function chunks(items: CollectedJob[], size: number): CollectedJob[][] {
  const out: CollectedJob[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

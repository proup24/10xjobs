import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  COLLECTOR_PROVIDERS,
  type CollectedJob,
  type Collector,
} from 'src/modules/collectors';
import { IngestService, ingestConfig } from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';

/** What one collect job did for one channel. */
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
 * Runs one channel's collection: its active query search builders (queries
 * module) are searched by its collector (collectors module), and each
 * builder's results are saved against that builder (ingest module).
 */
@Injectable()
export class CollectionProcessor {
  private readonly logger = new Logger(CollectionProcessor.name);

  constructor(
    private readonly queries: QuerySearchService,
    @Inject(COLLECTOR_PROVIDERS) private readonly collectors: Collector[],
    private readonly ingest: IngestService,
  ) {}

  async run(channel: Channel): Promise<CollectionSummary> {
    const collector = this.collectors.find((c) => c.channel === channel);
    if (!collector) throw new Error(`No collector for channel ${channel}`);

    // One observation time for the whole run, and one snapshot of the builders.
    const observedAt = new Date();
    const builders = await this.queries.listActive(channel);
    const summary: CollectionSummary = {
      channel,
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
        await this.runBuilder(collector, builder, observedAt, summary);
        summary.succeeded += 1;
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(
          `${channel} builder ${builder.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `${channel} collection: ${Object.entries(summary)
        .filter(([key]) => key !== 'channel')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    );
    if (summary.builders > 0 && summary.succeeded === 0)
      throw new Error(
        `${channel} collection failed for all ${summary.failed} builders`,
      );
    return summary;
  }

  private async runBuilder(
    collector: Collector,
    builder: QuerySearchBuilderRow,
    observedAt: Date,
    summary: CollectionSummary,
  ): Promise<void> {
    const result = await collector.collect({
      id: builder.id,
      channel: builder.channel as Channel,
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
        channel: builder.channel as Channel,
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

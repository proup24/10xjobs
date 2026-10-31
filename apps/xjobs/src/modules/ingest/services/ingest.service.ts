import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Channel } from 'src/common/enums';
import { IngestRepository } from '../repositories/ingest.repository';
import { ingestConfig } from '../config';
import { normalizeItem } from '../utils';
import {
  InvalidIngestItem,
  type IngestBatch,
  type IngestReport,
} from '../types';

const batchSchema = z.object({
  queryId: z.uuid(),
  observedAt: z.date(),
  channel: z.enum(Channel).optional(),
  items: z.array(z.unknown()).max(ingestConfig.maxBatchItems),
});

@Injectable()
export class IngestService {
  constructor(private readonly repository: IngestRepository) {}

  async ingest(batch: IngestBatch): Promise<IngestReport> {
    const parsed = batchSchema.safeParse(batch);
    if (!parsed.success)
      throw new BadRequestException(
        `Invalid ingest batch: UUID queryId, valid observedAt and at most ${ingestConfig.maxBatchItems} items required`,
      );
    const { queryId, observedAt, items } = parsed.data;
    const query = await this.repository.findQuery(queryId);
    if (!query) throw new NotFoundException('Lookup query not found');
    if (parsed.data.channel && parsed.data.channel !== query.channel)
      throw new BadRequestException(
        'Batch channel does not match lookup query',
      );

    const report: IngestReport = {
      inserted: 0,
      updated: 0,
      duplicate: 0,
      invalid: 0,
      jobIds: [],
      errors: [],
    };
    const ids = new Set<string>();
    for (const [index, value] of items.entries()) {
      try {
        const item = normalizeItem(query.channel, value);
        const result = await this.repository.save(queryId, item, observedAt);
        report[result.outcome]++;
        ids.add(result.id);
      } catch (error) {
        if (!(error instanceof InvalidIngestItem)) throw error;
        report.invalid++;
        report.errors.push({ index, reason: error.message });
      }
    }
    report.jobIds = [...ids];
    return report;
  }
}

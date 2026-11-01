import { Injectable } from '@nestjs/common';
import { channelIngestConfig, ingestConfig } from '../config';
import {
  type BatchRecord,
  RawStorageRepository,
} from '../repositories/raw.repository';
import type { BatchFile, BatchReport, RawCollectedItem } from '../types';
import { contentHash, postgresSafe, sourceKey } from '../utils';

/** Validates and persists batch items, collecting a bounded ingestion report. */
@Injectable()
export class BatchItemWriterService {
  constructor(private readonly repository: RawStorageRepository) {}

  async write(batch: BatchRecord, file: BatchFile): Promise<BatchReport> {
    const report: BatchReport = {
      received: 0,
      newItems: 0,
      newVersions: 0,
      repeats: 0,
      invalid: 0,
      errors: [],
    };
    const observedAt = new Date(file.observedAt);
    const { kind } = channelIngestConfig[batch.channel];
    const groups: [string | null, RawCollectedItem[]][] = [
      ...Object.entries(file.itemsByQuery),
      [null, file.unattributed],
    ];
    for (const [queryId, items] of groups)
      for (const [index, item] of items.entries()) {
        report.received += 1;
        const key = sourceKey(batch.channel, item.payload);
        if ('invalid' in key) {
          report.invalid += 1;
          if (report.errors.length < ingestConfig.maxReportErrors)
            report.errors.push({ queryId, index, reason: key.invalid });
          continue;
        }
        const saved = await this.repository.saveItem({
          batchId: batch.id,
          channel: batch.channel,
          kind,
          sourceKey: key.key,
          contentHash: contentHash(batch.channel, item.payload),
          payload: postgresSafe(item.payload),
          queryId,
          rank: item.rank,
          observedAt,
        });
        if (saved.newItem) report.newItems += 1;
        else if (saved.newVersion) report.newVersions += 1;
        else report.repeats += 1;
      }
    return report;
  }
}

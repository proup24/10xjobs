import { Injectable } from '@nestjs/common';
import { channelIngestConfig, ingestConfig } from '../config';
import {
  type BatchRecord,
  RawStorageRepository,
} from '../repositories/raw.repository';
import type { BatchFile, BatchReport, RawCollectedItem } from '../types';
import { contentHash, postgresSafe, sourceKey } from '../utils';

/** What writing a batch produced: its report, and the jobs now pending for Process. */
export interface BatchWriteResult {
  report: BatchReport;
  /** Distinct, in first-seen order. */
  pendingJobIds: string[];
}

/** Validates and persists batch items, collecting a bounded ingestion report. */
@Injectable()
export class BatchItemWriterService {
  constructor(private readonly repository: RawStorageRepository) {}

  async write(batch: BatchRecord, file: BatchFile): Promise<BatchWriteResult> {
    const pending = new Set<string>();
    const report: BatchReport = {
      received: 0,
      newItems: 0,
      newVersions: 0,
      repeats: 0,
      invalid: 0,
      normalized: 0,
      normalizeInvalid: 0,
      newJobs: 0,
      reopened: 0,
      errors: [],
    };
    const addError = (error: BatchReport['errors'][number]) => {
      if (report.errors.length < ingestConfig.maxReportErrors)
        report.errors.push(error);
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
          addError({ stage: 'validate', queryId, index, reason: key.invalid });
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
        if (saved.job === null) continue;
        if ('invalid' in saved.job) {
          report.normalizeInvalid += 1;
          addError({
            stage: 'normalize',
            queryId,
            index,
            reason: saved.job.invalid,
          });
        } else {
          report.normalized += 1;
          if (saved.job.created) report.newJobs += 1;
          if (saved.job.reopened) report.reopened += 1;
          if (saved.job.pending) pending.add(saved.job.jobId);
        }
      }
    return { report, pendingJobIds: [...pending] };
  }
}

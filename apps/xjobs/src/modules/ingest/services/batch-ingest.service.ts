import { Injectable, Logger } from '@nestjs/common';
import {
  StorageObjectNotFoundError,
  StorageService,
} from 'src/modules/storage';
import { channelIngestConfig, ingestConfig } from '../config';
import {
  type BatchRecord,
  RawStorageRepository,
} from '../repositories/raw-storage.repository';
import type { BatchFile, BatchReport, RawCollectedItem } from '../types';
import {
  BatchFileError,
  contentHash,
  parseBatchFile,
  postgresSafe,
  sourceKey,
} from '../utils';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Ingests one stored collection batch: validates each item, removes exact
 * repeats, persists raw items, versions and sightings, and sets the batch's
 * status. Interprets nothing beyond a source key and a content hash.
 */
@Injectable()
export class BatchIngestService {
  private readonly logger = new Logger(BatchIngestService.name);

  constructor(
    private readonly repository: RawStorageRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * Null when the batch is unknown or not pending (already handled).
   * Infrastructure errors are recorded as a failed attempt and rethrown so the
   * queue retries; `final` marks the batch failed instead.
   */
  async ingestBatch(
    batchId: string,
    attempt: { final: boolean },
  ): Promise<BatchReport | null> {
    const batch = await this.repository.findBatch(batchId);
    if (!batch || batch.status !== 'pending') return null;
    try {
      const file = await this.read(batch);
      if (!file) return null;
      const report = await this.store(batch, file);
      await this.repository.markIngested(batch.id, report);
      this.logger.log(
        `Batch ${batch.id} ingested: received=${report.received} new=${report.newItems} versions=${report.newVersions} repeats=${report.repeats} invalid=${report.invalid}`,
      );
      return report;
    } catch (error) {
      await this.repository.recordAttemptFailure(
        batch.id,
        message(error),
        attempt.final,
      );
      throw error;
    }
  }

  /** Sets a failed batch back to pending; the caller enqueues it. */
  async replay(batchId: string): Promise<boolean> {
    return this.repository.resetToPending(batchId);
  }

  /** The batch file, or null after failing a batch whose file is unusable. */
  private async read(batch: BatchRecord): Promise<BatchFile | null> {
    let file: BatchFile;
    try {
      file = parseBatchFile(
        await this.storage.get(ingestConfig.bucket, batch.storageKey),
      );
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        await this.repository.markFailed(batch.id, 'batch file missing');
        return null;
      }
      if (error instanceof BatchFileError) {
        await this.repository.markFailed(batch.id, error.message);
        return null;
      }
      throw error;
    }
    if (file.channel !== batch.channel) {
      await this.repository.markFailed(batch.id, 'batch file channel mismatch');
      return null;
    }
    return file;
  }

  private async store(
    batch: BatchRecord,
    file: BatchFile,
  ): Promise<BatchReport> {
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

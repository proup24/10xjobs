import { Injectable, Logger } from '@nestjs/common';
import { StorageObjectNotFoundError } from 'src/modules/storage';
import {
  type BatchRecord,
  RawStorageRepository,
} from '../repositories/raw.repository';
import type { BatchFile, BatchReport } from '../types';
import { BatchFileError } from '../utils';
import { BatchFileReaderService } from './batch-file-reader.service';
import { BatchItemWriterService } from './batch-item-writer.service';

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Coordinates batch ingestion, status transitions, and retry handling.
 * File loading and item persistence are delegated to focused services.
 */
@Injectable()
export class BatchIngestService {
  private readonly logger = new Logger(BatchIngestService.name);

  constructor(
    private readonly repository: RawStorageRepository,
    private readonly reader: BatchFileReaderService,
    private readonly writer: BatchItemWriterService,
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
      const report = await this.writer.write(batch, file);
      await this.repository.markIngested(batch.id, report);
      this.logger.log(
        `Batch ${batch.id} ingested: received=${report.received} new=${report.newItems} versions=${report.newVersions} repeats=${report.repeats} invalid=${report.invalid} jobs=${report.newJobs} reopened=${report.reopened} normalizeInvalid=${report.normalizeInvalid}`,
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

  /** Permanent file errors fail the batch immediately; outages remain retryable. */
  private async read(batch: BatchRecord): Promise<BatchFile | null> {
    try {
      return await this.reader.read(batch);
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
  }
}

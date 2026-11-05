import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import { StorageObjectNotFoundError } from 'src/modules/storage';
import {
  type BatchRecord,
  RawStorageRepository,
} from '../repositories/raw.repository';
import type { BatchFile, BatchReport } from '../types';
import { BatchFileError } from '../utils';
import { BatchFileReaderService } from './batch-file-reader.service';
import { BatchItemWriterService } from './batch-item-writer.service';

/** The jobs a batch left `pending` for Process. */
export interface PendingJobs {
  channel: Channel;
  jobIds: string[];
}

export interface IngestAttempt {
  /** The last attempt: an infrastructure error fails the batch. */
  final: boolean;
  /**
   * Called once after the batch is marked ingested, so every job it names is
   * committed `pending`. A nudge only: its failure is logged and never fails
   * the batch, because Process's sweeper finds pending jobs anyway.
   */
  onPending?: (pending: PendingJobs) => Promise<void>;
}

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
    attempt: IngestAttempt,
  ): Promise<BatchReport | null> {
    const batch = await this.repository.findBatch(batchId);
    if (!batch || batch.status !== 'pending') return null;
    try {
      const file = await this.read(batch);
      if (!file) return null;
      const { report, pendingJobIds } = await this.writer.write(batch, file);
      await this.repository.markIngested(batch.id, report);
      this.logger.log(
        `Batch ${batch.id} ingested: received=${report.received} new=${report.newItems} versions=${report.newVersions} repeats=${report.repeats} invalid=${report.invalid} jobs=${report.newJobs} reopened=${report.reopened} normalizeInvalid=${report.normalizeInvalid}`,
      );
      await this.notifyPending(batch, pendingJobIds, attempt);
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

  private async notifyPending(
    batch: BatchRecord,
    jobIds: string[],
    attempt: IngestAttempt,
  ): Promise<void> {
    if (!attempt.onPending || jobIds.length === 0) return;
    try {
      await attempt.onPending({ channel: batch.channel, jobIds });
    } catch (error) {
      this.logger.warn(
        `Batch ${batch.id}: could not nudge Process for ${jobIds.length} pending jobs (the sweeper will pick them up): ${message(error)}`,
      );
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

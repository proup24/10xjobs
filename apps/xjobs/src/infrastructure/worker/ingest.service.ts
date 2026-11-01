import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  INGEST_QUEUE,
  IngestQueue,
  ingestWorkerConfig,
  processIngestJob,
} from 'src/infrastructure/jobs/steps/ingest';
import {
  BatchIngestService,
  RawStorageRepository,
  ingestConfig,
} from 'src/modules/ingest';
import { StorageService } from 'src/modules/storage';
import { syncSweepScheduler } from './scheduler';
import { WorkerRuntimeService } from './runtime.service';

@Injectable()
export class IngestWorkerService {
  private readonly logger = new Logger(IngestWorkerService.name);

  constructor(
    private readonly runtime: WorkerRuntimeService,
    private readonly storage: StorageService,
    private readonly ingest: BatchIngestService,
    private readonly rawStorage: RawStorageRepository,
    private readonly ingestQueue: IngestQueue,
  ) {}

  async start(connection: Redis): Promise<void> {
    await this.storage.ensureBucket(ingestConfig.bucket);
    const queue = await this.runtime.createQueue(INGEST_QUEUE, connection);
    await syncSweepScheduler(queue);
    this.runtime.startWorker(
      INGEST_QUEUE,
      (bullJob) =>
        processIngestJob(bullJob, {
          ingest: this.ingest,
          repo: this.rawStorage,
          queue: this.ingestQueue,
        }),
      ingestWorkerConfig.concurrency,
      connection,
    );
    this.logger.log(
      `Ingesting collection batches; sweeping every ${ingestConfig.sweepEveryMs / 1000}s`,
    );
  }
}

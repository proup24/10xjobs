import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import {
  type BatchIngestService,
  type RawStorageRepository,
  ingestConfig,
} from 'src/modules/ingest';
import {
  INGEST_BATCH_JOB,
  type IngestQueue,
  SWEEP_JOB,
} from './ingest-queue.service';

/** Stranded batches re-enqueued per sweep. */
const SWEEP_LIMIT = 100;

const batchPayload = z.object({ batchId: z.string().min(1) });

export interface IngestJobDeps {
  ingest: Pick<BatchIngestService, 'ingestBatch'>;
  repo: Pick<RawStorageRepository, 'listStalePending'>;
  queue: Pick<IngestQueue, 'enqueue'>;
}

/** Runs one job of the `ingest` queue: a batch to ingest, or a sweep. */
export async function processIngestJob(
  job: {
    name: string;
    data: unknown;
    attemptsMade: number;
    opts: { attempts?: number };
  },
  deps: IngestJobDeps,
): Promise<unknown> {
  if (job.name === INGEST_BATCH_JOB) {
    const payload = batchPayload.safeParse(job.data);
    if (!payload.success)
      throw new UnrecoverableError('Invalid ingest-batch payload');
    // attemptsMade counts earlier failures; this run is the last when it reaches attempts - 1.
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return deps.ingest.ingestBatch(payload.data.batchId, { final });
  }
  if (job.name === SWEEP_JOB) {
    const stale = await deps.repo.listStalePending(
      new Date(Date.now() - ingestConfig.staleAfterMs),
      SWEEP_LIMIT,
    );
    for (const batchId of stale) await deps.queue.enqueue(batchId);
    return { requeued: stale.length };
  }
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}

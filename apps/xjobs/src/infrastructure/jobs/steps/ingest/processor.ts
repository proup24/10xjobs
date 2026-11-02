import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import {
  type BatchIngestService,
  type RawStorageRepository,
  ingestConfig,
} from 'src/modules/ingest';
import { PROCESSOR_CHANNEL } from 'src/modules/processor';
import type { ProcessQueue } from '../process/queue.service';
import { INGEST_BATCH_JOB, type IngestQueue, SWEEP_JOB } from './queue.service';

/** Stranded batches re-enqueued per sweep. */
const SWEEP_LIMIT = 100;

const batchPayload = z.object({ batchId: z.string().min(1) });

export interface IngestJobDeps {
  ingest: Pick<BatchIngestService, 'ingestBatch'>;
  repo: Pick<RawStorageRepository, 'listStalePending'>;
  queue: Pick<IngestQueue, 'enqueue'>;
  /** Nudges the processor about jobs a batch left pending; its sweeper is the fallback. */
  processQueue: Pick<ProcessQueue, 'enqueue'>;
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
    return deps.ingest.ingestBatch(payload.data.batchId, {
      final,
      onPending: async ({ channel, jobIds }) => {
        // Other channels' jobs are out of the processor's scope: it would only
        // fail to claim them.
        if (channel !== PROCESSOR_CHANNEL) return;
        for (const jobId of jobIds) await deps.processQueue.enqueue(jobId);
      },
    });
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

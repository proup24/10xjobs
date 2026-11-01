import { UnrecoverableError } from 'bullmq';
import { ingestConfig } from 'src/modules/ingest';
import { processIngestJob } from '../steps/ingest/processor';
import { INGEST_ATTEMPTS } from '../steps/ingest/queue.service';

function deps() {
  return {
    ingest: { ingestBatch: vi.fn(async () => null) },
    repo: { listStalePending: vi.fn(async () => ['b1', 'b2']) },
    queue: { enqueue: vi.fn(async () => undefined) },
  };
}
const job = (name: string, data: unknown, attemptsMade = 0) => ({
  name,
  data,
  attemptsMade,
  opts: { attempts: INGEST_ATTEMPTS },
});

describe('processIngestJob', () => {
  it('ingests a batch, final only on its last attempt', async () => {
    const d = deps();
    await processIngestJob(job('ingest-batch', { batchId: 'b1' }), d as never);
    expect(d.ingest.ingestBatch).toHaveBeenLastCalledWith('b1', { final: false });

    await processIngestJob(
      job('ingest-batch', { batchId: 'b1' }, INGEST_ATTEMPTS - 1),
      d as never,
    );
    expect(d.ingest.ingestBatch).toHaveBeenLastCalledWith('b1', { final: true });
  });

  it('refuses a batch job without a batch id', async () => {
    await expect(
      processIngestJob(job('ingest-batch', {}), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('re-enqueues only stale pending batches', async () => {
    const d = deps();
    const now = Date.now();
    await processIngestJob(job('sweep', {}), d as never);

    const [olderThan, limit] = d.repo.listStalePending.mock.calls[0] as unknown as [Date, number];
    expect(now - olderThan.getTime()).toBeGreaterThanOrEqual(
      ingestConfig.staleAfterMs - 1000,
    );
    expect(limit).toBe(100);
    expect(d.queue.enqueue.mock.calls).toEqual([['b1'], ['b2']]);
  });

  it('refuses an unknown job', async () => {
    await expect(
      processIngestJob(job('other', {}), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

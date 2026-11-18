import { UnrecoverableError } from 'bullmq';
import { Channel } from 'src/common/enums';
import { ingestConfig } from 'src/modules/ingest';
import { processIngestJob } from '../steps/ingest/processor';
import { INGEST_ATTEMPTS } from '../steps/ingest/queue.service';

function deps() {
  return {
    ingest: { ingestBatch: vi.fn(async () => null) },
    repo: { listStalePending: vi.fn(async () => ['b1', 'b2']) },
    queue: { enqueue: vi.fn(async () => undefined) },
    processQueue: { enqueue: vi.fn(async () => undefined) },
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
    expect(d.ingest.ingestBatch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ final: false }),
    );

    await processIngestJob(
      job('ingest-batch', { batchId: 'b1' }, INGEST_ATTEMPTS - 1),
      d as never,
    );
    expect(d.ingest.ingestBatch).toHaveBeenLastCalledWith(
      'b1',
      expect.objectContaining({ final: true }),
    );
  });

  it('sends the pending jobs of a LinkedIn job board batch to the processor', async () => {
    const d = deps();
    d.ingest.ingestBatch.mockImplementation((async (
      _id: string,
      attempt: {
        onPending?: (p: {
          channel: Channel;
          jobIds: string[];
        }) => Promise<void>;
      },
    ) => {
      await attempt.onPending?.({
        channel: Channel.LINKEDIN_JOB_BOARD,
        jobIds: ['j1', 'j2'],
      });
      return null;
    }) as never);
    await processIngestJob(job('ingest-batch', { batchId: 'b1' }), d as never);
    expect(d.processQueue.enqueue.mock.calls).toEqual([['j1'], ['j2']]);
  });

  it('sends the pending jobs of a trial-channel batch to the processor', async () => {
    const d = deps();
    d.ingest.ingestBatch.mockImplementation((async (
      _id: string,
      attempt: {
        onPending?: (p: {
          channel: Channel;
          jobIds: string[];
        }) => Promise<void>;
      },
    ) => {
      await attempt.onPending?.({
        channel: Channel.LINKEDIN_JOB_BOARD_CHEAP,
        jobIds: ['j1', 'j2'],
      });
      return null;
    }) as never);
    await processIngestJob(job('ingest-batch', { batchId: 'b1' }), d as never);
    expect(d.processQueue.enqueue.mock.calls).toEqual([['j1'], ['j2']]);
  });

  it('does not nudge the processor for LinkedIn posts', async () => {
    const d = deps();
    d.ingest.ingestBatch.mockImplementation((async (
      _id: string,
      attempt: {
        onPending?: (p: {
          channel: Channel;
          jobIds: string[];
        }) => Promise<void>;
      },
    ) => {
      await attempt.onPending?.({
        channel: Channel.LINKEDIN_POSTS,
        jobIds: ['j1'],
      });
      return null;
    }) as never);
    await processIngestJob(job('ingest-batch', { batchId: 'b1' }), d as never);
    expect(d.processQueue.enqueue).not.toHaveBeenCalled();
  });

  it('does not nudge the processor for channels it does not process', async () => {
    const d = deps();
    d.ingest.ingestBatch.mockImplementation((async (
      _id: string,
      attempt: {
        onPending?: (p: {
          channel: Channel;
          jobIds: string[];
        }) => Promise<void>;
      },
    ) => {
      await attempt.onPending?.({ channel: Channel.ASHBY, jobIds: ['j1'] });
      return null;
    }) as never);
    await processIngestJob(job('ingest-batch', { batchId: 'b1' }), d as never);
    expect(d.processQueue.enqueue).not.toHaveBeenCalled();
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

    const [olderThan, limit] = d.repo.listStalePending.mock
      .calls[0] as unknown as [Date, number];
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

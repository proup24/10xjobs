import { UnrecoverableError } from 'bullmq';
import { processMatchJob } from './processor';

function deps() {
  return {
    service: {
      matchJob: vi.fn(async () => ({
        status: 'matched',
        profiles: 2,
        qualified: 2,
        deliveryIds: ['d1', 'd2'],
      })),
    },
    repo: {
      listStaleJobs: vi.fn(async () => ['j1', 'j2']),
      deleteInactive: vi.fn(async () => 4),
    },
    searches: {
      applyPending: vi.fn(async () => ({ applied: 3, failed: 1, skipped: 0 })),
    },
    queue: { enqueue: vi.fn(async () => undefined) },
    webhooks: { enqueue: vi.fn(async (_id: string) => undefined) },
  };
}
const job = (name: string, data: unknown = {}) => ({ name, data });

describe('processMatchJob', () => {
  it('matches one job', async () => {
    const d = deps();
    await processMatchJob(job('match-job', { jobId: 'j1' }), d as never);
    expect(d.service.matchJob).toHaveBeenCalledWith('j1', { force: undefined });
  });

  it('passes force through', async () => {
    const d = deps();
    await processMatchJob(
      job('match-job', { jobId: 'j1', force: true }),
      d as never,
    );
    expect(d.service.matchJob).toHaveBeenCalledWith('j1', { force: true });
  });

  it('enqueues each delivery id', async () => {
    const d = deps();
    await processMatchJob(job('match-job', { jobId: 'j1' }), d as never);
    expect(d.webhooks.enqueue.mock.calls).toEqual([['d1'], ['d2']]);
  });

  it("a failed enqueue doesn't fail the match job", async () => {
    const d = deps();
    d.webhooks.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      processMatchJob(job('match-job', { jobId: 'j1' }), d as never),
    ).resolves.toMatchObject({ status: 'matched' });
    expect(d.webhooks.enqueue.mock.calls).toEqual([['d1'], ['d2']]);
  });

  it('refuses an invalid payload', async () => {
    await expect(
      processMatchJob(job('match-job', {}), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('sweeps: deletes inactive matches and enqueues stale jobs', async () => {
    const d = deps();
    expect(await processMatchJob(job('sweep'), d as never)).toEqual({
      searches: { applied: 3, failed: 1, skipped: 0 },
      deleted: 4,
      enqueued: 2,
    });
    expect(d.repo.listStaleJobs).toHaveBeenCalledWith(200);
    expect(d.queue.enqueue.mock.calls).toEqual([['j1'], ['j2']]);
  });

  it('the sweep applies pending searches before matching', async () => {
    const d = deps();
    const order: string[] = [];
    d.searches.applyPending.mockImplementation(async () => {
      order.push('searches');
      return { applied: 2, failed: 0, skipped: 0 };
    });
    d.repo.deleteInactive.mockImplementation(async () => {
      order.push('delete');
      return 0;
    });
    const result = await processMatchJob(job('sweep'), d as never);
    expect(d.searches.applyPending).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['searches', 'delete']);
    expect(result).toMatchObject({ searches: { applied: 2, failed: 0 } });
  });

  it('runs the match sweep when search sync throws', async () => {
    const d = deps();
    d.searches.applyPending.mockRejectedValue(
      Object.assign(new Error('secret profile text'), { code: 'ECONNREFUSED' }),
    );
    const result = await processMatchJob(job('sweep'), d as never);
    expect(d.repo.deleteInactive).toHaveBeenCalled();
    expect(d.repo.listStaleJobs).toHaveBeenCalled();
    expect(result).toEqual({
      searches: { error: 'ECONNREFUSED' },
      deleted: 4,
      enqueued: 2,
    });
  });

  it('throws on an unknown job name', async () => {
    await expect(
      processMatchJob(job('other'), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

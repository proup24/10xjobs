import { UnrecoverableError } from 'bullmq';
import type { ProcessorConfig } from 'src/modules/processor';
import { processProcessJob } from './processor';

const config: ProcessorConfig = {
  extractionModel: 'e',
  concurrency: 2,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 10,
  weeklyStopAt: 0.85,
  generationTries: 3,
  postDailyCap: 250,
};

function deps(outcome = 'processed', spent = 0, paused = false) {
  return {
    service: {
      process: vi.fn(async () => outcome),
      isPaused: vi.fn(() => paused),
      isPostCapReached: vi.fn(async () => false),
    },
    repo: {
      listPendingInScope: vi.fn(async () => ['j1', 'j2']),
      listPendingPosts: vi.fn(async (): Promise<string[]> => []),
      releaseStale: vi.fn(async () => 3),
      spendSince: vi.fn(async () => spent),
    },
    queue: { enqueue: vi.fn(async (_id: string, _kind?: 'post') => undefined) },
    matchQueue: { enqueue: vi.fn(async () => undefined) },
    config,
  };
}
const job = (name: string, data: unknown = {}) => ({ name, data });

describe('processProcessJob', () => {
  it('sweeps listings only while the post cap is reached', async () => {
    const d = deps();
    d.service.isPostCapReached.mockResolvedValue(true);
    d.repo.listPendingPosts.mockResolvedValue(['p1']);
    const result = await processProcessJob(job('sweep'), d as never);
    expect(d.repo.listPendingPosts).not.toHaveBeenCalled();
    expect(d.queue.enqueue.mock.calls.map((c) => c[0])).toEqual(['j1', 'j2']);
    expect(result).toMatchObject({ enqueued: 2 });
  });

  it('sweeps the waiting listings first, then the posts', async () => {
    const d = deps();
    d.repo.listPendingPosts.mockResolvedValue(['p1']);
    const result = await processProcessJob(job('sweep'), d as never);
    // Posts at their lower priority: a listing queued later still goes first.
    expect(d.queue.enqueue.mock.calls).toEqual([
      ['j1'],
      ['j2'],
      ['p1', 'post'],
    ]);
    expect(result).toMatchObject({ enqueued: 3 });
    expect(d.repo.listPendingPosts).toHaveBeenCalledWith(200);
  });

  it('refuses a process-job without a job id', async () => {
    await expect(
      processProcessJob(job('process-job', {}), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('throws on a retry outcome so BullMQ backs off', async () => {
    await expect(
      processProcessJob(
        job('process-job', { jobId: 'j1' }),
        deps('retry') as never,
      ),
    ).rejects.toThrow('retry');
  });

  it('returns any other outcome', async () => {
    const d = deps('processed');
    expect(
      await processProcessJob(job('process-job', { jobId: 'j1' }), d as never),
    ).toEqual({ outcome: 'processed' });
    expect(d.service.process).toHaveBeenCalledWith('j1');
  });

  it.each(['processed', 'reused'])(
    'hands a %s job to the matcher',
    async (o) => {
      const d = deps(o);
      await processProcessJob(job('process-job', { jobId: 'j1' }), d as never);
      expect(d.matchQueue.enqueue).toHaveBeenCalledWith('j1');
    },
  );

  it('still returns the outcome when the match nudge throws', async () => {
    const d = deps('processed');
    d.matchQueue.enqueue.mockRejectedValue(new Error('redis down'));
    expect(
      await processProcessJob(job('process-job', { jobId: 'j1' }), d as never),
    ).toEqual({ outcome: 'processed' });
  });

  it.each(['closed', 'superseded', 'not_claimed', 'blocked'])(
    'does not hand a %s job to the matcher',
    async (o) => {
      const d = deps(o);
      await processProcessJob(job('process-job', { jobId: 'j1' }), d as never);
      expect(d.matchQueue.enqueue).not.toHaveBeenCalled();
    },
  );

  it('does not hand a failed job to the matcher', async () => {
    const d = deps('retry');
    await expect(
      processProcessJob(job('process-job', { jobId: 'j1' }), d as never),
    ).rejects.toThrow('retry');
    expect(d.matchQueue.enqueue).not.toHaveBeenCalled();
  });

  it('sweeps: releases stale claims and enqueues pending jobs', async () => {
    const d = deps();
    const now = Date.now();
    vi.useFakeTimers({ now });
    try {
      expect(await processProcessJob(job('sweep'), d as never)).toEqual({
        released: 3,
        enqueued: 2,
      });
    } finally {
      vi.useRealTimers();
    }
    expect(d.repo.releaseStale).toHaveBeenCalledWith(new Date(now - 900_000));
    expect(d.repo.listPendingInScope).toHaveBeenCalledWith(200);
    expect(d.queue.enqueue.mock.calls).toEqual([['j1'], ['j2']]);
  });

  it('sweeps over budget: releases but enqueues nothing', async () => {
    const d = deps('processed', 10);
    expect(await processProcessJob(job('sweep'), d as never)).toEqual({
      released: 3,
      enqueued: 0,
    });
    expect(d.repo.listPendingInScope).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('sweeps with a budget of 0 (no cap): enqueues despite spend', async () => {
    const d = {
      ...deps('processed', 50),
      config: { ...config, dailyBudgetUsd: 0 },
    };
    expect(await processProcessJob(job('sweep'), d as never)).toEqual({
      released: 3,
      enqueued: 2,
    });
    expect(d.queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('sweeps while paused: releases but enqueues nothing', async () => {
    const d = deps('processed', 0, true);
    expect(await processProcessJob(job('sweep'), d as never)).toEqual({
      released: 3,
      enqueued: 0,
    });
    expect(d.repo.listPendingInScope).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it.each(['provider_unavailable', 'paused'])(
    'returns a %s outcome without throwing',
    async (outcome) => {
      expect(
        await processProcessJob(
          job('process-job', { jobId: 'j1' }),
          deps(outcome) as never,
        ),
      ).toEqual({ outcome });
    },
  );

  it('rejects an unknown job name', async () => {
    await expect(
      processProcessJob(job('nope'), deps() as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

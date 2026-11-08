import { UnrecoverableError } from 'bullmq';
import type { ProcessorConfig } from 'src/modules/processor';
import { processProcessJob } from './processor';

const config: ProcessorConfig = {
  decisionModel: 'd',
  extractionModel: 'e',
  concurrency: 2,
  maxAttempts: 3,
  claimTimeoutMs: 900_000,
  dailyBudgetUsd: 10,
  maxRegenerations: 2,
  generationTries: 3,
};

function deps(outcome = 'processed', spent = 0, paused = false) {
  return {
    service: {
      process: vi.fn(async () => outcome),
      isPaused: vi.fn(() => paused),
    },
    repo: {
      listPendingInScope: vi.fn(async () => ['j1', 'j2']),
      releaseStale: vi.fn(async () => 3),
      spendSince: vi.fn(async () => spent),
    },
    queue: { enqueue: vi.fn(async () => undefined) },
    config,
  };
}
const job = (name: string, data: unknown = {}) => ({ name, data });

describe('processProcessJob', () => {
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

import { UnrecoverableError } from 'bullmq';
import { processWebhookJob } from './processor';

const now = new Date('2026-11-16T10:00:00Z');

function deps() {
  return {
    service: {
      deliver: vi.fn<(id: string) => Promise<'delivered'>>(
        async () => 'delivered',
      ),
    },
    repo: {
      recoverStuck: vi.fn<(now: Date) => Promise<number>>(async () => 1),
      applyRetention: vi.fn<
        (now: Date) => Promise<{ cleared: number; deleted: number }>
      >(async () => ({ cleared: 2, deleted: 3 })),
      listDue: vi.fn<(now: Date, limit: number) => Promise<string[]>>(
        async () => ['d1', 'd2'],
      ),
    },
    queue: {
      enqueue: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    },
    now: () => now,
  };
}
const job = (name: string, data: unknown = {}) => ({ name, data });

describe('processWebhookJob', () => {
  it('sends one delivery', async () => {
    const d = deps();
    expect(
      await processWebhookJob(job('send', { deliveryId: 'd1' }), d),
    ).toEqual({ deliveryId: 'd1', result: 'delivered' });
    expect(d.service.deliver).toHaveBeenCalledWith('d1');
  });

  it('refuses an invalid send payload', async () => {
    await expect(
      processWebhookJob(job('send', {}), deps()),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('sweep enqueues listDue ids', async () => {
    const d = deps();
    expect(await processWebhookJob(job('sweep'), d)).toEqual({
      recovered: 1,
      cleared: 2,
      deleted: 3,
      enqueued: 2,
    });
    expect(d.repo.recoverStuck).toHaveBeenCalledWith(now);
    expect(d.repo.applyRetention).toHaveBeenCalledWith(now);
    expect(d.repo.listDue).toHaveBeenCalledWith(now, 200);
    expect(d.queue.enqueue.mock.calls).toEqual([['d1'], ['d2']]);
    // Stuck rows are back to pending before the due rows are listed.
    expect(d.repo.recoverStuck.mock.invocationCallOrder[0]).toBeLessThan(
      d.repo.listDue.mock.invocationCallOrder[0],
    );
  });

  it('throws on an unknown job name', async () => {
    await expect(
      processWebhookJob(job('other'), deps()),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

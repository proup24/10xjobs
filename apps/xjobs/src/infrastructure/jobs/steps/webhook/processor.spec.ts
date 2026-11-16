import { UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import type { DeliveryOutcome } from 'src/modules/webhooks';
import { DeliveryService } from 'src/modules/webhooks/services/delivery.service';
import { MemoryWebhooksRepository } from 'src/modules/webhooks/repositories/testing/memory-webhooks.repository';
import type { SendInput, SendResult } from 'src/modules/webhooks/sender/send';
import { processWebhookJob } from './processor';

const now = new Date('2026-11-16T10:00:00Z');

function deps() {
  return {
    service: {
      deliver: vi.fn<(id: string) => Promise<DeliveryOutcome>>(async () => ({
        result: 'delivered',
        webhookId: 'w1',
      })),
    },
    repo: {
      recoverStuck: vi.fn<(now: Date) => Promise<number>>(async () => 1),
      applyRetention: vi.fn<
        (now: Date) => Promise<{ cleared: number; deleted: number }>
      >(async () => ({ cleared: 2, deleted: 3 })),
      listDue: vi.fn<(now: Date, limit: number) => Promise<string[]>>(
        async () => ['d1', 'd2'],
      ),
      nextDue: vi.fn<(webhookId: string, now: Date) => Promise<string | null>>(
        async () => 'd9',
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
    // The webhook's next due row goes right away.
    expect(d.repo.nextDue).toHaveBeenCalledWith('w1', now);
    expect(d.queue.enqueue.mock.calls).toEqual([['d9']]);
  });

  it('does not chain when nothing was sent or skipped', async () => {
    const d = deps();
    d.service.deliver.mockResolvedValueOnce({
      result: 'busy',
      webhookId: null,
    });
    await processWebhookJob(job('send', { deliveryId: 'd1' }), d);
    expect(d.repo.nextDue).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('never re-queues the delivery it just ran', async () => {
    const d = deps();
    d.repo.nextDue.mockResolvedValueOnce('d1');
    await processWebhookJob(job('send', { deliveryId: 'd1' }), d);
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it('a failed chain enqueue does not fail the send job', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const d = deps();
    d.queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      processWebhookJob(job('send', { deliveryId: 'd1' }), d),
    ).resolves.toEqual({ deliveryId: 'd1', result: 'delivered' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

  it('5 pending rows of one healthy webhook are all delivered with no sweep between', async () => {
    const t0 = new Date('2026-11-16T10:00:00Z');
    const repo = new MemoryWebhooksRepository();
    repo.addWebhook({
      id: 'w1',
      userId: 'u1',
      url: 'https://hooks.example.com/x',
      secret: 's',
    });
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5'];
    ids.forEach((id, i) => {
      repo.addDelivery({
        id,
        userId: 'u1',
        webhookId: 'w1',
        kind: 'test',
        createdAt: new Date(t0.getTime() - 1000 + i),
      });
    });
    const sent: string[] = [];
    const sender = async (i: SendInput): Promise<SendResult> => {
      // Yield, so jobs run at once overlap like real sends.
      await new Promise((r) => setTimeout(r, 1));
      sent.push(i.deliveryId);
      return { ok: true, status: 200 };
    };
    const service = new DeliveryService(
      repo,
      { webAppUrl: null },
      sender,
      () => t0,
    );
    // A queue that, like BullMQ, keeps one job per id.
    const waiting = new Set<string>();
    const queue = {
      enqueue: async (id: string) => {
        waiting.add(id);
      },
    };
    const run = { service, repo, queue, now: () => t0 };
    // The match step queued all five; they run 4 at a time, so most first come back busy.
    for (const id of ids) await queue.enqueue(id);
    const results: string[] = [];
    for (let round = 0; waiting.size > 0 && round < 20; round++) {
      const batch = [...waiting].slice(0, 4);
      batch.forEach((id) => waiting.delete(id));
      const done = await Promise.all(
        batch.map((id) =>
          processWebhookJob(job('send', { deliveryId: id }), run),
        ),
      );
      results.push(...done.map((r) => (r as { result: string }).result));
    }
    expect(results).toContain('busy');
    expect([...sent].sort()).toEqual(ids);
    for (const id of ids)
      expect(repo.deliveries.get(id)?.status).toBe('delivered');
  });

  it('a sweep lists one row per webhook', async () => {
    const t0 = new Date('2026-11-16T10:00:00Z');
    const repo = new MemoryWebhooksRepository();
    for (const w of ['w1', 'w2'])
      repo.addWebhook({
        id: w,
        userId: w,
        url: 'https://h.example.com',
        secret: 's',
      });
    let n = 0;
    const add = (id: string, webhookId: string) =>
      repo.addDelivery({
        id,
        userId: webhookId,
        webhookId,
        kind: 'test',
        createdAt: new Date(t0.getTime() - 1000 + n++),
      });
    add('a1', 'w1');
    add('b1', 'w2');
    add('a2', 'w1');
    add('b2', 'w2');
    const queue = {
      enqueue: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    };
    const service = { deliver: vi.fn() };
    expect(
      await processWebhookJob(job('sweep'), {
        service,
        repo,
        queue,
        now: () => t0,
      }),
    ).toMatchObject({ enqueued: 2 });
    expect(queue.enqueue.mock.calls).toEqual([['a1'], ['b1']]);
  });
});

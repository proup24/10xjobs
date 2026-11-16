const created = vi.hoisted(() => ({
  jobs: new Map<string, unknown>(),
  added: [] as unknown[][],
  defaults: [] as unknown[],
}));

// A queue that behaves like BullMQ 5 on job ids: `add` with an id that still exists is a no-op.
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    close = vi.fn(async () => undefined);
    constructor(_name: string, opts: { defaultJobOptions: unknown }) {
      created.defaults.push(opts.defaultJobOptions);
    }
    async add(name: string, data: unknown, opts: { jobId: string }) {
      created.added.push([name, data, opts]);
      if (created.jobs.has(opts.jobId)) return;
      created.jobs.set(opts.jobId, data);
    }
  }
  return { ...actual, Queue };
});

vi.mock('ioredis', () => ({
  Redis: class {
    on = vi.fn();
    disconnect = vi.fn();
  },
}));

import type { WebhookEnqueuer } from '../match/processor';
import { WEBHOOK_SEND_JOB, WebhookQueue } from './queue.service';

const settings = {
  url: 'redis://127.0.0.1:1',
  prefix: 'test',
  commandTimeoutMs: 1000,
} as never;

beforeEach(() => {
  created.added.length = 0;
  created.defaults.length = 0;
  created.jobs.clear();
});

describe('WebhookQueue', () => {
  it('queues a delivery under its own id, once, with one BullMQ attempt', async () => {
    const queue: WebhookEnqueuer = new WebhookQueue(settings);
    await queue.enqueue('d1');
    await queue.enqueue('d1');
    expect([...created.jobs.keys()]).toEqual(['d1']);
    expect(created.added[0]).toEqual([
      WEBHOOK_SEND_JOB,
      { deliveryId: 'd1' },
      { jobId: 'd1', removeOnComplete: true, removeOnFail: true },
    ]);
    expect(created.defaults[0]).toMatchObject({ attempts: 1 });
  });
});

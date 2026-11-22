const created = vi.hoisted(() => ({
  queues: [] as { name: string; opts: Record<string, unknown> }[],
  jobs: new Map<string, string>(),
  added: [] as unknown[][],
}));

// A queue that behaves like BullMQ on job ids: `add` with an id that still
// exists is a no-op, and a job's options say whether it is kept when done.
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    close = vi.fn(async () => undefined);
    constructor(
      readonly name: string,
      readonly opts: { defaultJobOptions?: Record<string, unknown> },
    ) {
      created.queues.push({ name, opts });
    }
    async add(
      name: string,
      data: unknown,
      opts: { jobId: string; removeOnComplete?: unknown },
    ) {
      created.added.push([name, data, opts]);
      if (created.jobs.has(opts.jobId)) return;
      created.jobs.set(opts.jobId, 'waiting');
    }
    /** Test helper: the worker finished the job. */
    complete(jobId: string) {
      const remove =
        (created.added.at(-1)?.[2] as { removeOnComplete?: unknown })
          ?.removeOnComplete ?? this.opts.defaultJobOptions?.removeOnComplete;
      if (remove === true) created.jobs.delete(jobId);
      else created.jobs.set(jobId, 'completed');
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

import type { ProcessorConfig } from 'src/modules/processor';
import { POST_PRIORITY, PROCESS_JOB, ProcessQueue } from './queue.service';

const config = { maxAttempts: 3 } as ProcessorConfig;
const settings = {
  url: 'redis://127.0.0.1:1',
  prefix: 'test',
  commandTimeoutMs: 1000,
} as never;

beforeEach(() => {
  created.queues.length = 0;
  created.added.length = 0;
  created.jobs.clear();
});

describe('ProcessQueue', () => {
  it('removes finished jobs, so the row is the only record', () => {
    new ProcessQueue(settings, config);
    expect(created.queues[0].opts).toMatchObject({
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
  });

  it('enqueues a job again once its previous run finished', async () => {
    const queue = new ProcessQueue(settings, config);
    await queue.enqueue('j1');
    (queue.queue as unknown as { complete(id: string): void }).complete('j1');
    await queue.enqueue('j1');
    expect(created.added).toEqual([
      [
        PROCESS_JOB,
        { jobId: 'j1' },
        { jobId: 'j1', removeOnComplete: true, removeOnFail: true },
      ],
      [
        PROCESS_JOB,
        { jobId: 'j1' },
        { jobId: 'j1', removeOnComplete: true, removeOnFail: true },
      ],
    ]);
    expect(created.jobs.get('j1')).toBe('waiting');
  });

  it('queues a post at a lower priority than a listing, which has none', async () => {
    const queue = new ProcessQueue(settings, config);
    await queue.enqueue('j1');
    await queue.enqueue('p1', 'post');
    expect(created.added).toEqual([
      [
        PROCESS_JOB,
        { jobId: 'j1' },
        { jobId: 'j1', removeOnComplete: true, removeOnFail: true },
      ],
      [
        PROCESS_JOB,
        { jobId: 'p1' },
        {
          jobId: 'p1',
          removeOnComplete: true,
          removeOnFail: true,
          priority: POST_PRIORITY,
        },
      ],
    ]);
    // BullMQ takes jobs with no priority before any prioritized job.
    expect(POST_PRIORITY).toBeGreaterThan(0);
  });
});

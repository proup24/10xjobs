const created = vi.hoisted(() => ({
  jobs: new Map<string, unknown>(),
  added: [] as unknown[][],
}));

// A queue that behaves like BullMQ 5 on job ids: `add` with an id that still
// exists is a no-op, and an id with one `:` is refused (job.js validateOptions).
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    close = vi.fn(async () => undefined);
    async add(name: string, data: unknown, opts: { jobId: string }) {
      if (opts.jobId.includes(':') && opts.jobId.split(':').length !== 3)
        throw new Error('Custom Id cannot contain :');
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

import { MATCH_JOB, MatchQueue } from './queue.service';

const settings = {
  url: 'redis://127.0.0.1:1',
  prefix: 'test',
  commandTimeoutMs: 1000,
} as never;

beforeEach(() => {
  created.added.length = 0;
  created.jobs.clear();
});

describe('MatchQueue', () => {
  it('deduplicates a job against a waiting one by job id', async () => {
    const queue = new MatchQueue(settings);
    await queue.enqueue('j1');
    await queue.enqueue('j1');
    expect([...created.jobs.keys()]).toEqual(['j1']);
    expect(created.added[0]).toEqual([
      MATCH_JOB,
      { jobId: 'j1', force: undefined },
      { jobId: 'j1', removeOnComplete: true, removeOnFail: true },
    ]);
  });

  it('a forced enqueue is not deduplicated against a waiting job', async () => {
    const queue = new MatchQueue(settings);
    await queue.enqueue('j1');
    await queue.enqueue('j1', { force: true });
    expect(created.jobs.get('j1')).toEqual({ jobId: 'j1', force: undefined });
    expect(created.jobs.get('j1-force')).toEqual({ jobId: 'j1', force: true });
  });
});

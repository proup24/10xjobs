import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.OPENROUTER_API_KEY ??= 'or-key';
  process.env.WORKER_ROLE = 'processor';
  delete process.env.WORKER_CHANNEL;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  queues: [] as string[],
  schedulers: [] as unknown[][],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  const done = vi.fn(async () => undefined);
  class Queue {
    on = vi.fn();
    waitUntilReady = done;
    add = done;
    close = done;
    constructor(readonly name: string) {
      created.queues.push(name);
    }
    async upsertJobScheduler(...args: unknown[]) {
      created.schedulers.push(args);
    }
  }
  class Worker {
    on = vi.fn();
    waitUntilReady = done;
    close = done;
    constructor(readonly name: string) {
      created.workers.push(name);
    }
  }
  return { ...actual, Queue, Worker };
});

const assertStructuredOutputs = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock(
  'src/modules/processor/models/openrouter.client',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    assertStructuredOutputs,
  }),
);

import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

it('runs only the processor queue with its sweeper after checking the model', async () => {
  const module = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(assertStructuredOutputs).toHaveBeenCalledTimes(1);
    expect(created.workers).toEqual(['process']);
    expect(created.schedulers.map(([id]) => id)).toEqual(['sweep']);
  } finally {
    await module.get(WorkerService).onApplicationShutdown();
    await module.close();
  }
});

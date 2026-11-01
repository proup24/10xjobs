import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.WORKER_ROLE = 'ingest';
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

import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

it('runs the ingest queue with its sweeper and ensures the batch bucket', async () => {
  const storage = new MemoryStorageService();
  const ensureBucket = vi.spyOn(storage, 'ensureBucket');
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(ensureBucket).toHaveBeenCalledWith('collection-batches');
    expect(created.workers).toEqual(['ingest']);
    expect(created.schedulers.map(([id]) => id)).toEqual(['sweep']);
  } finally {
    await module.get(WorkerService).onApplicationShutdown();
    await module.close();
  }
});

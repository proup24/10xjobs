import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.WORKER_CHANNEL = 'LINKEDIN_JOB_BOARD';
  process.env.APIFY_TOKEN ??= 'apify-token';
  delete process.env.WORKER_ROLE;
  delete process.env.XJOBS_RUN_SCHEDULES;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  process: undefined as
    | undefined
    | ((job: { name: string; data: unknown }) => Promise<unknown>),
  queues: [] as string[],
  schedulers: [] as unknown[][],
  removedSchedulers: [] as string[],
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
    async removeJobScheduler(id: string) {
      created.removedSchedulers.push(id);
      return true;
    }
  }
  class Worker {
    on = vi.fn();
    waitUntilReady = done;
    close = done;
    constructor(
      readonly name: string,
      processor: typeof created.process,
    ) {
      created.process = processor;
      created.workers.push(name);
    }
  }
  return { ...actual, Queue, Worker };
});

import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

it('starts the collection worker without a schedule when schedules are off', async () => {
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  try {
    const service = module.get(WorkerService);
    await service.onModuleInit();
    expect(service.active).toBe(true);
    expect(created.workers).toContain('collect-linkedin-job-board');
    expect(created.removedSchedulers).toContain('collect');
    expect(created.schedulers).toEqual([]);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

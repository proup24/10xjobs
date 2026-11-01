import { Test } from '@nestjs/testing';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.JOBS_CONCURRENCY = '7';
  delete process.env.WORKER_ROLE;
  delete process.env.WORKER_CHANNEL;
});

const created = vi.hoisted(() => ({
  workers: [] as { name: string; concurrency: number }[],
  process: undefined as
    | undefined
    | ((job: { name: string; data: unknown }) => Promise<unknown>),
  closeWorker: vi.fn(async () => undefined),
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    close = vi.fn(async () => undefined);
  }
  class Worker {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    close = created.closeWorker;
    constructor(
      readonly name: string,
      processor: typeof created.process,
      options: { concurrency: number },
    ) {
      created.process = processor;
      created.workers.push({ name, concurrency: options.concurrency });
    }
  }
  return { ...actual, Queue, Worker };
});

import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

it('defaults to the infrastructure worker and closes it on module shutdown', async () => {
  const storage = new MemoryStorageService();
  const ensureBucket = vi.spyOn(storage, 'ensureBucket');
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  try {
    const service = module.get(WorkerService);
    await service.onModuleInit();
    expect(service.active).toBe(true);
    expect(created.workers).toEqual([
      { name: 'infrastructure', concurrency: 7 },
    ]);
    expect(ensureBucket).not.toHaveBeenCalled();
    expect(
      await created.process?.({ name: 'ping', data: { token: 'worker-test' } }),
    ).toEqual({ token: 'worker-test', status: 'ok' });
  } finally {
    await module.close();
  }
  expect(created.closeWorker).toHaveBeenCalledExactlyOnceWith();
});

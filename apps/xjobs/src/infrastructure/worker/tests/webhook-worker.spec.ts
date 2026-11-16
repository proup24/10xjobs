import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.WORKER_ROLE = 'webhook';
  process.env.XJOBS_RUN_SCHEDULES = '1';
  delete process.env.WORKER_CHANNEL;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
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
    constructor(readonly name: string) {}
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

import { Logger } from '@nestjs/common';
import { WEBHOOK_QUEUE } from 'src/infrastructure/jobs/steps/webhook';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WebhookWorkerService } from '../webhook.service';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

afterAll(() => {
  delete process.env.WORKER_ROLE;
});

it('the webhook role starts the webhook worker and registers its sweep with schedules on', async () => {
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(created.workers).toEqual([WEBHOOK_QUEUE]);
    expect(created.schedulers).toEqual([
      ['sweep', { every: 60_000 }, { name: 'sweep', opts: { attempts: 1 } }],
    ]);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

describe('WebhookWorkerService.start', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  function setup(runSchedules: boolean) {
    const queue = {
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => true),
    };
    const runtime = {
      createQueue: vi.fn(async () => queue),
      startWorker: vi.fn(),
    };
    const service = new WebhookWorkerService(
      runtime as never,
      {} as never,
      {} as never,
      {} as never,
      runSchedules,
    );
    return { service, queue, runtime };
  }

  it('registers the sweep only when schedules are on, and runs 4 at a time', async () => {
    const on = setup(true);
    await on.service.start({} as never);
    expect(on.queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(on.runtime.startWorker).toHaveBeenCalledWith(
      WEBHOOK_QUEUE,
      expect.any(Function),
      4,
      expect.anything(),
    );

    const off = setup(false);
    await off.service.start({} as never);
    expect(off.queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(off.queue.removeJobScheduler).toHaveBeenCalledWith('sweep');
    expect(off.runtime.startWorker).toHaveBeenCalledTimes(1);
  });
});

import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.WORKER_CHANNEL = 'LINKEDIN_JOB_BOARD';
  process.env.APIFY_TOKEN ??= 'apify-token';
  delete process.env.WORKER_ROLE;
  process.env.XJOBS_RUN_SCHEDULES = '1';
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

import { Channel } from 'src/common/enums';
import {
  CollectionService,
  type ChannelJobConfig,
  channelJobsConfig,
} from 'src/infrastructure/jobs/steps/collect';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerRuntimeService } from '../runtime.service';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

beforeEach(() => {
  created.workers.length = 0;
  created.queues.length = 0;
  created.schedulers.length = 0;
  created.removedSchedulers.length = 0;
  created.process = undefined;
});

afterEach(() => vi.restoreAllMocks());

it('routes the scheduled collect job to the coordinator and rejects unknown jobs', async () => {
  const collect = vi.fn(async () => ({ batches: 1 }));
  const stop = vi.fn();
  const storage = new MemoryStorageService();
  const ensureBucket = vi.spyOn(storage, 'ensureBucket');
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(CollectionService)
    .useValue({ collect, stop })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(ensureBucket).toHaveBeenCalledWith('collection-batches');
    expect(created.workers).toEqual(['collect-linkedin-job-board']);
    const { schedule } = channelJobsConfig.LINKEDIN_JOB_BOARD;
    expect(created.schedulers).toEqual([
      [
        'collect',
        { pattern: schedule.pattern, tz: schedule.timezone },
        { name: 'collect', opts: { attempts: 1 } },
      ],
    ]);
    expect(await created.process?.({ name: 'collect', data: {} })).toEqual({
      batches: 1,
    });
    expect(collect).toHaveBeenCalledExactlyOnceWith(Channel.LINKEDIN_JOB_BOARD);
    await expect(
      created.process?.({ name: 'unknown', data: {} }),
    ).rejects.toThrow('Unsupported job');
    expect(collect).toHaveBeenCalledTimes(1);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('stops collection between segments before draining the workers', async () => {
  const order: string[] = [];
  const stop = vi.fn(() => order.push('stop'));
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(CollectionService)
    .useValue({ collect: vi.fn(), stop })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  const service = module.get(WorkerService);
  await service.onModuleInit();
  const runtime = module.get(WorkerRuntimeService);
  const close = runtime.close.bind(runtime);
  vi.spyOn(runtime, 'close').mockImplementation(async () => {
    order.push('close');
    await close();
  });
  await service.beforeApplicationShutdown();
  expect(order).toEqual(['stop', 'close']);
  await module.close();
});

it('removes a disabled channel schedule without starting any worker', async () => {
  const config: ChannelJobConfig = channelJobsConfig.LINKEDIN_JOB_BOARD;
  vi.spyOn(config, 'enabled', 'get').mockReturnValue(false);
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  try {
    const service = module.get(WorkerService);
    await service.onModuleInit();
    expect(service.active).toBe(false);
    expect(created.removedSchedulers).toEqual(['collect']);
    expect(created.schedulers).toEqual([]);
    expect(created.workers).toEqual([]);
  } finally {
    await module.close();
  }
});

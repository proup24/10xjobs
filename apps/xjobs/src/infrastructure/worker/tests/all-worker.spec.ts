import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.APIFY_TOKEN ??= 'apify-token';
  process.env.OPENROUTER_API_KEY ??= 'or-key';
  process.env.WORKER_ROLE = 'all';
  delete process.env.WORKER_CHANNEL;
  delete process.env.PROCESSOR_ENABLED;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  queues: [] as string[],
  schedulers: [] as string[],
  removedSchedulers: [] as string[],
  closedWorkers: [] as string[],
  closedQueues: [] as string[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    add = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      created.queues.push(name);
    }
    async close() {
      created.closedQueues.push(this.name);
    }
    async upsertJobScheduler(id: string) {
      created.schedulers.push(`${this.name}:${id}`);
    }
    async removeJobScheduler(id: string) {
      created.removedSchedulers.push(`${this.name}:${id}`);
      return true;
    }
  }
  class Worker {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      created.workers.push(name);
    }
    async close() {
      created.closedWorkers.push(this.name);
    }
  }
  return { ...actual, Queue, Worker };
});

import {
  type ChannelJobConfig,
  channelJobsConfig,
} from 'src/infrastructure/jobs/steps/collect';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
const checks = vi.hoisted(() => ({
  assertApiKey: vi.fn(async () => undefined),
  assertStructuredOutputs: vi.fn(async () => undefined),
  loadModelPricing: vi.fn(async () => new Map()),
}));
vi.mock(
  'src/modules/processor/models/openrouter.client',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { Logger } from '@nestjs/common';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

// PROCESSOR_ENABLED is unset: the processor is off in `all`.
const allWorkers = [
  'infrastructure',
  'ingest',
  'collect-linkedin-job-board',
  'collect-linkedin-posts',
  'collect-greenhouse',
  'collect-ashby',
];

beforeEach(() => {
  for (const list of Object.values(created)) list.length = 0;
});

afterEach(() => vi.restoreAllMocks());

// Other worker specs may share this process's environment.
afterAll(() => {
  delete process.env.WORKER_ROLE;
});

async function startAll() {
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  const service = module.get(WorkerService);
  await service.onModuleInit();
  return { module, service };
}

it('runs infrastructure, ingest and every channel collection, but not the processor, in one process', async () => {
  const log = vi.spyOn(Logger.prototype, 'log');
  const { module, service } = await startAll();
  try {
    expect(service.active).toBe(true);
    expect(created.workers).toEqual(allWorkers);
    expect(log).toHaveBeenCalledWith(
      'processor disabled (PROCESSOR_ENABLED=false)',
    );
    for (const check of Object.values(checks))
      expect(check).not.toHaveBeenCalled();
    expect(created.schedulers).toEqual([
      'ingest:sweep',
      'collect-linkedin-job-board:collect',
      'collect-linkedin-posts:collect',
      'collect-greenhouse:collect',
      'collect-ashby:collect',
    ]);
  } finally {
    // Closing the module runs the shutdown hook.
    await module.close();
  }
  expect(created.closedWorkers).toEqual(allWorkers);
  // Producer queues owned by other providers close with the module too.
  expect(created.closedQueues).toEqual(
    expect.arrayContaining(allWorkers.slice(1)),
  );
});

it('skips a disabled channel and keeps running the others', async () => {
  const config: ChannelJobConfig = channelJobsConfig.ASHBY;
  vi.spyOn(config, 'enabled', 'get').mockReturnValue(false);
  const { module, service } = await startAll();
  try {
    expect(service.active).toBe(true);
    expect(created.workers).toEqual(allWorkers.slice(0, -1));
    expect(created.removedSchedulers).toEqual(['collect-ashby:collect']);
  } finally {
    // Closing the module runs the shutdown hook.
    await module.close();
  }
});

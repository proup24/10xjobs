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
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  schedulers: [] as string[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    add = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    constructor(readonly name: string) {}
    async upsertJobScheduler(id: string) {
      created.schedulers.push(`${this.name}:${id}`);
    }
    async removeJobScheduler() {
      return true;
    }
  }
  class Worker {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      created.workers.push(name);
    }
  }
  return { ...actual, Queue, Worker };
});

const checks = vi.hoisted(() => ({
  assertApiKey: vi.fn(async () => undefined),
  checkModels: vi.fn(async () => new Map()),
}));
vi.mock(
  'src/modules/processor/models/client',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerRuntimeService } from '../runtime.service';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

beforeEach(() => {
  for (const list of Object.values(created)) list.length = 0;
  for (const check of Object.values(checks)) check.mockClear();
});

afterEach(() => vi.restoreAllMocks());

// Other worker specs may share this process's environment.
afterAll(() => {
  delete process.env.WORKER_ROLE;
});

async function build() {
  const module = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(StorageService)
    .useValue(new MemoryStorageService())
    .compile();
  const connect = vi.spyOn(module.get(WorkerRuntimeService), 'connect');
  return { module, connect, service: module.get(WorkerService) };
}

it('runs the processor with the others when the OpenRouter key is set', async () => {
  const { module, service } = await build();
  try {
    await service.onModuleInit();
    expect(checks.assertApiKey).toHaveBeenCalledTimes(1);
    expect(checks.checkModels).toHaveBeenCalledTimes(1);
    expect(created.workers).toEqual([
      'infrastructure',
      'ingest',
      'process',
      'collect-linkedin-job-board',
    ]);
    expect(created.schedulers).toContain('process:sweep');
  } finally {
    await module.close();
  }
});

it('runs the processor checks before any worker, so a failure starts nothing', async () => {
  checks.checkModels.mockRejectedValueOnce(
    new Error(
      'Model anthropic/claude-opus-5.5 does not support structured_outputs',
    ),
  );
  const { module, connect, service } = await build();
  try {
    await expect(service.onModuleInit()).rejects.toThrow(/structured_outputs/);
    expect(created.workers).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

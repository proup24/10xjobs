import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.APIFY_TOKEN ??= 'apify-token';
  process.env.CLAUDE_CODE_OAUTH_TOKEN ??= 'oauth';
  process.env.WORKER_ROLE = 'all';
  process.env.XJOBS_RUN_SCHEDULES = '1';
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
  checkClaudeInstalled: vi.fn(async (_bin?: string) => undefined),
  checkClaudeCall: vi.fn(async (_model: unknown): Promise<unknown> => null),
}));
vi.mock(
  'src/modules/processor/models/claude/startup',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { Logger } from '@nestjs/common';
import { ProcessorGuard } from 'src/modules/processor';
import { StorageService } from 'src/modules/storage';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { WorkerRuntimeService } from '../runtime.service';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

const everyWorker = [
  'infrastructure',
  'ingest',
  'process',
  'match',
  'rates',
  'collect-linkedin-job-board',
];

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

it('runs the processor with the others when a Claude credential is set', async () => {
  const { module, service } = await build();
  try {
    await service.onModuleInit();
    expect(checks.checkClaudeInstalled).toHaveBeenCalledTimes(1);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(1);
    expect(created.workers).toEqual(everyWorker);
    expect(module.get(ProcessorGuard).isPaused()).toBe(false);
    expect(created.schedulers).toContain('process:sweep');
    expect(created.schedulers).toContain('match:sweep');
    expect(created.schedulers).toContain('rates:refresh');
  } finally {
    await module.close();
  }
});

it('starts ingest, match and collection when the startup call fails, with the processor paused', async () => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  checks.checkClaudeCall.mockResolvedValueOnce({ kind: 'auth' });
  const { module, service } = await build();
  try {
    await service.onModuleInit();
    expect(created.workers).toEqual(everyWorker);
    expect(module.get(ProcessorGuard).pauseState()).toMatchObject({
      reason: 'startup',
    });
  } finally {
    await module.close();
  }
});

it('fails startup before any worker when claude is missing', async () => {
  checks.checkClaudeInstalled.mockRejectedValueOnce(
    new Error('could not run `claude --version`: spawn claude ENOENT'),
  );
  const { module, connect, service } = await build();
  try {
    await expect(service.onModuleInit()).rejects.toThrow(/ENOENT/);
    expect(created.workers).toEqual([]);
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

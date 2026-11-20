import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.APIFY_TOKEN ??= 'apify-token';
  // No Claude credential: `all` runs every worker except the processor.
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WORKER_ROLE = 'all';
  process.env.XJOBS_RUN_SCHEDULES = '1';
  delete process.env.WORKER_CHANNEL;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  queues: [] as string[],
  schedulers: [] as string[],
  removedSchedulers: [] as string[],
  added: [] as Array<{ queue: string; name: string; jobId?: string }>,
  closedWorkers: [] as string[],
  closedQueues: [] as string[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    async add(name: string, _data: unknown, opts?: { jobId?: string }) {
      created.added.push({ queue: this.name, name, jobId: opts?.jobId });
    }
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
  checkClaudeInstalled: vi.fn(async () => undefined),
  checkClaudeCall: vi.fn(async () => null),
}));
vi.mock(
  'src/modules/processor/models/claude/startup',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { Logger } from '@nestjs/common';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

// No Claude credential: the processor is off in `all`.
// The job board and posts collect; the other channels remove their schedules.
const allWorkers = [
  'infrastructure',
  'ingest',
  'match',
  'rates',
  'webhook',
  'collect-linkedin-job-board',
  'collect-linkedin-posts',
];
const inactiveSchedulers = [
  'collect-linkedin-job-board-cheap:collect',
  'collect-linkedin-job-board-bebity:collect',
  'collect-greenhouse:collect',
  'collect-ashby:collect',
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

it('runs infrastructure, ingest and every active channel collection, and the matcher, but not the processor, in one process', async () => {
  const warn = vi.spyOn(Logger.prototype, 'warn');
  const { module, service } = await startAll();
  try {
    expect(service.active).toBe(true);
    expect(created.workers).toEqual(allWorkers);
    expect(warn).toHaveBeenCalledWith(
      'processor not started: no Claude credential (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)',
    );
    for (const check of Object.values(checks))
      expect(check).not.toHaveBeenCalled();
    expect(created.schedulers).toEqual([
      'ingest:sweep',
      'match:sweep',
      'rates:refresh',
      'webhook:sweep',
      'collect-linkedin-job-board:collect',
      'collect-linkedin-posts:collect',
    ]);
    expect(created.removedSchedulers).toEqual(inactiveSchedulers);
    // Schedules on: one rates refresh at startup, under a fixed id.
    expect(created.added).toEqual([
      { queue: 'rates', name: 'refresh', jobId: 'refresh-on-start' },
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
  const config: ChannelJobConfig = channelJobsConfig.LINKEDIN_JOB_BOARD;
  vi.spyOn(config, 'enabled', 'get').mockReturnValue(false);
  const { module, service } = await startAll();
  try {
    expect(service.active).toBe(true);
    expect(created.workers).toEqual(
      allWorkers.filter((name) => name !== 'collect-linkedin-job-board'),
    );
    expect(created.removedSchedulers).toEqual([
      'collect-linkedin-job-board:collect',
      ...inactiveSchedulers,
    ]);
  } finally {
    // Closing the module runs the shutdown hook.
    await module.close();
  }
});

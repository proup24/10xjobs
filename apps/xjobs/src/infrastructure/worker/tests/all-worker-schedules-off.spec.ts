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
  delete process.env.XJOBS_RUN_SCHEDULES;
  delete process.env.WORKER_CHANNEL;
});

const created = vi.hoisted(() => ({
  workers: [] as string[],
  queues: [] as string[],
  schedulers: [] as string[],
  removedSchedulers: [] as string[],
  added: [] as string[],
  closedWorkers: [] as string[],
  closedQueues: [] as string[],
}));

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  class Queue {
    on = vi.fn();
    waitUntilReady = vi.fn(async () => undefined);
    async add(name: string) {
      created.added.push(`${this.name}:${name}`);
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

import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

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

it('registers no schedule and removes the old ones when schedules are off', async () => {
  const { module } = await startAll();
  try {
    expect(created.schedulers).toEqual([]);
    // Schedules off: no startup rates refresh either.
    expect(created.added).toEqual([]);
    expect(created.removedSchedulers).toEqual([
      'ingest:sweep',
      'match:sweep',
      'rates:refresh',
      'webhook:sweep',
      'collect-linkedin-job-board:collect',
      'collect-linkedin-job-board-cheap:collect',
      'collect-linkedin-job-board-bebity:collect',
      'collect-linkedin-posts:collect',
      'collect-greenhouse:collect',
      'collect-ashby:collect',
    ]);
    expect(created.workers).toEqual([
      'infrastructure',
      'ingest',
      'match',
      'rates',
      'webhook',
      'collect-linkedin-job-board',
      'collect-linkedin-posts',
    ]);
  } finally {
    await module.close();
  }
});

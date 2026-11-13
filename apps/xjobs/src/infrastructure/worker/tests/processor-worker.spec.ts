import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.OPENROUTER_API_KEY ??= 'or-key';
  process.env.WORKER_ROLE = 'processor';
  process.env.XJOBS_RUN_SCHEDULES = '1';
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

const checks = vi.hoisted(() => ({
  assertApiKey: vi.fn(async (_client: unknown) => undefined),
  checkModels: vi.fn(
    async (_client: unknown, config: { extractionModel: string }) =>
      new Map([
        [config.extractionModel, { prompt: 0.000001, completion: 0.000002 }],
      ]),
  ),
}));
vi.mock('src/modules/processor/models/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...checks,
}));

import { ModelPricing } from 'src/modules/processor';
import { OPENROUTER_CLIENT } from 'src/modules/processor/models/client';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

beforeEach(() => {
  for (const list of Object.values(created)) list.length = 0;
  for (const check of Object.values(checks)) check.mockClear();
});

it('runs only the processor queue with its sweeper after the startup checks', async () => {
  const module = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  try {
    await module.get(WorkerService).onModuleInit();
    const client = module.get(OPENROUTER_CLIENT);
    expect(checks.assertApiKey).toHaveBeenCalledWith(client);
    expect(checks.checkModels).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        extractionModel: 'deepseek/deepseek-v4.1-flash-1017',
      }),
    );
    expect(
      module.get(ModelPricing).get('deepseek/deepseek-v4.1-flash-1017'),
    ).toEqual({
      prompt: 0.000001,
      completion: 0.000002,
    });
    expect(created.workers).toEqual(['process']);
    expect(created.schedulers.map(([id]) => id)).toEqual(['sweep']);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('refuses to start when a model has no pricing', async () => {
  checks.checkModels.mockRejectedValueOnce(
    new Error(
      'OpenRouter lists no numeric pricing for model anthropic/claude-opus-5.5',
    ),
  );
  const module = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  try {
    await expect(module.get(WorkerService).onModuleInit()).rejects.toThrow(
      /pricing/,
    );
    expect(created.workers).toEqual([]);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('refuses to start when the key is rejected', async () => {
  checks.assertApiKey.mockRejectedValueOnce(
    new Error('OpenRouter rejected OPENROUTER_API_KEY'),
  );
  const module = await Test.createTestingModule({
    imports: [WorkerModule],
  }).compile();
  try {
    await expect(module.get(WorkerService).onModuleInit()).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
    expect(created.workers).toEqual([]);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

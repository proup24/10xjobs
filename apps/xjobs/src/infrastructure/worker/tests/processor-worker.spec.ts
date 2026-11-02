import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.OPENROUTER_API_KEY ??= 'or-key';
  process.env.WORKER_ROLE = 'processor';
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
  assertApiKey: vi.fn(async () => undefined),
  assertStructuredOutputs: vi.fn(async () => undefined),
  loadModelPricing: vi.fn(
    async (models: string[]) =>
      new Map(
        models.map((m) => [m, { prompt: 0.000001, completion: 0.000002 }]),
      ),
  ),
}));
vi.mock(
  'src/modules/processor/models/openrouter.client',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { ModelPricing } from 'src/modules/processor';
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
    expect(checks.assertApiKey).toHaveBeenCalledWith(
      process.env.OPENROUTER_API_KEY,
    );
    expect(checks.assertStructuredOutputs).toHaveBeenCalledWith(
      'anthropic/claude-opus-5.5',
    );
    expect(checks.loadModelPricing).toHaveBeenCalledWith([
      'typesafe/jev-1.14',
      'anthropic/claude-opus-5.5',
    ]);
    expect(module.get(ModelPricing).get('typesafe/jev-1.14')).toEqual({
      prompt: 0.000001,
      completion: 0.000002,
    });
    expect(created.workers).toEqual(['process']);
    expect(created.schedulers.map(([id]) => id)).toEqual(['sweep']);
  } finally {
    await module.get(WorkerService).onApplicationShutdown();
    await module.close();
  }
});

it('refuses to start when a model has no pricing', async () => {
  checks.loadModelPricing.mockRejectedValueOnce(
    new Error(
      'OpenRouter lists no numeric pricing for model typesafe/jev-1.14',
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
    await module.get(WorkerService).onApplicationShutdown();
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
    await module.get(WorkerService).onApplicationShutdown();
    await module.close();
  }
});

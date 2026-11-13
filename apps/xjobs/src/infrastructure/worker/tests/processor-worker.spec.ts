import { Test } from '@nestjs/testing';

// The worker module validates the environment when it is imported.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-key';
  process.env.CLAUDE_CODE_OAUTH_TOKEN ??= 'oauth';
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
  checkClaudeInstalled: vi.fn<(bin?: string) => Promise<void>>(
    async () => undefined,
  ),
  checkClaudeCall: vi.fn<(model: unknown) => Promise<unknown>>(
    async () => null,
  ),
}));
vi.mock(
  'src/modules/processor/models/claude/startup',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    ...checks,
  }),
);

import { Logger } from '@nestjs/common';
import {
  CLAUDE_BIN,
  ExtractionModel,
  ProcessorGuard,
} from 'src/modules/processor';
import { ProcessorWorkerService } from '../processor.service';
import { WorkerModule } from '../worker.module';
import { WorkerService } from '../worker.service';

beforeEach(() => {
  for (const list of Object.values(created)) list.length = 0;
  for (const check of Object.values(checks)) check.mockClear();
});

afterEach(() => vi.restoreAllMocks());

async function build() {
  return Test.createTestingModule({ imports: [WorkerModule] }).compile();
}

it('runs only the processor queue with its sweeper after the startup checks', async () => {
  const log = vi.spyOn(Logger.prototype, 'log');
  const module = await build();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(checks.checkClaudeInstalled).toHaveBeenCalledWith(
      module.get(CLAUDE_BIN),
    );
    expect(checks.checkClaudeCall).toHaveBeenCalledWith(
      module.get(ExtractionModel),
    );
    expect(log).toHaveBeenCalledWith('processor ready');
    expect(module.get(ProcessorGuard).isPaused()).toBe(false);
    expect(created.workers).toEqual(['process']);
    expect(created.schedulers.map(([id]) => id)).toEqual(['sweep']);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('refuses to start when claude is missing or at another version', async () => {
  checks.checkClaudeInstalled.mockRejectedValueOnce(
    new Error(
      'Claude Code 2.1.300 is installed; the processor needs exactly 2.1.314',
    ),
  );
  const module = await build();
  try {
    await expect(module.get(WorkerService).onModuleInit()).rejects.toThrow(
      /2\.1\.314/,
    );
    expect(checks.checkClaudeCall).not.toHaveBeenCalled();
    expect(created.workers).toEqual([]);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('starts paused when the startup call fails, then rechecks every 10 minutes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const error = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  checks.checkClaudeCall.mockResolvedValueOnce({ kind: 'auth' });
  checks.checkClaudeCall.mockResolvedValueOnce({
    kind: 'transient',
    reason: 'claude call timed out',
  });
  const module = await build();
  try {
    await module.get(WorkerService).onModuleInit();
    const guard = module.get(ProcessorGuard);
    expect(created.workers).toEqual(['process']);
    expect(guard.pauseState()).toMatchObject({ reason: 'startup' });
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/\(startup\).*claude setup-token/),
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(2);
    expect(guard.pauseState()).toMatchObject({
      reason: 'startup',
      detail: expect.stringContaining('timed out'),
    });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(3);
    expect(guard.isPaused()).toBe(false);

    // Passed: no further rechecks.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(3);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
    vi.useRealTimers();
  }
});

it('stays paused while a recheck call is still running', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  let finish!: (failure: unknown) => void;
  checks.checkClaudeCall.mockResolvedValueOnce({ kind: 'auth' });
  checks.checkClaudeCall.mockImplementationOnce(
    () => new Promise((done) => (finish = done)),
  );
  const module = await build();
  try {
    await module.get(WorkerService).onModuleInit();
    const guard = module.get(ProcessorGuard);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(2);
    // The call may take up to the call timeout; the pause outlasts it.
    await vi.advanceTimersByTimeAsync(170_000);
    expect(guard.pauseState()).toMatchObject({
      reason: 'startup',
      detail: expect.stringContaining('claude setup-token'),
    });
    finish(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(guard.isPaused()).toBe(false);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
    vi.useRealTimers();
  }
});

it('waits for the startup call before starting the processor worker', async () => {
  let finish!: (failure: unknown) => void;
  checks.checkClaudeCall.mockImplementationOnce(
    () => new Promise((done) => (finish = done)),
  );
  const module = await build();
  try {
    const init = module.get(WorkerService).onModuleInit();
    await vi.waitFor(() =>
      expect(checks.checkClaudeCall).toHaveBeenCalledTimes(1),
    );
    expect(module.get(ProcessorGuard).pauseState()).toMatchObject({
      reason: 'startup',
    });
    expect(created.workers).toEqual([]);
    finish(null);
    await init;
    expect(created.workers).toEqual(['process']);
    expect(module.get(ProcessorGuard).isPaused()).toBe(false);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
  }
});

it('pauses until the reset on a usage limit at startup, without rechecking', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const resetsAt = new Date(Date.now() + 3 * 60 * 60_000);
  checks.checkClaudeCall.mockResolvedValueOnce({
    kind: 'usage_limit',
    limit: { kind: 'five_hour', status: 'rejected', utilization: 1, resetsAt },
  });
  const module = await build();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(module.get(ProcessorGuard).pauseState()).toMatchObject({
      reason: 'usage_limit',
      until: resetsAt,
    });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(1);
  } finally {
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
    vi.useRealTimers();
  }
});

it('clears the recheck timer when the module is destroyed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  checks.checkClaudeCall.mockResolvedValue({ kind: 'auth' });
  const module = await build();
  try {
    await module.get(WorkerService).onModuleInit();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    module.get(ProcessorWorkerService).onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(checks.checkClaudeCall).toHaveBeenCalledTimes(1);
  } finally {
    checks.checkClaudeCall.mockReset();
    checks.checkClaudeCall.mockResolvedValue(null);
    await module.get(WorkerService).beforeApplicationShutdown();
    await module.close();
    vi.useRealTimers();
  }
});

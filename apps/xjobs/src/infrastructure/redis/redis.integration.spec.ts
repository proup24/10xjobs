import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { getRedisConfig, validateWorkerEnvironment } from 'src/config';
import { RedisConnections } from './connections';
import { CacheService } from './cache.service';
import { PubSubService } from './pubsub.service';
import { JobsService } from '../jobs/jobs.service';

const enabled = process.env.REDIS_INTEGRATION === '1';

describe.skipIf(!enabled)('live Redis and separate worker', () => {
  const settings = getRedisConfig(
    new ConfigService(
      validateWorkerEnvironment({
        ...process.env,
        REDIS_PREFIX: `test-${randomUUID()}`,
      }),
    ),
  );
  let connections: RedisConnections;
  let cache: CacheService;
  let pubsub: PubSubService;
  let jobs: JobsService;
  let events: QueueEvents;
  let eventRedis: Redis;
  let child: ChildProcess;
  let output = '';

  beforeAll(async () => {
    connections = new RedisConnections(settings);
    cache = new CacheService(connections, settings);
    pubsub = new PubSubService(connections, settings);
    await connections.publisher.ping();
    await connections.cache.ping();
    jobs = new JobsService(settings);
    await jobs.queue.waitUntilReady();
    eventRedis = new Redis(settings.url, { maxRetriesPerRequest: null });
    events = new QueueEvents('infrastructure', {
      connection: eventRedis,
      prefix: settings.prefix,
    });
    await events.waitUntilReady();
    child = spawn(
      process.execPath,
      [resolve(__dirname, '../../../dist/worker.js')],
      {
        // Deliberately omit API credentials and avoid loading developer env files.
        env: {
          PATH: process.env.PATH,
          XJOBS_SKIP_ENV_FILES: '1',
          REDIS_URL: settings.url,
          REDIS_PREFIX: settings.prefix,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (data) => {
      output += String(data);
    });
    child.stderr?.on('data', (data) => {
      output += String(data);
    });
    await vi.waitFor(
      () => {
        expect(output, `Worker exited=${child.exitCode}: ${output}`).toContain(
          'Worker ready',
        );
      },
      { timeout: 15000 },
    );
  }, 20000);

  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await events?.close();
    eventRedis?.disconnect();
    if (jobs) {
      await jobs.queue.obliterate({ force: true });
      await jobs.onApplicationShutdown();
    }
    pubsub?.onModuleDestroy();
    connections?.onApplicationShutdown();
  }, 15000);

  it('expires cache values and invalidates them', async () => {
    await cache.set('ws:1:entry', { id: 1 }, 1);
    expect(await cache.get('ws:1:entry')).toEqual({ id: 1 });
    await vi.waitFor(
      async () => expect(await cache.get('ws:1:entry')).toBeNull(),
      { timeout: 2500 },
    );
    await cache.set('ws:1:entry', 2);
    await cache.delete('ws:1:entry');
    expect(await cache.get('ws:1:entry')).toBeNull();
  });

  it('delivers across connections, isolates bad messages/listeners, and unsubscribes', async () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    const [off1, off2, offBad] = await Promise.all([
      pubsub.subscribe('ws:1:changed', (message) => {
        first.push(message);
      }),
      pubsub.subscribe('ws:1:changed', (message) => {
        second.push(message);
      }),
      pubsub.subscribe('ws:1:changed', () => {
        throw new Error('bad handler');
      }),
    ]);
    await connections.publisher.publish(
      `${settings.prefix}:events:ws:1:changed`,
      'bad json',
    );
    await pubsub.publish('ws:1:changed', { version: 1 });
    await vi.waitFor(() => expect(second).toEqual([{ version: 1 }]));
    expect(first).toEqual([{ version: 1 }]);
    await off1();
    await pubsub.publish('ws:1:changed', { version: 2 });
    await vi.waitFor(() => expect(second).toHaveLength(2));
    expect(first).toHaveLength(1);
    await Promise.all([off1(), off2(), offBad()]);
    expect(await pubsub.publish('ws:1:changed', { version: 3 })).toBe(0);
  });

  it('executes jobs in the compiled worker process', async () => {
    const job = await jobs.enqueuePing('separate-process');
    expect(await job.waitUntilFinished(events, 10000)).toEqual({
      token: 'separate-process',
      status: 'ok',
    });
  });

  it('rejects enqueue promptly when Redis was unavailable at startup', async () => {
    const offline = new JobsService({
      ...settings,
      url: 'redis://127.0.0.1:1',
      commandTimeoutMs: 100,
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        offline.enqueuePing('offline').then(
          () => 'enqueued',
          () => 'rejected',
        ),
        new Promise<string>((resolve) => {
          timeout = setTimeout(() => resolve('hung'), 500);
        }),
      ]);
      expect(outcome).toBe('rejected');
    } finally {
      clearTimeout(timeout);
      await offline.onApplicationShutdown();
    }
  });

  it('fails unknown jobs without retrying', async () => {
    const job = await jobs.queue.add('unknown', {});
    await expect(job.waitUntilFinished(events, 10000)).rejects.toThrow(
      'Unsupported job',
    );
    expect((await jobs.queue.getJob(job.id ?? ''))?.attemptsMade).toBe(1);
  });

  it('retries transient processor failures with the producer defaults', async () => {
    // A separate prefix prevents the infrastructure worker from consuming this job.
    const retrySettings = { ...settings, prefix: `${settings.prefix}-retry` };
    const producer = new JobsService(retrySettings);
    const connection = new Redis(settings.url, { maxRetriesPerRequest: null });
    const retryEvents = new QueueEvents('infrastructure', {
      connection,
      prefix: retrySettings.prefix,
    });
    let attempts = 0;
    const worker = new Worker(
      'infrastructure',
      async () => {
        if (++attempts < 3) throw new Error('transient');
        return 'recovered';
      },
      { connection, prefix: retrySettings.prefix },
    );
    try {
      await Promise.all([
        retryEvents.waitUntilReady(),
        producer.queue.waitUntilReady(),
      ]);
      const job = await producer.enqueuePing('retry');
      expect(await job.waitUntilFinished(retryEvents, 15000)).toBe('recovered');
      expect(attempts).toBe(3);
    } finally {
      await worker.close();
      await retryEvents.close();
      connection.disconnect();
      await producer.queue.obliterate({ force: true });
      await producer.onApplicationShutdown();
    }
  }, 20000);

  it('stops the separate worker cleanly on SIGTERM', async () => {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    expect(code === 0 || signal === 'SIGTERM').toBe(true);
    expect(output).toContain('Worker stopped');
  }, 10000);
});

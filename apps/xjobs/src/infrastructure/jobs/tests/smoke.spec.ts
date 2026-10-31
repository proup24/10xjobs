import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import {
  getRedisConfig,
  validateWorkerEnvironment,
  loadApplicationEnvironment,
} from '../../../config';
import { INFRASTRUCTURE_QUEUE, JobsService } from '../jobs.service';

// Opt-in check against an already running worker; normal unit runs stay offline.
it.skipIf(process.env.JOBS_SMOKE !== '1')(
  'a running worker executes a smoke job',
  async () => {
    loadApplicationEnvironment();
    const settings = getRedisConfig(
      new ConfigService(validateWorkerEnvironment(process.env)),
    );
    const producer = new JobsService(settings);
    const connection = new Redis(settings.url, { maxRetriesPerRequest: null });
    connection.on('error', () => undefined);
    const events = new QueueEvents(INFRASTRUCTURE_QUEUE, {
      connection,
      prefix: settings.prefix,
    });
    events.on('error', () => undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([producer.queue.waitUntilReady(), events.waitUntilReady()]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis startup timed out')),
            5000,
          );
        }),
      ]);
      const token = randomUUID();
      const job = await producer.enqueuePing(token);
      expect(await job.waitUntilFinished(events, 10000)).toEqual({
        token,
        status: 'ok',
      });
    } finally {
      clearTimeout(timeout);
      await events.close();
      connection.disconnect();
      await producer.onApplicationShutdown();
    }
  },
  20000,
);

import type { Queue } from 'bullmq';
import {
  COLLECT_JOB,
  type ChannelJobConfig,
} from 'src/infrastructure/jobs/steps/collect';
import { SWEEP_JOB } from 'src/infrastructure/jobs/steps/ingest/queue.service';
import {
  PROCESS_SWEEP_JOB,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import { ingestConfig } from 'src/modules/ingest';

/** Makes the queue's cron scheduler match the channel's config; idempotent. */
export async function syncCollectionScheduler(
  queue: Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>,
  config: ChannelJobConfig,
): Promise<'scheduled' | 'removed'> {
  if (!config.enabled) {
    await queue.removeJobScheduler(COLLECT_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    COLLECT_JOB,
    { pattern: config.schedule.pattern, tz: config.schedule.timezone },
    { name: COLLECT_JOB, opts: { attempts: config.attempts } },
  );
  return 'scheduled';
}

/** Re-enqueues stranded pending batches on a fixed interval; idempotent. */
export async function syncSweepScheduler(
  queue: Pick<Queue, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    SWEEP_JOB,
    { every: ingestConfig.sweepEveryMs },
    { name: SWEEP_JOB, opts: { attempts: 1 } },
  );
}

/** Releases stale claims and re-enqueues pending jobs on an interval; idempotent. */
export async function syncProcessSweepScheduler(
  queue: Pick<Queue, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    PROCESS_SWEEP_JOB,
    { every: processSweepConfig.everyMs },
    { name: PROCESS_SWEEP_JOB, opts: { attempts: 1 } },
  );
}

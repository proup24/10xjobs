import type { Queue } from 'bullmq';
import {
  COLLECT_JOB,
  type ChannelJobConfig,
} from 'src/infrastructure/jobs/steps/collect';
import { SWEEP_JOB } from 'src/infrastructure/jobs/steps/ingest/queue.service';
import {
  MATCH_SWEEP,
  MATCH_SWEEP_JOB,
} from 'src/infrastructure/jobs/steps/match';
import {
  PROCESS_SWEEP_JOB,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import { ingestConfig } from 'src/modules/ingest';

type SchedulerQueue = Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>;

/** Nest injection token: whether this process registers schedulers (XJOBS_RUN_SCHEDULES). */
export const RUN_SCHEDULES = Symbol('RUN_SCHEDULES');

/** Makes the queue's cron scheduler match the channel's config; idempotent. */
export async function syncCollectionScheduler(
  queue: SchedulerQueue,
  config: ChannelJobConfig,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!config.enabled || !run) {
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
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(SWEEP_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    SWEEP_JOB,
    { every: ingestConfig.sweepEveryMs },
    { name: SWEEP_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

/** Releases stale claims and re-enqueues pending jobs on an interval; idempotent. */
export async function syncProcessSweepScheduler(
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(PROCESS_SWEEP_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    PROCESS_SWEEP_JOB,
    { every: processSweepConfig.everyMs },
    { name: PROCESS_SWEEP_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

/** Deletes matches of inactive jobs and re-enqueues stale ones on an interval; idempotent. */
export async function syncMatchSweepScheduler(
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(MATCH_SWEEP_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    MATCH_SWEEP_JOB,
    { every: MATCH_SWEEP.everyMs },
    { name: MATCH_SWEEP_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

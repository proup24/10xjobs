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
  AUTO_SILENCE_JOB,
  PROCESS_SWEEP_JOB,
  autoSilenceConfig,
  processSweepConfig,
} from 'src/infrastructure/jobs/steps/process';
import { RATES_REFRESH_JOB } from 'src/infrastructure/jobs/steps/rates';
import { WEBHOOK_SWEEP_JOB } from 'src/infrastructure/jobs/steps/webhook';
import { ingestConfig } from 'src/modules/ingest';
import { RATES_REFRESH } from 'src/modules/rates';
import { WEBHOOK_CONFIG } from 'src/modules/webhooks';

type SchedulerQueue = Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>;

/** Nest injection token: whether this process registers schedulers (XJOBS_RUN_SCHEDULES). */
export const RUN_SCHEDULES = Symbol('RUN_SCHEDULES');

/** Nest injection token: whether collection workers enqueue one run at startup (NODE_ENV=development). */
export const COLLECT_ON_START = Symbol('COLLECT_ON_START');

/** Job id of the startup run; a fixed id keeps restarts from stacking runs. */
export const COLLECT_ON_START_JOB_ID = 'collect-on-start';

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

/** Returns stuck deliveries, applies retention and re-enqueues due ones on an interval; idempotent. */
export async function syncWebhookSweepScheduler(
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(WEBHOOK_SWEEP_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    WEBHOOK_SWEEP_JOB,
    { every: WEBHOOK_CONFIG.sweep.everyMs },
    { name: WEBHOOK_SWEEP_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

/** Refreshes the exchange rates daily at 03:00 UTC; idempotent. */
export async function syncRatesRefreshScheduler(
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(RATES_REFRESH_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    RATES_REFRESH_JOB,
    { pattern: RATES_REFRESH.pattern, tz: RATES_REFRESH.timezone },
    { name: RATES_REFRESH_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

/** Runs automatic silencing (a dry run while it is off) daily at 04:00 UTC; idempotent. */
export async function syncAutoSilenceScheduler(
  queue: SchedulerQueue,
  run: boolean,
): Promise<'scheduled' | 'removed'> {
  if (!run) {
    await queue.removeJobScheduler(AUTO_SILENCE_JOB);
    return 'removed';
  }
  await queue.upsertJobScheduler(
    AUTO_SILENCE_JOB,
    { pattern: autoSilenceConfig.pattern, tz: autoSilenceConfig.timezone },
    { name: AUTO_SILENCE_JOB, opts: { attempts: 1 } },
  );
  return 'scheduled';
}

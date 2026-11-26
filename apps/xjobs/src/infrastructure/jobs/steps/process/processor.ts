import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import type {
  ProcessorConfig,
  ProcessorRepository,
} from 'src/modules/processor';
import type { MatchQueue } from '../match';
import { processSweepConfig } from './config';
import {
  AUTO_SILENCE_JOB,
  PROCESS_JOB,
  PROCESS_SWEEP_JOB,
  type ProcessQueue,
} from './queue.service';
import type { AutoSilenceService } from 'src/modules/processor/services/auto-silence.service';
import { ProcessorService } from 'src/modules/processor/services/processor.service';
import type { PrefilterService } from 'src/modules/prefilter/services/prefilter.service';

const logger = new Logger('ProcessJob');

const jobPayload = z.object({ jobId: z.string().min(1) });

export interface ProcessJobDeps {
  service: Pick<ProcessorService, 'process' | 'isPaused' | 'isPostCapReached'>;
  repo: Pick<
    ProcessorRepository,
    | 'listPendingInScope'
    | 'listPendingPosts'
    | 'releaseStale'
    | 'spendSince'
    | 'listRoleJobIds'
  >;
  queue: Pick<ProcessQueue, 'enqueue'>;
  matchQueue: Pick<MatchQueue, 'enqueue'>;
  autoSilence: Pick<AutoSilenceService, 'run'>;
  /** Skips the listings no published profile could take, before any claim. */
  prefilter: Pick<
    PrefilterService,
    'skipPending' | 'skipJob' | 'recheckProfiles'
  >;
  config: ProcessorConfig;
}

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Runs one job of the `process` queue: a job to process, or a sweep. */
export async function processProcessJob(
  job: { name: string; data: unknown },
  deps: ProcessJobDeps,
): Promise<unknown> {
  if (job.name === PROCESS_JOB) {
    const payload = jobPayload.safeParse(job.data);
    if (!payload.success)
      throw new UnrecoverableError('Invalid process-job payload');
    // An ingest nudge reaches here before any sweep: check before the claim.
    // A demand that cannot be read throws, so BullMQ retries and nothing is skipped.
    if (await deps.prefilter.skipJob(payload.data.jobId))
      return { outcome: 'skipped' };
    const outcome = await deps.service.process(payload.data.jobId);
    // Throwing lets BullMQ back off and retry.
    if (outcome === 'retry') throw new Error('retry');
    // Only a job with fresh processed fields has something new to match.
    // The database is the truth and the match sweep heals a missed nudge.
    if (outcome === 'processed' || outcome === 'reused') {
      try {
        await deps.matchQueue.enqueue(payload.data.jobId);
      } catch (err) {
        logger.warn(
          `Could not enqueue match for job ${payload.data.jobId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // A post's roles are matched like jobs; a listing has none.
      let roleIds: string[] = [];
      try {
        roleIds = await deps.repo.listRoleJobIds(payload.data.jobId);
      } catch (err) {
        logger.warn(
          `Could not list role jobs of ${payload.data.jobId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      for (const roleId of roleIds) {
        try {
          await deps.matchQueue.enqueue(roleId);
        } catch (err) {
          logger.warn(
            `Could not enqueue match for role job ${roleId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return { outcome };
  }
  if (job.name === PROCESS_SWEEP_JOB) {
    const now = new Date();
    const released = await deps.repo.releaseStale(
      new Date(now.getTime() - deps.config.claimTimeoutMs),
    );
    // Skipping costs no model call, so it runs while paused or over budget too.
    // It lists only listings that could be skipped, so the first batch of the
    // claim order may pass unchecked; correctness past it rests on `skipJob`
    // in PROCESS_JOB. A failure fails the sweep before any claim.
    // First, jobs skipped in the last 24 hours go back when a profile changed.
    await deps.prefilter.recheckProfiles(now);
    const prefilter = await deps.prefilter.skipPending(
      processSweepConfig.limit,
    );
    // Paused after a key, credit or account error: jobs would only bounce.
    if (deps.service.isPaused())
      return { released, skipped: prefilter.skipped, enqueued: 0 };
    const spent = await deps.repo.spendSince(startOfUtcDay(now));
    if (deps.config.dailyBudgetUsd > 0 && spent >= deps.config.dailyBudgetUsd)
      return { released, skipped: prefilter.skipped, enqueued: 0 };
    // Posts go at their lower queue priority, so a listing queued after them
    // (by this sweep or a later ingest nudge) is still taken first. Posts get
    // the same limit, and none are listed while the daily post cap is
    // reached, so they are not claimed and bounced every minute.
    const listings = await deps.repo.listPendingInScope(
      processSweepConfig.limit,
    );
    const posts = (await deps.service.isPostCapReached())
      ? []
      : await deps.repo.listPendingPosts(processSweepConfig.limit);
    for (const jobId of listings) await deps.queue.enqueue(jobId);
    for (const jobId of posts) await deps.queue.enqueue(jobId, 'post');
    return {
      released,
      skipped: prefilter.skipped,
      enqueued: listings.length + posts.length,
    };
  }
  if (job.name === AUTO_SILENCE_JOB) return deps.autoSilence.run();
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}

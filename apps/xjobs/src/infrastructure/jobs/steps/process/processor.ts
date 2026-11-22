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

const logger = new Logger('ProcessJob');

const jobPayload = z.object({ jobId: z.string().min(1) });

export interface ProcessJobDeps {
  service: Pick<ProcessorService, 'process' | 'isPaused' | 'isPostCapReached'>;
  repo: Pick<
    ProcessorRepository,
    'listPendingInScope' | 'listPendingPosts' | 'releaseStale' | 'spendSince'
  >;
  queue: Pick<ProcessQueue, 'enqueue'>;
  matchQueue: Pick<MatchQueue, 'enqueue'>;
  autoSilence: Pick<AutoSilenceService, 'run'>;
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
    }
    return { outcome };
  }
  if (job.name === PROCESS_SWEEP_JOB) {
    const now = new Date();
    const released = await deps.repo.releaseStale(
      new Date(now.getTime() - deps.config.claimTimeoutMs),
    );
    // Paused after a key, credit or account error: jobs would only bounce.
    if (deps.service.isPaused()) return { released, enqueued: 0 };
    const spent = await deps.repo.spendSince(startOfUtcDay(now));
    if (deps.config.dailyBudgetUsd > 0 && spent >= deps.config.dailyBudgetUsd)
      return { released, enqueued: 0 };
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
    return { released, enqueued: listings.length + posts.length };
  }
  if (job.name === AUTO_SILENCE_JOB) return deps.autoSilence.run();
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}

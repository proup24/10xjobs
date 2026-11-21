import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import type { MatcherRepository, MatcherService } from 'src/modules/matcher';
import type { ProfileSearchSync } from 'src/modules/users';
import { describeError } from 'src/utils';
import { MATCH_SWEEP } from './config';
import { MATCH_JOB, MATCH_SWEEP_JOB, type MatchQueue } from './queue.service';

const jobPayload = z.object({
  jobId: z.string().min(1),
  force: z.boolean().optional(),
});

/** What the matcher needs of the webhook queue. */
export type WebhookEnqueuer = { enqueue(deliveryId: string): Promise<void> };

const logger = new Logger('MatchProcessor');

export interface MatchJobDeps {
  service: Pick<MatcherService, 'matchJob'>;
  repo: Pick<MatcherRepository, 'listStaleJobs' | 'deleteInactive'>;
  searches: Pick<ProfileSearchSync, 'applyPending'>;
  queue: Pick<MatchQueue, 'enqueue'>;
  webhooks: WebhookEnqueuer;
}

/** Runs one job of the `match` queue: a job to match, or a sweep. */
export async function processMatchJob(
  job: { name: string; data: unknown },
  deps: MatchJobDeps,
): Promise<unknown> {
  if (job.name === MATCH_JOB) {
    const payload = jobPayload.safeParse(job.data);
    if (!payload.success)
      throw new UnrecoverableError('Invalid match-job payload');
    const outcome = await deps.service.matchJob(payload.data.jobId, {
      force: payload.data.force,
    });
    if (outcome.status === 'matched')
      for (const id of outcome.deliveryIds) {
        // The delivery row is stored; the webhook sweeper picks it up if this enqueue fails.
        try {
          await deps.webhooks.enqueue(id);
        } catch (error) {
          logger.warn(
            `Webhook delivery ${id} was not enqueued: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    return outcome;
  }
  if (job.name === MATCH_SWEEP_JOB) {
    // Search sync is best effort: a failure must not stop the match sweep.
    let searches:
      | Awaited<ReturnType<ProfileSearchSync['applyPending']>>
      | { error: string };
    try {
      searches = await deps.searches.applyPending();
    } catch (error) {
      const described = describeError(error);
      logger.error(`Search sync failed: ${described}`);
      searches = { error: described };
    }
    const deleted = await deps.repo.deleteInactive();
    const stale = await deps.repo.listStaleJobs(MATCH_SWEEP.limit);
    for (const jobId of stale) await deps.queue.enqueue(jobId);
    return { searches, deleted, enqueued: stale.length };
  }
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}

import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import type { MatcherRepository, MatcherService } from 'src/modules/matcher';
import { MATCH_SWEEP } from './config';
import { MATCH_JOB, MATCH_SWEEP_JOB, type MatchQueue } from './queue.service';

const jobPayload = z.object({
  jobId: z.string().min(1),
  force: z.boolean().optional(),
});

export interface MatchJobDeps {
  service: Pick<MatcherService, 'matchJob'>;
  repo: Pick<MatcherRepository, 'listStaleJobs' | 'deleteInactive'>;
  queue: Pick<MatchQueue, 'enqueue'>;
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
    return deps.service.matchJob(payload.data.jobId, {
      force: payload.data.force,
    });
  }
  if (job.name === MATCH_SWEEP_JOB) {
    const deleted = await deps.repo.deleteInactive();
    const stale = await deps.repo.listStaleJobs(MATCH_SWEEP.limit);
    for (const jobId of stale) await deps.queue.enqueue(jobId);
    return { deleted, enqueued: stale.length };
  }
  throw new UnrecoverableError(`Unsupported job: ${job.name}`);
}

import { Injectable, Logger } from '@nestjs/common';
import { RECHECK_WINDOW_MS } from '../config/prefilter.config';
import { PrefilterRepository } from '../repositories/prefilter.repository';
import {
  checkBeforeProcessing,
  type OnSiteDemand,
  type PrefilterJob,
} from '../rules/check';

/** No published profile wants hybrid or onsite anywhere. */
const NO_DEMAND: OnSiteDemand = { anywhere: false, countries: new Set() };

/**
 * Moves `pending` listings no published profile could take to `skipped`,
 * before the processor claims them (spec: processor quality, Part 1). With no
 * published profile the demand is empty, so a tagged job without remote words
 * is skipped; a demand that cannot be read throws, and nothing is skipped.
 */
@Injectable()
export class PrefilterService {
  private readonly logger = new Logger(PrefilterService.name);

  constructor(private readonly repo: PrefilterRepository) {}

  /**
   * When a published profile is new or changed (its `matchVersion` is not the
   * one last rechecked), sends the listings skipped in the last 24 hours back
   * to `pending` once, so `skipPending` checks them against the new demand.
   * Returns how many were reopened. Only skipped jobs move: nothing narrows
   * the other way, so unpublishing or narrowing never touches a processed job
   * or a match. Runs before `skipPending`; a failure throws.
   */
  async recheckProfiles(now: Date): Promise<number> {
    const profiles = await this.repo.listUnrecheckedProfiles();
    if (profiles.length === 0) return 0;
    const reopened = await this.repo.reopenSkipped({
      firstSeenSince: new Date(now.getTime() - RECHECK_WINDOW_MS),
    });
    for (const p of profiles)
      await this.repo.setRecheckedVersion(p.id, p.matchVersion);
    this.logger.log(
      `Prefilter recheck for ${profiles.length} changed profiles reopened ${reopened} skipped listings`,
    );
    return reopened;
  }

  /** Checks up to `limit` unchecked pending listings, loading the demand once. */
  async skipPending(
    limit = 200,
  ): Promise<{ checked: number; skipped: number }> {
    const jobs = await this.repo.listUncheckedPending(limit);
    if (jobs.length === 0) return { checked: 0, skipped: 0 };
    const demand = await this.repo.loadDemand();
    let skipped = 0;
    for (const job of jobs) {
      const result = checkBeforeProcessing(job, demand);
      if (
        !result.process &&
        (await this.repo.markSkipped(job.id, result.reason))
      )
        skipped++;
    }
    this.logger.log(
      `Prefilter checked ${jobs.length} pending listings, skipped ${skipped}`,
    );
    return { checked: jobs.length, skipped };
  }

  /**
   * The same check for one job, before a claim the ingest nudge asked for;
   * true when the job was skipped. The demand is read only when the job could
   * be skipped at all.
   */
  async skipJob(jobId: string): Promise<boolean> {
    const job = await this.repo.findUncheckedPending(jobId);
    if (!job || passesWithoutDemand(job)) return false;
    const result = checkBeforeProcessing(job, await this.repo.loadDemand());
    if (result.process) return false;
    const skipped = await this.repo.markSkipped(job.id, result.reason);
    if (skipped)
      this.logger.log(
        `Prefilter skipped job ${jobId} (${result.reason.tag} in ${result.reason.country})`,
      );
    return skipped;
  }
}

/** Processed even when nobody wants hybrid or onsite anywhere: untagged, remote, no country, remote words. */
function passesWithoutDemand(job: PrefilterJob): boolean {
  return checkBeforeProcessing(job, NO_DEMAND).process;
}

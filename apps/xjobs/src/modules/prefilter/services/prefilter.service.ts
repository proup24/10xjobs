import { Injectable, Logger } from '@nestjs/common';
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

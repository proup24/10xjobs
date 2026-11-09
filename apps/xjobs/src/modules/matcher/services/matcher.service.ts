import { Inject, Injectable, Optional } from '@nestjs/common';
import { decide, type MatchContext } from '../rules/decide';
import {
  MatcherRepository,
  type StoredMatch,
} from '../repositories/matcher.repository';

export type MatchOutcome =
  | { status: 'not_matchable' }
  | { status: 'matched'; profiles: number; qualified: number };

/** Clock token; defaults to Date.now. Tests provide their own. */
export const MATCHER_CLOCK = Symbol('MATCHER_CLOCK');

/** The vocabulary changes only through db:vocab, so the context may be stale. */
const CONTEXT_TTL_MS = 10 * 60_000;

@Injectable()
export class MatcherService {
  private context: { value: MatchContext; loadedAt: number } | null = null;

  constructor(
    private readonly repo: MatcherRepository,
    @Optional()
    @Inject(MATCHER_CLOCK)
    private readonly now: () => number = Date.now,
  ) {}

  /** Decides the job for every published profile whose row is stale (all of them when force). */
  async matchJob(
    jobId: string,
    opts: { force?: boolean } = {},
  ): Promise<MatchOutcome> {
    const job = await this.repo.loadMatchableJob(jobId);
    if (!job) return { status: 'not_matchable' };
    const profiles = await this.repo.listPublishedProfiles(
      opts.force
        ? {}
        : { onlyStaleFor: { jobId, extractionId: job.extractionId } },
    );
    if (profiles.length === 0)
      return { status: 'matched', profiles: 0, qualified: 0 };
    const ctx = await this.loadContext();
    const rows: StoredMatch[] = profiles.map((profile) => ({
      ...decide(job, profile, ctx),
      profileId: profile.id,
      userId: profile.userId,
      jobId,
      extractionId: job.extractionId,
    }));
    await this.repo.upsertMatches(rows);
    return {
      status: 'matched',
      profiles: rows.length,
      qualified: rows.filter((r) => r.outcome === 'qualified').length,
    };
  }

  private async loadContext(): Promise<MatchContext> {
    const at = this.now();
    if (this.context && at - this.context.loadedAt < CONTEXT_TTL_MS)
      return this.context.value;
    const value = await this.repo.loadContext();
    this.context = { value, loadedAt: at };
    return value;
  }
}

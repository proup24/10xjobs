import { Inject, Injectable, Optional } from '@nestjs/common';
import { FactsService } from 'src/modules/facts/services/facts.service';
import { decide, type MatchContext } from '../rules/decide';
import type { MatchJob } from '../rules/types';
import {
  MatcherRepository,
  type StoredMatch,
} from '../repositories/matcher.repository';

export type MatchOutcome =
  | { status: 'not_matchable' }
  /** The job expired: it is not decided again, and its rows stay. */
  | { status: 'closed' }
  | {
      status: 'matched';
      profiles: number;
      qualified: number;
      /** Webhook deliveries created by this decision, to hand to the webhook queue. */
      deliveryIds: string[];
    };

/** Clock token; defaults to Date.now. Tests provide their own. */
export const MATCHER_CLOCK = Symbol('MATCHER_CLOCK');

/** The vocabulary changes only through db:vocab, so the context may be stale. */
const CONTEXT_TTL_MS = 10 * 60_000;

@Injectable()
export class MatcherService {
  private context: { value: MatchContext; loadedAt: number } | null = null;

  constructor(
    private readonly repo: MatcherRepository,
    private readonly facts: FactsService,
    @Optional()
    @Inject(MATCHER_CLOCK)
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Builds the job's facts, then decides it for every published profile whose
   * row is stale (all of them when force). A closed job keeps its rows.
   */
  async matchJob(
    jobId: string,
    opts: { force?: boolean } = {},
  ): Promise<MatchOutcome> {
    const candidate = await this.repo.loadCandidate(jobId);
    if (!candidate) return { status: 'not_matchable' };
    const built = await this.facts.build(jobId);
    if (built.status === 'skipped') return { status: 'not_matchable' };
    if (built.facts.closed) return { status: 'closed' };
    const job: MatchJob = {
      jobId,
      extractionId: built.extractionId,
      factsHash: built.factsHash,
      needsReview: candidate.needsReview,
      facts: built.facts,
    };
    const profiles = await this.repo.listPublishedProfiles(
      opts.force
        ? {}
        : {
            onlyStaleFor: {
              jobId,
              factsHash: job.factsHash,
              extractionId: job.extractionId,
            },
          },
    );
    if (profiles.length === 0)
      return { status: 'matched', profiles: 0, qualified: 0, deliveryIds: [] };
    const ctx = await this.loadContext();
    const rows: StoredMatch[] = profiles.map((profile) => ({
      ...decide(job, profile, ctx),
      profileId: profile.id,
      userId: profile.userId,
      jobId,
      extractionId: job.extractionId,
      factsHash: job.factsHash,
      profileVersion: profile.matchVersion,
      eligibilityVersion: profile.eligibilityVersion,
    }));
    const { deliveryIds } = await this.repo.upsertMatches(rows);
    return {
      status: 'matched',
      profiles: rows.length,
      qualified: rows.filter((r) => r.outcome === 'qualified').length,
      deliveryIds,
    };
  }

  private async loadContext(): Promise<MatchContext> {
    const at = this.now();
    if (this.context && at - this.context.loadedAt < CONTEXT_TTL_MS)
      return this.context.value;
    const value = await this.repo.loadContext();
    // An empty rates map (a fresh table before the first refresh) is not cached, so the
    // rates are read again as soon as they land rather than ten minutes later.
    this.context = value.rates.size > 0 ? { value, loadedAt: at } : null;
    return value;
  }
}

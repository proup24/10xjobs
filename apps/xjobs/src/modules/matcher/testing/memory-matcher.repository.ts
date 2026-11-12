import { MATCHER_VERSION } from '../config/matcher.config';
import type { MatchContext } from '../rules/decide';
import type { MatchProfile } from '../rules/types';
import {
  type MatchCandidate,
  MatcherRepository,
  type StaleFor,
  type StoredMatch,
} from '../repositories/matcher.repository';

type Stored = StoredMatch & { matcherVersion: number };

/** In-memory MatcherRepository for unit tests. */
export class MemoryMatcherRepository extends MatcherRepository {
  /** Matchable jobs and their current extraction. */
  candidates = new Map<string, MatchCandidate>();
  /** The stored facts hash per job; a candidate without one has stale facts. */
  factsHashes = new Map<string, string>();
  /** Jobs whose stored facts are closed. */
  closedJobs = new Set<string>();
  /** Jobs whose status is not `active` (mirrors `status <> 'active'`). */
  inactiveJobs = new Set<string>();
  profiles: MatchProfile[] = [];
  rows: Stored[] = [];
  context: MatchContext = {
    places: { countriesOfRegion: new Map(), countryOfCity: new Map(), countries: new Set() },
    implies: new Map(),
    rates: new Map(),
  };
  contextLoads = 0;
  upserts: StoredMatch[][] = [];

  loadCandidate(jobId: string): Promise<MatchCandidate | null> {
    return Promise.resolve(this.candidates.get(jobId) ?? null);
  }

  listPublishedProfiles(
    opts: { onlyStaleFor?: StaleFor } = {},
  ): Promise<MatchProfile[]> {
    const stale = opts.onlyStaleFor;
    return Promise.resolve(
      this.profiles.filter(
        (p) =>
          !stale ||
          !this.rows.some(
            (r) =>
              r.profileId === p.id &&
              r.jobId === stale.jobId &&
              r.factsHash === stale.factsHash &&
              r.extractionId === stale.extractionId &&
              r.matcherVersion >= MATCHER_VERSION &&
              // Null (decided before they were recorded) is not stale by these two.
              (r.profileUpdatedAt === null ||
                r.profileUpdatedAt.getTime() >= p.updatedAt.getTime()) &&
              (r.eligibilityVersion === null ||
                r.eligibilityVersion >= p.eligibilityVersion),
          ),
      ),
    );
  }

  loadContext(): Promise<MatchContext> {
    this.contextLoads += 1;
    return Promise.resolve(this.context);
  }

  upsertMatches(rows: StoredMatch[]): Promise<void> {
    this.upserts.push(rows);
    for (const r of rows) {
      this.rows = this.rows.filter(
        (x) => !(x.profileId === r.profileId && x.jobId === r.jobId),
      );
      this.rows.push({ ...r, matcherVersion: MATCHER_VERSION });
    }
    return Promise.resolve();
  }

  async listStaleJobs(limit: number): Promise<string[]> {
    const out: string[] = [];
    for (const [jobId, candidate] of this.candidates) {
      const factsHash = this.factsHashes.get(jobId);
      if (factsHash === undefined) out.push(jobId);
      else if (this.closedJobs.has(jobId)) continue;
      else if (
        (
          await this.listPublishedProfiles({
            onlyStaleFor: {
              jobId,
              factsHash,
              extractionId: candidate.extractionId,
            },
          })
        ).length > 0
      )
        out.push(jobId);
    }
    return out.slice(0, limit);
  }

  listMatchableJobs(): Promise<string[]> {
    return Promise.resolve([...this.candidates.keys()].sort());
  }

  deleteInactive(): Promise<number> {
    const keep = this.rows.filter((r) => !this.inactiveJobs.has(r.jobId));
    const n = this.rows.length - keep.length;
    this.rows = keep;
    return Promise.resolve(n);
  }

  matchesForJob(jobId: string): Promise<StoredMatch[]> {
    return Promise.resolve(this.rows.filter((r) => r.jobId === jobId));
  }
}

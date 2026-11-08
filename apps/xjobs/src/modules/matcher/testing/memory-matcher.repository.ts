import { MATCHER_VERSION } from '../config/matcher.config';
import type { MatchContext } from '../rules/decide';
import type { MatchJob, MatchProfile } from '../rules/types';
import {
  MatcherRepository,
  type StoredMatch,
} from '../repositories/matcher.repository';

type Stored = StoredMatch & { matcherVersion: number };

/** In-memory MatcherRepository for unit tests. */
export class MemoryMatcherRepository extends MatcherRepository {
  jobs = new Map<string, MatchJob>();
  profiles: MatchProfile[] = [];
  rows: Stored[] = [];
  context: MatchContext = {
    places: { countriesOfRegion: new Map(), countryOfCity: new Map() },
    implies: new Map(),
  };
  contextLoads = 0;
  upserts: StoredMatch[][] = [];

  loadMatchableJob(jobId: string): Promise<MatchJob | null> {
    return Promise.resolve(this.jobs.get(jobId) ?? null);
  }

  listPublishedProfiles(
    opts: { onlyStaleFor?: { jobId: string; extractionId: string } } = {},
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
              r.extractionId === stale.extractionId &&
              r.matcherVersion >= MATCHER_VERSION,
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
    for (const job of this.jobs.values()) {
      const stale = await this.listPublishedProfiles({
        onlyStaleFor: { jobId: job.jobId, extractionId: job.extractionId },
      });
      if (stale.length > 0) out.push(job.jobId);
    }
    return out.slice(0, limit);
  }

  listMatchableJobs(): Promise<string[]> {
    return Promise.resolve([...this.jobs.keys()].sort());
  }

  deleteInactive(): Promise<number> {
    const keep = this.rows.filter((r) => this.jobs.has(r.jobId));
    const n = this.rows.length - keep.length;
    this.rows = keep;
    return Promise.resolve(n);
  }

  matchesForJob(jobId: string): Promise<StoredMatch[]> {
    return Promise.resolve(this.rows.filter((r) => r.jobId === jobId));
  }
}

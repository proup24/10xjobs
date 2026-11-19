/** In-memory segments repository for unit tests; not part of the application build. */
import type { Channel } from 'src/common/enums';
import {
  type ClaimResult,
  type ClaimWindow,
  type NewCollectionBatch,
  type NewSegmentRun,
  SearchSegmentsRepository,
  type UnsettledCost,
} from '../repositories/segments.repository';
import { LinkedinSearchSplitsRepository } from '../repositories/splits.repository';

interface FakeClaim {
  runId: string;
  since: Date;
  until: Date;
  expiresAt: Date;
}

/** Mirrors the claim rules of the Postgres repository; activity is not modelled. */
export class FakeSearchSegmentsRepository extends SearchSegmentsRepository {
  runs: (NewSegmentRun & { id: string })[] = [];
  cursors = new Map<string, Date>();
  claims = new Map<string, FakeClaim>();
  /** Run ids whose claims were released, by any path. */
  released: string[] = [];
  now: () => Date = () => new Date();
  /** When true, `recordRun` throws before writing anything. */
  failRecordRun = false;

  collected: {
    run: NewSegmentRun & { id: string };
    batch: NewCollectionBatch;
    advance: string[];
  }[] = [];

  /** Every recorded run, failed or collected. */
  private allRuns(): (NewSegmentRun & { id: string })[] {
    return [...this.runs, ...this.collected.map(({ run }) => run)];
  }

  async claim(
    runId: string,
    queryIds: string[],
    window: ClaimWindow,
    leaseMs: number,
  ): Promise<ClaimResult> {
    const now = this.now();
    const result: ClaimResult = { claimed: [], skipped: [] };
    for (const id of queryIds) {
      const coveredUntil = this.cursors.get(id) ?? null;
      if (coveredUntil && coveredUntil >= window.until) {
        result.skipped.push({ id, reason: 'already-covered' });
        continue;
      }
      const held = this.claims.get(id);
      const live =
        held &&
        held.expiresAt > now &&
        held.until > window.since &&
        held.since < window.until;
      if (live) {
        result.skipped.push({ id, reason: 'in-flight' });
        continue;
      }
      this.claims.set(id, {
        runId,
        since: window.since,
        until: window.until,
        expiresAt: new Date(now.getTime() + leaseMs),
      });
      result.claimed.push({ id, coveredUntil });
    }
    return result;
  }

  async releaseClaims(runId: string): Promise<void> {
    this.released.push(runId);
    for (const [id, claim] of this.claims)
      if (claim.runId === runId) this.claims.delete(id);
  }

  async recordRun(run: NewSegmentRun & { id: string }): Promise<void> {
    if (this.failRecordRun) throw new Error('record failed');
    this.runs.push(run);
    await this.releaseClaims(run.id);
  }

  async recordCollectedRun(
    run: NewSegmentRun & { id: string },
    batch: NewCollectionBatch,
    advance: string[],
  ): Promise<void> {
    this.collected.push({ run, batch, advance });
    await this.advanceCursors(advance, run.windowEnd);
    await this.releaseClaims(run.id);
  }

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    for (const id of queryIds) {
      const current = this.cursors.get(id);
      if (!current || current < until) this.cursors.set(id, until);
    }
  }

  async spentMicroUsd(
    channel: Channel,
    since: Date,
    nullCostMicroUsd: number,
  ): Promise<number> {
    return this.allRuns()
      .filter((run) => run.channel === channel && run.startedAt >= since)
      .reduce((sum, run) => sum + (run.costMicroUsd ?? nullCostMicroUsd), 0);
  }

  async unsettledCosts(
    channel: Channel,
    finishedSince: Date,
  ): Promise<UnsettledCost[]> {
    return this.allRuns()
      .filter(
        (run) =>
          run.channel === channel &&
          run.apifyRunId !== null &&
          run.costFinalAt === null &&
          run.finishedAt >= finishedSince,
      )
      .map((run) => ({
        id: run.id,
        apifyRunId: run.apifyRunId as string,
        finishedAt: run.finishedAt,
      }));
  }

  async settleCost(
    id: string,
    costMicroUsd: number,
    finalAt: Date | null,
  ): Promise<void> {
    const run = this.allRuns().find((candidate) => candidate.id === id);
    if (run) Object.assign(run, { costMicroUsd, costFinalAt: finalAt });
  }
}

/** In-memory splits repository; `parts` of 1 forgets a key, as in Postgres. */
export class FakeLinkedinSearchSplitsRepository extends LinkedinSearchSplitsRepository {
  splits = new Map<string, { parts: number; splitAt: Date }>();

  async parts(): Promise<Map<string, { parts: number; splitAt: Date }>> {
    return new Map(this.splits);
  }

  async setParts(
    groupKey: string,
    parts: number,
    splitAt: Date,
  ): Promise<void> {
    if (parts <= 1) this.splits.delete(groupKey);
    else this.splits.set(groupKey, { parts, splitAt });
  }

  async prune(channel: Channel, keep: readonly string[]): Promise<number> {
    const kept = new Set(keep);
    let forgot = 0;
    for (const key of [...this.splits.keys()])
      if (key.startsWith(`${channel}|`) && !kept.has(key)) {
        this.splits.delete(key);
        forgot += 1;
      }
    return forgot;
  }
}

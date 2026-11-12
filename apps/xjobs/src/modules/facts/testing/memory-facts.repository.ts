import {
  FactsRepository,
  type FactsInputs,
  type SavedFacts,
} from '../repositories/facts.repository';

/** In-memory FactsRepository for unit tests. */
export class MemoryFactsRepository extends FactsRepository {
  inputs = new Map<string, FactsInputs>();
  rows = new Map<string, SavedFacts & { builtAt: number }>();
  conflictsByJob = new Map<string, SavedFacts['conflicts']>();
  /** Counts saves so tests can see a write that changed nothing. */
  saves = 0;
  clock = 0;

  loadInputs(jobId: string): Promise<FactsInputs | null> {
    return Promise.resolve(this.inputs.get(jobId) ?? null);
  }

  current(
    jobId: string,
  ): Promise<{ factsHash: string; factsVersion: number } | null> {
    const row = this.rows.get(jobId);
    return Promise.resolve(
      row ? { factsHash: row.factsHash, factsVersion: row.factsVersion } : null,
    );
  }

  save(row: SavedFacts): Promise<void> {
    this.saves += 1;
    this.clock += 1;
    this.rows.set(row.jobId, { ...row, builtAt: this.clock });
    this.conflictsByJob.set(row.jobId, row.conflicts);
    return Promise.resolve();
  }

  markStale(where: { countryCode: string }): Promise<number> {
    let n = 0;
    for (const [jobId, row] of this.rows) {
      if (this.inputs.get(jobId)?.listing.countryCode !== where.countryCode)
        continue;
      row.builtAt = Number.NEGATIVE_INFINITY;
      n += 1;
    }
    return Promise.resolve(n);
  }
}

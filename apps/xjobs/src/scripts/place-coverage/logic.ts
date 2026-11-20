export type Outcome = 'qualified' | 'review' | 'rejected';

export interface Sighting {
  jobId: string;
  place: string;
  type: string;
  level: string | null;
}

export interface PlaceRun {
  place: string;
  type: string;
  level: string | null;
  costMicroUsd: number | null;
}

export interface CoverageRow {
  place: string;
  type: string;
  level?: string | null;
  runs: number;
  costUsd: number;
  jobs: number;
  onlyHere: number;
  onlyHereOutcomes: Record<Outcome | 'none', number>;
}

const RANK: readonly Outcome[] = ['qualified', 'review', 'rejected'];

/** The best outcome among a job's decisions: qualified > review > rejected > none. */
export function bestOutcome(outcomes: readonly string[]): Outcome | 'none' {
  return RANK.find((o) => outcomes.includes(o)) ?? 'none';
}

/**
 * Per place and type (or level), the jobs it finds and the jobs no other place
 * finds ("only here": the job's distinct places are exactly this row's place).
 * Level rows leave `type` empty; type rows leave `level` unset.
 */
export function placeCoverage(
  sightings: readonly Sighting[],
  runs: readonly PlaceRun[],
  outcomes: ReadonlyMap<string, Outcome | 'none'>,
  by: 'type' | 'level',
): CoverageRow[] {
  const placesOfJob = new Map<string, Set<string>>();
  for (const s of sightings) {
    const set = placesOfJob.get(s.jobId) ?? new Set<string>();
    set.add(s.place);
    placesOfJob.set(s.jobId, set);
  }
  const keyOf = (r: { place: string; type: string; level: string | null }) =>
    JSON.stringify([r.place, by === 'type' ? r.type : r.level]);
  const rows = new Map<string, CoverageRow>();
  const seen = new Map<string, Set<string>>();
  const rowFor = (r: { place: string; type: string; level: string | null }) => {
    const key = keyOf(r);
    let row = rows.get(key);
    if (!row) {
      row = {
        place: r.place,
        type: by === 'type' ? r.type : '',
        ...(by === 'level' ? { level: r.level } : {}),
        runs: 0,
        costUsd: 0,
        jobs: 0,
        onlyHere: 0,
        onlyHereOutcomes: { qualified: 0, review: 0, rejected: 0, none: 0 },
      };
      rows.set(key, row);
      seen.set(key, new Set());
    }
    return row;
  };
  for (const run of runs) {
    const row = rowFor(run);
    row.runs += 1;
    row.costUsd += (run.costMicroUsd ?? 0) / 1_000_000;
  }
  for (const s of sightings) {
    const row = rowFor(s);
    const jobIds = seen.get(keyOf(s));
    if (!jobIds || jobIds.has(s.jobId)) continue;
    jobIds.add(s.jobId);
    row.jobs += 1;
    const places = placesOfJob.get(s.jobId);
    if (places && places.size === 1) {
      row.onlyHere += 1;
      row.onlyHereOutcomes[outcomes.get(s.jobId) ?? 'none'] += 1;
    }
  }
  return [...rows.values()].sort((a, b) => b.onlyHere - a.onlyHere);
}

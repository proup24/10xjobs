import type { ActorName, PlaceId, SampleJob } from './actors';
import { GATE_PLACES, isRelevant, PLACE_GROUPS } from './baseline';
import { isCoreSearch, type PlannedRun } from './plan';

export interface RunResult {
  actor: ActorName;
  searchId: string;
  place: PlaceId;
  /** Null when the run's cost is unknown. */
  costUsd: number | null;
  jobs: SampleJob[];
}

export interface DevLookup {
  strongKeys: Set<string>;
  /** Keys from `titleCompanyKey`. */
  titleCompany: Set<string>;
}

export type BaselineInput = Record<
  PlaceId,
  { costUsd: number; relevant: number; perRelevantUsd: number | null }
>;

export type CoverageField =
  | 'jk'
  | 'fullDescription'
  | 'employerApplyLink'
  | 'easyApplyFlag'
  | 'postedTime'
  | 'company'
  | 'place'
  | 'remoteFlag'
  | 'salary'
  | 'jobType';

export interface RunSummary {
  searchId: string;
  place: PlaceId;
  /** False for a probe run (or a result no core search planned). */
  core: boolean;
  rows: number;
  distinct: number;
  costUsd: number | null;
}

export interface ActorReport {
  runs: RunSummary[];
  /** Planned search ids with no result. */
  notRun: string[];
  /** Distinct `jk` over every run, probes included. */
  distinct: number;
  /** Sum of the known run costs, probes included. */
  costUsd: number;
  /** Search ids whose cost is unknown, so `costUsd` is a lower bound. */
  costUnknownRuns: string[];
  costPer1000: number | null;
  /** Distinct relevant `jk` per place, core runs only. */
  relevantByPlace: Record<PlaceId, number>;
  /** Core-run cost on the gate places over their relevant jobs. */
  costPerRelevantGate: number | null;
  coverage: Record<CoverageField, number | null>;
  devOverlap: { proven: number; likely: number };
  gate: { pass: boolean; reasons: string[] };
}

export interface LostJob {
  jk: string;
  title: string | null;
  company: string | null;
  applyUrl: string | null;
}

export interface ProbeResult {
  onlyFiltered: number;
  onlyUnfiltered: number;
  both: number;
  /** Relevant jobs only the unfiltered search found, before any hand strike-off. */
  lost: LostJob[];
  lostShare: number | null;
}

export interface BooleanShare {
  plainRelevantShare: number | null;
  realRelevantShare: number | null;
}

export interface SampleReport {
  perActor: Record<ActorName, ActorReport>;
  overlap: { a: ActorName; b: ActorName; shared: number }[];
  probes: {
    remoteFilter: Partial<Record<ActorName, ProbeResult>>;
    seniorFilter: { memo23?: ProbeResult };
  };
  boolean: Record<ActorName, Record<PlaceId, BooleanShare>>;
  baseline: { places: BaselineInput; gatePerRelevantUsd: number | null };
  /** Passing actors, best first. */
  pickOrder: ActorName[];
}

const ACTOR_ORDER: ActorName[] = ['valig', 'kaix', 'memo23', 'curious_coder'];
const PLACES = Object.keys(PLACE_GROUPS) as PlaceId[];
const MIN_FULL_SHARE = 0.95;
const MAX_BASELINE_RATIO = 2;
const MAX_LOST_SHARE = 0.02;
const EPS = 1e-9;

const REMOTE_PROBE = {
  filtered: 'us-remote-plain',
  unfiltered: 'us-locremote-plain',
};
const SENIOR_PROBE = {
  filtered: 'us-remote-plain-senior',
  unfiltered: 'us-remote-plain',
};

/** At least 500 characters and not cut off with an ellipsis. */
export function isFullDescription(text: string | null): boolean {
  if (text === null) return false;
  const t = text.trim();
  return t.length >= 500 && !t.endsWith('…') && !t.endsWith('...');
}

/** The dev title + company lookup key; null when either part is missing. */
export function titleCompanyKey(
  title: string | null,
  company: string | null,
): string | null {
  const t = title?.toLowerCase().trim();
  const c = company?.toLowerCase().trim();
  return t && c ? `${t}|${c}` : null;
}

const present = (s: string | null) => s !== null && s.trim() !== '';

const COVERAGE: Record<CoverageField, (j: SampleJob) => boolean> = {
  jk: (j) => present(j.jk),
  fullDescription: (j) => isFullDescription(j.descriptionText),
  employerApplyLink: (j) => j.applyUrl !== null,
  easyApplyFlag: (j) => j.easyApply !== null,
  postedTime: (j) => present(j.postedAt),
  company: (j) => present(j.company),
  place: (j) => present(j.place),
  remoteFlag: (j) => j.remote !== null,
  salary: (j) => present(j.salary),
  jobType: (j) => present(j.jobType),
};

const share = (part: number, whole: number) =>
  whole === 0 ? null : part / whole;

function jks(jobs: SampleJob[]): Set<string> {
  const out = new Set<string>();
  for (const j of jobs) if (j.jk !== null) out.add(j.jk);
  return out;
}

function relevantJks(jobs: SampleJob[], spellings: string[]): Set<string> {
  return jks(jobs.filter((j) => isRelevant(j, spellings)));
}

function sumCosts(runs: RunResult[]): number {
  return runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
}

function probe(
  results: RunResult[],
  pair: { filtered: string; unfiltered: string },
  spellings: string[],
): ProbeResult | undefined {
  const filtered = results.filter((r) => r.searchId === pair.filtered);
  const unfiltered = results.filter((r) => r.searchId === pair.unfiltered);
  if (filtered.length === 0 || unfiltered.length === 0) return undefined;
  const f = relevantJks(
    filtered.flatMap((r) => r.jobs),
    spellings,
  );
  const unfilteredJobs = unfiltered.flatMap((r) => r.jobs);
  const u = relevantJks(unfilteredJobs, spellings);
  const lostIds = [...u].filter((jk) => !f.has(jk)).sort();
  const lost = lostIds.map((jk): LostJob => {
    const j = unfilteredJobs.find((x) => x.jk === jk) as SampleJob;
    return { jk, title: j.title, company: j.company, applyUrl: j.applyUrl };
  });
  const both = [...f].filter((jk) => u.has(jk)).length;
  return {
    onlyFiltered: f.size - both,
    onlyUnfiltered: lost.length,
    both,
    lost,
    lostShare: share(lost.length, u.size),
  };
}

function devOverlap(
  jobs: SampleJob[],
  dev: DevLookup,
  strongKeyOf: (applyUrl: string) => string | null,
): { proven: number; likely: number } {
  const byJk = new Map<string, SampleJob[]>();
  for (const j of jobs) {
    if (j.jk === null) continue;
    byJk.set(j.jk, [...(byJk.get(j.jk) ?? []), j]);
  }
  let proven = 0;
  let likely = 0;
  for (const rows of byJk.values()) {
    const isProven = rows.some((j) => {
      const key = j.applyUrl === null ? null : strongKeyOf(j.applyUrl);
      return key !== null && dev.strongKeys.has(key);
    });
    if (isProven) proven++;
    else if (
      rows.some((j) => {
        const key = titleCompanyKey(j.title, j.company);
        return key !== null && dev.titleCompany.has(key);
      })
    )
      likely++;
  }
  return { proven, likely };
}

/**
 * The comparison report and go/no-go gate.
 *
 * Core vs probe: `relevantByPlace`, `costPerRelevantGate` (so the gate) and
 * `boolean` use the six core searches only, so actors with extra us-remote
 * probe runs (kaix, memo23) stay comparable. Probe runs feed `probes` and still
 * count in each actor's `costUsd`, `distinct`, `costPer1000`, `coverage`,
 * `devOverlap` and the cross-actor `overlap`.
 *
 * Missing runs land in `notRun`; every number is computed over the results
 * that exist and nothing throws.
 */
export function buildReport(input: {
  planned: PlannedRun[];
  results: RunResult[];
  spellings: Record<PlaceId, string[]>;
  baseline: BaselineInput;
  dev: DevLookup;
  strongKeyOf: (applyUrl: string) => string | null;
}): SampleReport {
  const { planned, results, spellings, baseline, dev, strongKeyOf } = input;
  const spell = (p: PlaceId) => spellings[p] ?? [];
  const runKey = (actor: ActorName, id: string) => `${actor}|${id}`;
  const plannedByKey = new Map(
    planned.map((p) => [runKey(p.actor, p.search.id), p]),
  );
  const resultKeys = new Set(results.map((r) => runKey(r.actor, r.searchId)));
  const isCore = (r: RunResult) => {
    const p = plannedByKey.get(runKey(r.actor, r.searchId));
    return p !== undefined && isCoreSearch(p.search);
  };

  const gateBaseCost = GATE_PLACES.reduce(
    (s, p) => s + (baseline[p]?.costUsd ?? 0),
    0,
  );
  const gateBaseRelevant = GATE_PLACES.reduce(
    (s, p) => s + (baseline[p]?.relevant ?? 0),
    0,
  );
  const gatePerRelevantUsd = share(gateBaseCost, gateBaseRelevant);

  const perActor = {} as Record<ActorName, ActorReport>;
  const distinctByActor = {} as Record<ActorName, Set<string>>;
  const boolean = {} as SampleReport['boolean'];
  const remoteFilter: SampleReport['probes']['remoteFilter'] = {};
  const seniorFilter: SampleReport['probes']['seniorFilter'] = {};

  for (const actor of ACTOR_ORDER) {
    const runs = results.filter((r) => r.actor === actor);
    const core = runs.filter(isCore);
    const rows = runs.flatMap((r) => r.jobs);
    const distinct = jks(rows);
    distinctByActor[actor] = distinct;
    const costUsd = sumCosts(runs);

    const relevantByPlace = {} as Record<PlaceId, number>;
    for (const p of PLACES) {
      relevantByPlace[p] = relevantJks(
        core.filter((r) => r.place === p).flatMap((r) => r.jobs),
        spell(p),
      ).size;
    }
    const gateRuns = core.filter((r) => GATE_PLACES.includes(r.place));
    const gateRelevant = GATE_PLACES.reduce(
      (s, p) => s + relevantByPlace[p],
      0,
    );
    const costPerRelevantGate = share(sumCosts(gateRuns), gateRelevant);

    const coverage = {} as Record<CoverageField, number | null>;
    for (const [field, has] of Object.entries(COVERAGE) as [
      CoverageField,
      (j: SampleJob) => boolean,
    ][]) {
      coverage[field] = share(rows.filter(has).length, rows.length);
    }

    const reasons: string[] = [];
    if (rows.length === 0) reasons.push('no rows');
    else {
      const full = rows.filter(
        (j) => j.jk !== null && isFullDescription(j.descriptionText),
      ).length;
      if (full / rows.length < MIN_FULL_SHARE - EPS)
        reasons.push('jk or description under 95%');
    }
    if (costPerRelevantGate === null) reasons.push('no relevant jobs');
    else if (gateRuns.some((r) => r.costUsd === null))
      reasons.push('cost unknown');
    else if (gatePerRelevantUsd === null)
      reasons.push('baseline has no relevant jobs');
    else if (
      costPerRelevantGate >
      MAX_BASELINE_RATIO * gatePerRelevantUsd * (1 + EPS)
    )
      reasons.push('cost per relevant job over 2x baseline');

    perActor[actor] = {
      runs: runs.map((r) => ({
        searchId: r.searchId,
        place: r.place,
        core: isCore(r),
        rows: r.jobs.length,
        distinct: jks(r.jobs).size,
        costUsd: r.costUsd,
      })),
      notRun: planned
        .filter(
          (p) =>
            p.actor === actor && !resultKeys.has(runKey(actor, p.search.id)),
        )
        .map((p) => p.search.id),
      distinct: distinct.size,
      costUsd,
      costUnknownRuns: runs
        .filter((r) => r.costUsd === null)
        .map((r) => r.searchId),
      costPer1000:
        distinct.size === 0 ? null : (costUsd / distinct.size) * 1000,
      relevantByPlace,
      costPerRelevantGate,
      coverage,
      devOverlap: devOverlap(rows, dev, strongKeyOf),
      gate: { pass: reasons.length === 0, reasons },
    };

    boolean[actor] = {} as Record<PlaceId, BooleanShare>;
    for (const p of PLACES) {
      const runShare = (kind: 'plain' | 'real') => {
        const jobs = core
          .filter((r) => r.searchId === `${p}-${kind}`)
          .flatMap((r) => r.jobs);
        return share(relevantJks(jobs, spell(p)).size, jks(jobs).size);
      };
      boolean[actor][p] = {
        plainRelevantShare: runShare('plain'),
        realRelevantShare: runShare('real'),
      };
    }

    const remote = probe(runs, REMOTE_PROBE, spell('us-remote'));
    if (remote) remoteFilter[actor] = remote;
    if (actor === 'memo23') {
      const senior = probe(runs, SENIOR_PROBE, spell('us-remote'));
      if (senior) seniorFilter.memo23 = senior;
    }
  }

  const overlap: SampleReport['overlap'] = [];
  ACTOR_ORDER.forEach((a, i) => {
    for (const b of ACTOR_ORDER.slice(i + 1)) {
      const other = distinctByActor[b];
      const shared = [...distinctByActor[a]].filter((jk) =>
        other.has(jk),
      ).length;
      overlap.push({ a, b, shared });
    }
  });

  const passingProbes = (actor: ActorName) =>
    [
      remoteFilter[actor],
      actor === 'memo23' ? seniorFilter.memo23 : undefined,
    ].filter((p) => p?.lostShare != null && p.lostShare <= MAX_LOST_SHARE + EPS)
      .length;
  const totalRelevant = (actor: ActorName) =>
    PLACES.reduce((s, p) => s + perActor[actor].relevantByPlace[p], 0);
  const pickOrder = ACTOR_ORDER.filter((a) => perActor[a].gate.pass).sort(
    (a, b) =>
      totalRelevant(b) - totalRelevant(a) ||
      passingProbes(b) - passingProbes(a) ||
      (perActor[b].coverage.employerApplyLink ?? 0) -
        (perActor[a].coverage.employerApplyLink ?? 0) ||
      perActor[a].costUsd - perActor[b].costUsd ||
      a.localeCompare(b),
  );

  return {
    perActor,
    overlap,
    probes: { remoteFilter, seniorFilter },
    boolean,
    baseline: { places: baseline, gatePerRelevantUsd },
    pickOrder,
  };
}

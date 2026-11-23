import { ACTORS, type ActorName, type PlaceId, type SampleJob } from './actors';
import { GATE_PLACES, isRelevant, PLACE_GROUPS } from './baseline';
import { isCoreSearch, type PlannedRun } from './plan';

export interface RunResult {
  actor: ActorName;
  searchId: string;
  place: PlaceId;
  /** Null when the run's cost is unknown. */
  costUsd: number | null;
  /** When the run started (ISO), for relative posting times; null when unknown. */
  scrapedAt: string | null;
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
  /** The run charged more than a full run should at the planned prices, so Apify's limit may have cut it short. */
  chargeCapReached: boolean;
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
  /** Core-run cost on the gate places over their relevant jobs; null when none are relevant or a gate run's cost is unknown. */
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

export interface ProbeCounts {
  onlyFiltered: number;
  onlyUnfiltered: number;
  both: number;
  lostShare: number | null;
}

export interface ProbeSide {
  rows: number;
  /** The side reached the actor's row cap, so it may cover a shorter time span. */
  full: boolean;
}

/**
 * One filter probe. When a side hit its row cap, the two searches can cover
 * different time spans, so the counts, `lost` and `lostShare` are taken only
 * over jobs posted since `spanStart` (`windowed`); `raw` keeps the counts over
 * every job. Unwindowed, the top-level counts equal `raw`.
 */
export interface ProbeResult extends ProbeCounts {
  filtered: ProbeSide;
  unfiltered: ProbeSide;
  windowed: boolean;
  /** Oldest posting time a full side saw (the later one if both are full); null unwindowed. */
  spanStart: string | null;
  /** Relevant unfiltered jobs whose posting time could not be read; they count as inside the span. */
  unparsedPostedAt: number;
  /** Relevant jobs only the unfiltered search found (in the span), before any hand strike-off. */
  lost: LostJob[];
  raw: ProbeCounts;
  /** Why the 2% rule must not be read off `lostShare` alone; null when nothing applies. */
  note: string | null;
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
/** Float slack when comparing a run's charge with its full-run cost. */
const CHARGE_SLACK_USD = 1e-6;

const REMOTE_PROBE = {
  filtered: 'us-remote-plain',
  unfiltered: 'us-locremote-plain',
};
/** The pair when the core search uses location Remote and the probe runs the filter (kaix from 2026-11-23). */
const FILTER_REMOTE_PROBE = {
  filtered: 'us-filterremote-plain',
  unfiltered: 'us-remote-plain',
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

/** The one "has a jk" check: a blank jk counts as none. */
const hasJk = (j: SampleJob): j is SampleJob & { jk: string } => present(j.jk);

const COVERAGE: Record<CoverageField, (j: SampleJob) => boolean> = {
  jk: hasJk,
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
  for (const j of jobs) if (hasJk(j)) out.add(j.jk);
  return out;
}

function relevantJks(jobs: SampleJob[], spellings: string[]): Set<string> {
  return jks(jobs.filter((j) => isRelevant(j, spellings)));
}

function sumCosts(runs: RunResult[]): number {
  return runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
}

/**
 * Every gate reason that applies, independently. `'no relevant jobs'` and the
 * 2x comparison exclude each other, since the comparison needs a value.
 */
function gateReasons(g: {
  rows: SampleJob[];
  missingGateRuns: number;
  costUnknown: boolean;
  gateRelevant: number;
  costPerRelevantGate: number | null;
  gatePerRelevantUsd: number | null;
}): string[] {
  const reasons: string[] = [];
  if (g.rows.length === 0) reasons.push('no rows');
  else {
    const full = g.rows.filter(
      (j) => hasJk(j) && isFullDescription(j.descriptionText),
    ).length;
    if (full / g.rows.length < MIN_FULL_SHARE - EPS)
      reasons.push('jk or description under 95%');
  }
  if (g.missingGateRuns > 0) reasons.push('gate run missing');
  if (g.costUnknown) reasons.push('cost unknown');
  if (g.gatePerRelevantUsd === null)
    reasons.push('baseline has no relevant jobs');
  if (g.gateRelevant === 0) reasons.push('no relevant jobs');
  else if (
    g.costPerRelevantGate !== null &&
    g.gatePerRelevantUsd !== null &&
    g.costPerRelevantGate >
      MAX_BASELINE_RATIO * g.gatePerRelevantUsd * (1 + EPS)
  )
    reasons.push('cost per relevant job over 2x baseline');
  return reasons;
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * A posting time in ms: an exact ISO date, or relative text ("3 hours ago",
 * "30+ days ago", "Just posted", "today") read against `scrapedAt`. Null when
 * it can't be read.
 */
export function postedAtMs(
  postedAt: string | null,
  scrapedAt: string | null,
): number | null {
  const text = postedAt?.trim().toLowerCase();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const ms = Date.parse(postedAt as string);
    return Number.isNaN(ms) ? null : ms;
  }
  const base = scrapedAt === null ? NaN : Date.parse(scrapedAt);
  if (Number.isNaN(base)) return null;
  if (/^(just posted|today|just now)$/.test(text)) return base;
  const m = /^(?:posted\s+)?(\d+)\+?\s*(minute|min|hour|hr|day)s?\s+ago$/.exec(
    text,
  );
  if (!m) return null;
  const unit = m[2] === 'min' ? 'minute' : m[2] === 'hr' ? 'hour' : m[2];
  return base - Number(m[1]) * UNIT_MS[unit];
}

interface Dated {
  job: SampleJob & { jk: string };
  ms: number | null;
}

/** Relevant jobs by jk, first row wins, with each one's posting time. */
function relevantDated(
  runs: RunResult[],
  spellings: string[],
): Map<string, Dated> {
  const out = new Map<string, Dated>();
  for (const r of runs)
    for (const j of r.jobs)
      if (hasJk(j) && !out.has(j.jk) && isRelevant(j, spellings))
        out.set(j.jk, { job: j, ms: postedAtMs(j.postedAt, r.scrapedAt) });
  return out;
}

/** Oldest readable posting time over every row of the runs. */
function oldestMs(runs: RunResult[]): number | null {
  let oldest: number | null = null;
  for (const r of runs)
    for (const j of r.jobs) {
      const ms = postedAtMs(j.postedAt, r.scrapedAt);
      if (ms !== null && (oldest === null || ms < oldest)) oldest = ms;
    }
  return oldest;
}

function counts(
  f: Map<string, Dated>,
  u: Map<string, Dated>,
): { counts: ProbeCounts; lostIds: string[] } {
  const lostIds = [...u.keys()].filter((jk) => !f.has(jk)).sort();
  const both = [...f.keys()].filter((jk) => u.has(jk)).length;
  return {
    counts: {
      onlyFiltered: f.size - both,
      onlyUnfiltered: lostIds.length,
      both,
      lostShare: share(lostIds.length, u.size),
    },
    lostIds,
  };
}

function inSpan(map: Map<string, Dated>, start: number): Map<string, Dated> {
  return new Map([...map].filter(([, d]) => d.ms === null || d.ms >= start));
}

function probe(
  actor: ActorName,
  results: RunResult[],
  pair: { filtered: string; unfiltered: string },
  spellings: string[],
): ProbeResult | undefined {
  const filtered = results.filter((r) => r.searchId === pair.filtered);
  const unfiltered = results.filter((r) => r.searchId === pair.unfiltered);
  if (filtered.length === 0 || unfiltered.length === 0) return undefined;
  const side = (runs: RunResult[]): ProbeSide => {
    const rows = runs.reduce((n, r) => n + r.jobs.length, 0);
    return { rows, full: rows >= ACTORS[actor].rows };
  };
  const fSide = side(filtered);
  const uSide = side(unfiltered);
  const f = relevantDated(filtered, spellings);
  const u = relevantDated(unfiltered, spellings);
  const raw = counts(f, u);

  // The span both searches cover: from the oldest job each full side saw, the later of the two.
  const starts = [
    fSide.full ? oldestMs(filtered) : null,
    uSide.full ? oldestMs(unfiltered) : null,
  ];
  const capped = fSide.full || uSide.full;
  const known = starts.filter((ms): ms is number => ms !== null);
  const start = known.length > 0 ? Math.max(...known) : null;
  const windowed = capped && start !== null;
  const fw = windowed ? inSpan(f, start) : f;
  const uw = windowed ? inSpan(u, start) : u;
  const { counts: winCounts, lostIds } = windowed ? counts(fw, uw) : raw;

  let note: string | null = null;
  if (windowed)
    note = `A side hit its ${ACTORS[actor].rows}-row cap, so counts and lostShare cover only jobs posted since ${new Date(start).toISOString()}; compare raw.lostShare before applying the 2% rule.`;
  else if (capped)
    note = `A side hit its ${ACTORS[actor].rows}-row cap but no posting time could be read, so lostShare is unwindowed and may overstate the loss.`;

  return {
    ...winCounts,
    filtered: fSide,
    unfiltered: uSide,
    windowed,
    spanStart: windowed ? new Date(start).toISOString() : null,
    unparsedPostedAt: windowed
      ? [...uw.values()].filter((d) => d.ms === null).length
      : 0,
    lost: lostIds.map((jk): LostJob => {
      const { job: j } = uw.get(jk) as Dated;
      return { jk, title: j.title, company: j.company, applyUrl: j.applyUrl };
    }),
    raw: raw.counts,
    note,
  };
}

function devOverlap(
  jobs: SampleJob[],
  dev: DevLookup,
  strongKeyOf: (applyUrl: string) => string | null,
): { proven: number; likely: number } {
  const byJk = new Map<string, SampleJob[]>();
  for (const j of jobs) {
    if (!hasJk(j)) continue;
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
 * that exist and nothing throws. A missing core run on a gate place fails the
 * gate (`'gate run missing'`).
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
    const costUnknown = gateRuns.some((r) => r.costUsd === null);
    // A partial sum would read cheaper than the truth: null instead.
    const costPerRelevantGate = costUnknown
      ? null
      : share(sumCosts(gateRuns), gateRelevant);
    const notRun = planned
      .filter(
        (p) => p.actor === actor && !resultKeys.has(runKey(actor, p.search.id)),
      )
      .map((p) => p.search);

    const coverage = {} as Record<CoverageField, number | null>;
    for (const [field, has] of Object.entries(COVERAGE) as [
      CoverageField,
      (j: SampleJob) => boolean,
    ][]) {
      coverage[field] = share(rows.filter(has).length, rows.length);
    }

    const reasons = gateReasons({
      rows,
      missingGateRuns: notRun.filter(
        (search) => isCoreSearch(search) && GATE_PLACES.includes(search.place),
      ).length,
      costUnknown,
      gateRelevant,
      costPerRelevantGate,
      gatePerRelevantUsd,
    });

    perActor[actor] = {
      runs: runs.map((r) => {
        const fullRunUsd = plannedByKey.get(
          runKey(actor, r.searchId),
        )?.worstCaseUsd;
        return {
          searchId: r.searchId,
          place: r.place,
          core: isCore(r),
          rows: r.jobs.length,
          distinct: jks(r.jobs).size,
          costUsd: r.costUsd,
          // Charged more than a run returning every row should: an event the
          // plan didn't price, so Apify's limit (the rounded-up reservation)
          // may have cut it short. A full run at the planned prices never is.
          chargeCapReached:
            r.costUsd !== null &&
            fullRunUsd !== undefined &&
            r.costUsd > fullRunUsd + CHARGE_SLACK_USD,
        };
      }),
      notRun: notRun.map((search) => search.id),
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

    // A saved folder from before 2026-11-23 has the old pair, so the runs choose it.
    const remotePair = runs.some(
      (r) => r.searchId === FILTER_REMOTE_PROBE.filtered,
    )
      ? FILTER_REMOTE_PROBE
      : REMOTE_PROBE;
    const remote = probe(actor, runs, remotePair, spell('us-remote'));
    if (remote) remoteFilter[actor] = remote;
    if (actor === 'memo23') {
      const senior = probe(actor, runs, SENIOR_PROBE, spell('us-remote'));
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
  // Cheaper per relevant gate job first; an unknown one last.
  const gateCostOrder = (a: ActorReport, b: ActorReport) =>
    a.costPerRelevantGate === null
      ? b.costPerRelevantGate === null
        ? 0
        : 1
      : b.costPerRelevantGate === null
        ? -1
        : a.costPerRelevantGate - b.costPerRelevantGate;
  const totalRelevant = (actor: ActorName) =>
    PLACES.reduce((s, p) => s + perActor[actor].relevantByPlace[p], 0);
  const pickOrder = ACTOR_ORDER.filter((a) => perActor[a].gate.pass).sort(
    (a, b) =>
      totalRelevant(b) - totalRelevant(a) ||
      passingProbes(b) - passingProbes(a) ||
      (perActor[b].coverage.employerApplyLink ?? 0) -
        (perActor[a].coverage.employerApplyLink ?? 0) ||
      gateCostOrder(perActor[a], perActor[b]) ||
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

/**
 * Pure aggregation and formatting for `db:actor-compare`: every pair of the
 * LinkedIn job-board actors on real outcomes. Credit is by
 * `collection_batches.actor` (a run with no batch by its channel's actor),
 * because a joined job lives under one channel but is seen by several actors.
 *
 * Overlap is fair: the unit is a search group in a tick (the Morocco-time hour
 * a run started), and a pair counts only the (group, tick) cells both actors
 * ran. An actor ran a cell when every one of its builders in that group is in a
 * run of that tick that succeeded, was not stopped at its charge cap, and did
 * not come back full unless it searched that builder alone. A full run of
 * several members is held and searched again in halves, which must cover the
 * builder instead; a full run of one member is lost at its row limit.
 *
 * Days are Morocco days. Pair and three-way tables place a job on the day of
 * its first sighting in the cells they count; the per-actor tables (cost,
 * coverage) place it on the day that actor first saw it.
 */
export const HARVEST_ACTOR = 'harvestapi/linkedin-job-search';
export const CHEAP_ACTOR = 'cheap_scraper/linkedin-job-scraper';
export const BEBITY_ACTOR = 'bebity/linkedin-jobs-scraper';

/** The actor a channel's runs use, for a run that has no batch. */
export const ACTOR_BY_CHANNEL: Record<string, string> = {
  LINKEDIN_JOB_BOARD: HARVEST_ACTOR,
  LINKEDIN_JOB_BOARD_CHEAP: CHEAP_ACTOR,
  LINKEDIN_JOB_BOARD_BEBITY: BEBITY_ACTOR,
};

/** The compared actors, in pair order: harvestapi, cheap_scraper, bebity. */
const ACTORS = [HARVEST_ACTOR, CHEAP_ACTOR, BEBITY_ACTOR];

/** The batch actor, else the channel's. */
export function runActor(batchActor: string | null, channel: string): string {
  return batchActor ?? ACTOR_BY_CHANNEL[channel] ?? channel;
}

/** `harvestapi/linkedin-job-search` → `harvestapi`. */
export function shortActor(actor: string): string {
  return actor.split('/')[0];
}

export interface Sighting {
  jobId: string;
  /** The segment run whose batch held the item. */
  runId: string;
  actor: string;
  seenAt: Date;
  /** The builder's `params.workType` filter: '1' onsite, '2' remote, '3' hybrid. */
  filterWorkType: string | null;
  itemWorkplaceType: 'remote' | 'hybrid' | 'onsite' | null;
}

export interface JobOutcome {
  jobId: string;
  /** Best outcome over the job's current-version matches (qualified > review > rejected). */
  outcome: 'qualified' | 'review' | 'rejected' | null;
  firstFailRule: string | null;
  applied: number;
  dismissed: number;
  workplaceType: boolean;
  place: boolean;
  salary: boolean;
  applyLink: boolean;
  /** `normalized_jobs.processingReason = 'joined'`. */
  joined: boolean;
  /**
   * For a joined job with a current extraction: true when it has no extraction
   * attempt since the join (the extraction was copied), false when it ran
   * Claude. A same-key join keeps the trial's job, so the trial's own earlier
   * attempt does not count.
   * Null when the job is not joined or has no extraction yet.
   */
  joinedReused: boolean | null;
}

/** One `search_segment_runs` row, with or without a batch. */
export interface SegmentRunRow {
  runId: string;
  actor: string;
  channel: string;
  startedAt: Date;
  status: string;
  capped: boolean;
  /** As stored (Apify's final cost once re-read); 0 for a run never started, null when unknown. */
  costMicroUsd: number | null;
  queryIds: string[];
  /** Members the run came back full for: searched again in halves, or lost at the row limit. */
  truncatedQueryIds: string[];
  /**
   * The run returned its channel's row limit (`maxRowsPerSearch`). Only a
   * one-member run at it covers its member; a full run of several members is
   * held for halving, whatever its rows.
   */
  atCeiling: boolean;
}

export interface RunRow extends SegmentRunRow {
  rows: number;
  sentKeyword: string | null;
  echoedKeywords: string[];
}

/** A builder on a compared channel; `group` is its segment key without the channel. */
export interface BuilderRow {
  id: string;
  channel: string;
  group: string;
  /** A tick requires the builder only from its creation. */
  createdAt: Date;
  /**
   * Null while it is active. For an inactive or deleted builder, its
   * `updatedAt`: the last change of its state, which is when it was retired
   * (claims and cursors don't touch `updatedAt`). A tick requires it until then.
   */
  activeUntil: Date | null;
}

export type NotRunReason = 'skipped' | 'not started' | 'failed' | 'capped';
type CellStatus = 'ran' | NotRunReason;

/** `<A> only`, `<B> only` or `both`, within one pair. */
export type PairGroup = string;
const TOTAL = 'total';

export interface PairRow {
  label: string;
  a: string;
  b: string;
  aOnly: number;
  bOnly: number;
  both: number;
  /** Shared jobs A saw first (ties count for neither). */
  aFirst: number;
  bFirst: number;
  /** Median minutes A saw a shared job before B (negative: after). */
  medianLeadMinutes: number | null;
}

/** (group, tick) cells per actor, by status; a tick's cells sit on its Morocco day. */
export interface NotRunRow {
  label: string;
  actor: string;
  ran: number;
  skipped: number;
  notStarted: number;
  failed: number;
  capped: number;
}

/** Jobs by how many actors saw them, on cells all three ran. */
export interface ThreeWayRow {
  label: string;
  one: number;
  two: number;
  three: number;
}

export interface OutcomeRow {
  label: string;
  pair: string;
  group: PairGroup;
  jobs: number;
  qualified: number;
  review: number;
  rejected: number;
  undecided: number;
  applied: number;
  dismissed: number;
}

export interface RejectionRow {
  label: string;
  pair: string;
  group: PairGroup;
  /** The first failing rule of the rejected match; `(unknown)` when none was recorded. */
  rule: string;
  jobs: number;
}

export interface ActorRejectionRow {
  label: string;
  actor: string;
  rule: string;
  jobs: number;
}

export interface GroupCoverageRow {
  label: string;
  pair: string;
  group: PairGroup;
  jobs: number;
  workplaceType: number;
  place: number;
  salary: number;
  applyLink: number;
}

export interface CostRow {
  label: string;
  actor: string;
  runs: number;
  /** Runs with no recorded cost (failed after starting, not re-read yet). */
  noCost: number;
  rows: number;
  costUsd: number;
  jobs: number;
  qualified: number;
  review: number;
  rejected: number;
  undecided: number;
  applied: number;
  dismissed: number;
  costPerQualifiedUsd: number | null;
}

export interface CoverageRow {
  label: string;
  actor: string;
  jobs: number;
  workplaceType: number;
  place: number;
  salary: number;
  applyLink: number;
}

/**
 * harvestapi: sightings checked, and those whose item workplace type
 * contradicts the work-type filter. cheap_scraper: runs checked, and those
 * whose echoed search string lacks the keyword sent. Null: not measurable
 * (bebity echoes no search string).
 */
export interface AiSearchRow {
  label: string;
  actor: string;
  checked: number | null;
  flagged: number | null;
}

export interface JoinedRow {
  label: string;
  joined: number;
  reused: number;
  ranClaude: number;
}

export interface ActorReport {
  pairs: PairRow[];
  notRun: NotRunRow[];
  threeWay: ThreeWayRow[];
  outcomes: OutcomeRow[];
  rejections: RejectionRow[];
  groupCoverage: GroupCoverageRow[];
  cost: CostRow[];
  actorRejections: ActorRejectionRow[];
  coverage: CoverageRow[];
  aiSearch: AiSearchRow[];
  joined: JoinedRow[];
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Casablanca',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function moroccoDay(date: Date): string {
  return dayFormat.format(date);
}

const hourFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Casablanca',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** The Morocco-time hour a run started in, `YYYY-MM-DDTHH`: its tick. */
export function tickOf(startedAt: Date): string {
  const part = (type: string) =>
    hourFormat.formatToParts(startedAt).find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
}

const cellKey = (group: string, tick: string) => `${group}|${tick}`;
const tickOfCell = (key: string) => key.slice(key.lastIndexOf('|') + 1);

/** The reason a builder's runs in a tick give for not covering it, most telling first. */
function reasonOf(runs: SegmentRunRow[]): NotRunReason {
  if (runs.some((r) => r.capped)) return 'capped';
  if (runs.some((r) => r.status !== 'succeeded' && r.costMicroUsd !== 0))
    return 'failed';
  if (runs.some((r) => r.status !== 'succeeded')) return 'not started';
  return 'skipped';
}

interface Cell {
  status: CellStatus;
  /** The group's succeeded, uncapped runs (full ones held for splitting too): its jobs for the actor. */
  runIds: Set<string>;
}

/**
 * Per actor (by builder channel), the status of each (group, tick) cell some
 * actor ran, from the actor's first run onward. Not-run reasons come from the
 * stored runs of the builders not covered.
 */
function cells(
  runs: SegmentRunRow[],
  builders: BuilderRow[],
): Map<string, Map<string, Cell>> {
  // Runs per builder per tick.
  const byBuilderTick = new Map<string, SegmentRunRow[]>();
  const firstTick = new Map<string, string>();
  // A run counts for its channel's actor only: an older trial actor's runs on
  // a trial channel are credited to that actor, which has no builders.
  const own = runs.filter((r) => ACTOR_BY_CHANNEL[r.channel] === r.actor);
  for (const r of own) {
    const tick = tickOf(r.startedAt);
    const actor = r.actor;
    const first = firstTick.get(actor);
    if (!first || tick < first) firstTick.set(actor, tick);
    for (const id of r.queryIds) {
      const key = `${id}|${tick}`;
      byBuilderTick.set(key, [...(byBuilderTick.get(key) ?? []), r]);
    }
  }
  // Builders per actor per group.
  const members = new Map<string, Map<string, BuilderRow[]>>();
  for (const b of builders) {
    const actor = ACTOR_BY_CHANNEL[b.channel] ?? b.channel;
    const groups = members.get(actor) ?? new Map<string, BuilderRow[]>();
    groups.set(b.group, [...(groups.get(b.group) ?? []), b]);
    members.set(actor, groups);
  }
  // Each tick starts at its earliest run: a builder is required in a tick when
  // it existed and was still active then.
  const tickStart = new Map<string, number>();
  for (const r of own) {
    const tick = tickOf(r.startedAt);
    const at = r.startedAt.getTime();
    if (at < (tickStart.get(tick) ?? Infinity)) tickStart.set(tick, at);
  }
  const ticks = [...tickStart.keys()];
  const requiredIn = (b: BuilderRow, tick: string) => {
    const start = tickStart.get(tick) as number;
    return (
      b.createdAt.getTime() <= start &&
      (b.activeUntil === null || b.activeUntil.getTime() >= start)
    );
  };

  const status = new Map<string, Map<string, Cell>>();
  for (const [actor, groups] of members) {
    const mine = new Map<string, Cell>();
    for (const [group, all] of groups)
      for (const tick of ticks) {
        const ids = all.filter((b) => requiredIn(b, tick)).map((b) => b.id);
        if (ids.length === 0) continue;
        const runIds = new Set<string>();
        const missing: SegmentRunRow[][] = [];
        for (const id of ids) {
          const tried = byBuilderTick.get(`${id}|${tick}`) ?? [];
          const good = tried.filter(
            (r) => r.status === 'succeeded' && !r.capped,
          );
          // A full run of several members is held for halving, and covers a
          // member only through its same-tick halves; a full one-member run at
          // the row limit is that member's whole search.
          const covering = good.filter(
            (r) =>
              (r.atCeiling && r.queryIds.length === 1) ||
              !r.truncatedQueryIds.includes(id),
          );
          for (const r of good) runIds.add(r.runId);
          if (covering.length === 0) missing.push(tried);
        }
        if (missing.length === 0) {
          mine.set(cellKey(group, tick), { status: 'ran', runIds });
          continue;
        }
        const reasons = missing.map(reasonOf);
        const order: NotRunReason[] = [
          'capped',
          'failed',
          'not started',
          'skipped',
        ];
        mine.set(cellKey(group, tick), {
          status: order.find((r) => reasons.includes(r)) as NotRunReason,
          runIds: new Set(),
        });
      }
    status.set(actor, mine);
  }
  // Keep a not-run cell only when another actor ran it, from the actor's first run.
  const ranBySomeone = new Set(
    [...status.values()].flatMap((m) =>
      [...m].filter(([, c]) => c.status === 'ran').map(([k]) => k),
    ),
  );
  for (const [actor, mine] of status)
    for (const [key, cell] of mine) {
      const first = firstTick.get(actor);
      const early = !first || tickOfCell(key) < first;
      if ((cell.status !== 'ran' && !ranBySomeone.has(key)) || early)
        mine.delete(key);
    }
  return status;
}

/** Per actor, each (group, tick) cell's status: `ran` or why not. */
export function coverage(
  runs: SegmentRunRow[],
  builders: BuilderRow[],
): Map<string, Map<string, 'ran' | NotRunReason>> {
  return new Map(
    [...cells(runs, builders)].map(([actor, m]) => [
      actor,
      new Map([...m].map(([k, c]) => [k, c.status])),
    ]),
  );
}

const FILTER_TO_WORKPLACE: Record<string, string> = {
  '1': 'onsite',
  '2': 'remote',
  '3': 'hybrid',
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface JobSeen {
  jobId: string;
  /** Earliest sighting per actor. */
  firstByActor: Map<string, Date>;
  first: Date;
}

function groupJobs(
  sightings: Sighting[],
  actorOf: (s: Sighting) => string = (s) => s.actor,
): Map<string, JobSeen> {
  const jobs = new Map<string, JobSeen>();
  for (const s of sightings) {
    const actor = actorOf(s);
    let job = jobs.get(s.jobId);
    if (!job) {
      job = { jobId: s.jobId, firstByActor: new Map(), first: s.seenAt };
      jobs.set(s.jobId, job);
    }
    const prev = job.firstByActor.get(actor);
    if (!prev || s.seenAt < prev) job.firstByActor.set(actor, s.seenAt);
    if (s.seenAt < job.first) job.first = s.seenAt;
  }
  return jobs;
}

function emptyOutcome(label: string, pair: string, group: PairGroup) {
  return {
    label,
    pair,
    group,
    jobs: 0,
    qualified: 0,
    review: 0,
    rejected: 0,
    undecided: 0,
    applied: 0,
    dismissed: 0,
  };
}

function rulesOf<T>(
  counts: Map<string, number>,
  make: (rule: string, jobs: number) => T & { rule: string; jobs: number },
): T[] {
  return [...counts]
    .map(([rule, jobs]) => make(rule, jobs))
    .sort((a, b) => b.jobs - a.jobs || a.rule.localeCompare(b.rule));
}

export function buildActorReport(
  sightings: Sighting[],
  outcomes: JobOutcome[],
  runs: RunRow[],
  builders: BuilderRow[],
): ActorReport {
  const jobs = groupJobs(sightings);
  const outcomeById = new Map(outcomes.map((o) => [o.jobId, o]));
  const cellsByActor = cells(runs, builders);

  const days = new Set<string>();
  for (const s of sightings) days.add(moroccoDay(s.seenAt));
  for (const r of runs) days.add(moroccoDay(r.startedAt));
  const labels = [...[...days].sort(), TOTAL];
  const inLabel = (label: string, date: Date) =>
    label === TOTAL || moroccoDay(date) === label;

  const actors = [
    ...ACTORS,
    ...[
      ...new Set([
        ...sightings.map((s) => s.actor),
        ...runs.map((r) => r.actor),
      ]),
    ]
      .filter((a) => !ACTORS.includes(a))
      .sort(),
  ];

  /** Sightings in the cells every one of `among` ran, credited to the cell's actor. */
  const fairJobs = (among: string[]): Map<string, JobSeen> => {
    const keys = [...(cellsByActor.get(among[0])?.keys() ?? [])].filter((k) =>
      among.every((a) => cellsByActor.get(a)?.get(k)?.status === 'ran'),
    );
    const actorOfRun = new Map<string, string>();
    for (const a of among)
      for (const k of keys)
        for (const id of cellsByActor.get(a)?.get(k)?.runIds ?? [])
          actorOfRun.set(id, a);
    const fair = sightings.filter((s) => actorOfRun.has(s.runId));
    return groupJobs(fair, (s) => actorOfRun.get(s.runId) as string);
  };

  const pairs: PairRow[] = [];
  const outcomeRows: OutcomeRow[] = [];
  const rejectionRows: RejectionRow[] = [];
  const groupCoverage: GroupCoverageRow[] = [];
  for (let i = 0; i < ACTORS.length; i++)
    for (let j = i + 1; j < ACTORS.length; j++) {
      const [a, b] = [ACTORS[i], ACTORS[j]];
      const pair = `${shortActor(a)}–${shortActor(b)}`;
      const groups = [`${shortActor(a)} only`, `${shortActor(b)} only`, 'both'];
      const fair = [...fairJobs([a, b]).values()];
      for (const label of labels) {
        const row: PairRow = {
          label,
          a,
          b,
          aOnly: 0,
          bOnly: 0,
          both: 0,
          aFirst: 0,
          bFirst: 0,
          medianLeadMinutes: null,
        };
        const leads: number[] = [];
        const byGroup = new Map(
          groups.map((g) => [g, emptyOutcome(label, pair, g)]),
        );
        const cover = new Map(
          groups.map((g) => [
            g,
            {
              label,
              pair,
              group: g,
              jobs: 0,
              workplaceType: 0,
              place: 0,
              salary: 0,
              applyLink: 0,
            },
          ]),
        );
        const rules = new Map(
          groups.map((g) => [g, new Map<string, number>()]),
        );
        for (const job of fair.filter((x) => inLabel(label, x.first))) {
          const ta = job.firstByActor.get(a);
          const tb = job.firstByActor.get(b);
          const group = ta && tb ? groups[2] : ta ? groups[0] : groups[1];
          if (ta && tb) {
            row.both++;
            const lead = (tb.getTime() - ta.getTime()) / 60_000;
            leads.push(lead);
            if (lead > 0) row.aFirst++;
            else if (lead < 0) row.bFirst++;
          } else if (ta) row.aOnly++;
          else row.bOnly++;

          const o = outcomeById.get(job.jobId);
          const out = byGroup.get(group) as OutcomeRow;
          out.jobs++;
          if (o?.outcome) out[o.outcome]++;
          else out.undecided++;
          out.applied += o?.applied ?? 0;
          out.dismissed += o?.dismissed ?? 0;
          if (o?.outcome === 'rejected') {
            const r = rules.get(group) as Map<string, number>;
            const rule = o.firstFailRule ?? '(unknown)';
            r.set(rule, (r.get(rule) ?? 0) + 1);
          }
          const cv = cover.get(group) as GroupCoverageRow;
          cv.jobs++;
          if (o?.workplaceType) cv.workplaceType++;
          if (o?.place) cv.place++;
          if (o?.salary) cv.salary++;
          if (o?.applyLink) cv.applyLink++;
        }
        row.medianLeadMinutes = median(leads);
        pairs.push(row);
        outcomeRows.push(...byGroup.values());
        groupCoverage.push(...cover.values());
        for (const g of groups)
          rejectionRows.push(
            ...rulesOf(rules.get(g) as Map<string, number>, (rule, n) => ({
              label,
              pair,
              group: g,
              rule,
              jobs: n,
            })),
          );
      }
    }

  const notRun: NotRunRow[] = [];
  for (const label of labels)
    for (const actor of ACTORS) {
      const row: NotRunRow = {
        label,
        actor,
        ran: 0,
        skipped: 0,
        notStarted: 0,
        failed: 0,
        capped: 0,
      };
      for (const [key, cell] of cellsByActor.get(actor) ?? []) {
        if (label !== TOTAL && tickOfCell(key).slice(0, 10) !== label) continue;
        if (cell.status === 'ran') row.ran++;
        else if (cell.status === 'not started') row.notStarted++;
        else row[cell.status]++;
      }
      notRun.push(row);
    }

  const allThree = [...fairJobs(ACTORS).values()];
  const threeWay: ThreeWayRow[] = labels.map((label) => {
    const row: ThreeWayRow = { label, one: 0, two: 0, three: 0 };
    for (const job of allThree.filter((x) => inLabel(label, x.first))) {
      const n = job.firstByActor.size;
      if (n === 1) row.one++;
      else if (n === 2) row.two++;
      else row.three++;
    }
    return row;
  });

  const cost: CostRow[] = [];
  const actorRejections: ActorRejectionRow[] = [];
  const coverageRows: CoverageRow[] = [];
  const joinedRows: JoinedRow[] = [];
  for (const label of labels) {
    for (const actor of actors) {
      const actorRuns = runs.filter(
        (r) => r.actor === actor && inLabel(label, r.startedAt),
      );
      const seen = [...jobs.values()].filter((j) => {
        const d = j.firstByActor.get(actor);
        return d !== undefined && inLabel(label, d);
      });
      const outs = seen.map((j) => outcomeById.get(j.jobId));
      const count = (o: JobOutcome['outcome']) =>
        outs.filter((x) => (x?.outcome ?? null) === o).length;
      const qualified = count('qualified');
      const costUsd =
        actorRuns.reduce((n, r) => n + (r.costMicroUsd ?? 0), 0) / 1e6;
      cost.push({
        label,
        actor,
        runs: actorRuns.length,
        noCost: actorRuns.filter((r) => r.costMicroUsd === null).length,
        rows: actorRuns.reduce((n, r) => n + r.rows, 0),
        costUsd,
        jobs: seen.length,
        qualified,
        review: count('review'),
        rejected: count('rejected'),
        undecided: count(null),
        applied: outs.reduce((n, o) => n + (o?.applied ?? 0), 0),
        dismissed: outs.reduce((n, o) => n + (o?.dismissed ?? 0), 0),
        costPerQualifiedUsd: qualified > 0 ? costUsd / qualified : null,
      });
      const rules = new Map<string, number>();
      for (const o of outs)
        if (o?.outcome === 'rejected') {
          const rule = o.firstFailRule ?? '(unknown)';
          rules.set(rule, (rules.get(rule) ?? 0) + 1);
        }
      actorRejections.push(
        ...rulesOf(rules, (rule, n) => ({ label, actor, rule, jobs: n })),
      );
      coverageRows.push({
        label,
        actor,
        jobs: seen.length,
        workplaceType: outs.filter((o) => o?.workplaceType).length,
        place: outs.filter((o) => o?.place).length,
        salary: outs.filter((o) => o?.salary).length,
        applyLink: outs.filter((o) => o?.applyLink).length,
      });
    }
    const joined: JoinedRow = { label, joined: 0, reused: 0, ranClaude: 0 };
    for (const job of jobs.values()) {
      const o = outcomeById.get(job.jobId);
      if (!inLabel(label, job.first) || !o?.joined) continue;
      joined.joined++;
      if (o.joinedReused === true) joined.reused++;
      else if (o.joinedReused === false) joined.ranClaude++;
    }
    joinedRows.push(joined);
  }

  const aiSearch: AiSearchRow[] = labels.flatMap((label) =>
    ACTORS.map((actor) => {
      if (actor === HARVEST_ACTOR) {
        const seen = sightings.filter(
          (s) => s.actor === actor && inLabel(label, s.seenAt),
        );
        return {
          label,
          actor,
          checked: seen.length,
          flagged: seen.filter(contradicts).length,
        };
      }
      if (actor === BEBITY_ACTOR)
        return { label, actor, checked: null, flagged: null };
      const actorRuns = runs.filter(
        (r) =>
          r.actor === actor &&
          r.status === 'succeeded' &&
          inLabel(label, r.startedAt),
      );
      return {
        label,
        actor,
        checked: actorRuns.length,
        flagged: actorRuns.filter(isRewritten).length,
      };
    }),
  );

  return {
    pairs,
    notRun,
    threeWay,
    outcomes: outcomeRows,
    rejections: rejectionRows,
    groupCoverage,
    cost,
    actorRejections,
    coverage: coverageRows,
    aiSearch,
    joined: joinedRows,
  };
}

function contradicts(s: Sighting): boolean {
  return (
    s.filterWorkType !== null &&
    s.itemWorkplaceType !== null &&
    FILTER_TO_WORKPLACE[s.filterWorkType] !== undefined &&
    FILTER_TO_WORKPLACE[s.filterWorkType] !== s.itemWorkplaceType
  );
}

function isRewritten(run: RunRow): boolean {
  if (!run.sentKeyword || run.echoedKeywords.length === 0) return false;
  const sent = run.sentKeyword.toLowerCase();
  return !run.echoedKeywords.some((e) => e.toLowerCase().includes(sent));
}

function table(
  title: string,
  header: string[],
  rows: (string | number)[][],
  textColumns = 2,
): string {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) =>
    Math.max(...cells.map((r) => r[i].length)),
  );
  const line = (r: string[]) =>
    r
      .map((c, i) =>
        i < textColumns && isNaN(Number(c))
          ? c.padEnd(widths[i])
          : c.padStart(widths[i]),
      )
      .join('  ');
  return [`\n${title}`, ...cells.map((r) => '  ' + line(r))].join('\n');
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number, d: number) =>
  d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
const pairOf = (r: { a: string; b: string }) =>
  `${shortActor(r.a)}–${shortActor(r.b)}`;

export function formatActorReport(report: ActorReport): string {
  const parts: string[] = [];
  parts.push(
    table(
      'Overlap per pair (only (group, tick) cells both actors ran; jobs by first sighting day; lead = minutes A saw a shared job before B)',
      [
        'day',
        'pair (A–B)',
        'A',
        'B',
        'both',
        'A only',
        'B only',
        'shared: A first',
        'shared: B first',
        'median lead',
      ],
      report.pairs.map((r) => [
        r.label,
        pairOf(r),
        r.aOnly + r.both,
        r.bOnly + r.both,
        r.both,
        r.aOnly,
        r.bOnly,
        r.aFirst,
        r.bFirst,
        r.medianLeadMinutes === null ? '—' : `${r.medianLeadMinutes} min`,
      ]),
    ),
    table(
      'Not run ((group, tick) cells another actor ran; skipped = no run (daily cap or tick limit), not started = failed at $0, failed, capped = stopped at its charge cap)',
      ['day', 'actor', 'ran', 'skipped', 'not started', 'failed', 'capped'],
      report.notRun.map((r) => [
        r.label,
        shortActor(r.actor),
        r.ran,
        r.skipped,
        r.notStarted,
        r.failed,
        r.capped,
      ]),
    ),
    table(
      'All three (jobs seen by one, two or three actors, on cells all three ran)',
      ['day', 'one', 'two', 'three'],
      report.threeWay.map((r) => [r.label, r.one, r.two, r.three]),
      1,
    ),
    table(
      'Outcomes per pair group (best outcome over current matches; decisions are applied/dismissed)',
      [
        'day',
        'pair',
        'group',
        'jobs',
        'qualified',
        'review',
        'rejected',
        'undecided',
        'applied',
        'dismissed',
      ],
      report.outcomes.map((r) => [
        r.label,
        r.pair,
        r.group,
        r.jobs,
        r.qualified,
        r.review,
        r.rejected,
        r.undecided,
        r.applied,
        r.dismissed,
      ]),
      3,
    ),
    table(
      'Rejections by first failing rule (per pair group)',
      ['day', 'pair', 'group', 'rule', 'jobs'],
      report.rejections.map((r) => [r.label, r.pair, r.group, r.rule, r.jobs]),
      4,
    ),
    table(
      "Coverage per pair group (share of the group's jobs with the field set)",
      [
        'day',
        'pair',
        'group',
        'jobs',
        'workplace',
        'place',
        'salary',
        'apply link',
      ],
      report.groupCoverage.map((r) => [
        r.label,
        r.pair,
        r.group,
        r.jobs,
        pct(r.workplaceType, r.jobs),
        pct(r.place, r.jobs),
        pct(r.salary, r.jobs),
        pct(r.applyLink, r.jobs),
      ]),
      3,
    ),
    table(
      'Cost per qualified job (by batch actor, a run with no batch by its channel; stored cost, final once re-read; no cost = runs not costed yet; jobs on the day the actor first saw them)',
      [
        'day',
        'actor',
        'runs',
        'no cost',
        'rows',
        'cost',
        'jobs',
        'qualified',
        'review',
        'rejected',
        'undecided',
        'applied',
        'dismissed',
        'per qualified',
      ],
      report.cost.map((r) => [
        r.label,
        r.actor,
        r.runs,
        r.noCost,
        r.rows,
        usd(r.costUsd),
        r.jobs,
        r.qualified,
        r.review,
        r.rejected,
        r.undecided,
        r.applied,
        r.dismissed,
        r.costPerQualifiedUsd === null ? '—' : usd(r.costPerQualifiedUsd),
      ]),
    ),
    table(
      'Rejections by first failing rule (per actor)',
      ['day', 'actor', 'rule', 'jobs'],
      report.actorRejections.map((r) => [r.label, r.actor, r.rule, r.jobs]),
      3,
    ),
    table(
      "Coverage (share of the actor's jobs with the field set)",
      ['day', 'actor', 'jobs', 'workplace', 'place', 'salary', 'apply link'],
      report.coverage.map((r) => [
        r.label,
        r.actor,
        r.jobs,
        pct(r.workplaceType, r.jobs),
        pct(r.place, r.jobs),
        pct(r.salary, r.jobs),
        pct(r.applyLink, r.jobs),
      ]),
    ),
    table(
      'AI search (harvestapi: sightings whose item contradicts the work-type filter; cheap_scraper: runs whose keyword the actor rewrote; bebity echoes no search string)',
      ['day', 'actor', 'checked', 'flagged'],
      report.aiSearch.map((r) => [
        r.label,
        shortActor(r.actor),
        r.checked ?? 'n/a',
        r.flagged ?? 'n/a',
      ]),
    ),
    table(
      'Joined jobs (joined = reason joined; reused = extraction copied, no attempt of its own)',
      ['day', 'joined', 'reused', 'ran Claude'],
      report.joined.map((r) => [r.label, r.joined, r.reused, r.ranClaude]),
      1,
    ),
  );
  return parts.join('\n');
}

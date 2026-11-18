/**
 * Pure aggregation and formatting for `db:actor-compare`: harvestapi against
 * the trial actors on real outcomes. Credit is by `collection_batches.actor`,
 * never by channel, because a joined job lives under one channel but is seen by
 * both actors.
 *
 * Days are Morocco days. Overlap and outcomes place a job on the day of its
 * first sighting by any actor; the per-actor tables (cost, coverage) place it
 * on the day that actor first saw it.
 */
export const HARVEST_ACTOR = 'harvestapi/linkedin-job-search';

export interface Sighting {
  jobId: string;
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
   * attempt of its own (the extraction was copied), false when it ran Claude.
   * Null when the job is not joined or has no extraction yet.
   */
  joinedReused: boolean | null;
}

export interface RunRow {
  actor: string;
  startedAt: Date;
  rows: number;
  costMicroUsd: number | null;
  sentKeyword: string | null;
  echoedKeywords: string[];
}

export type Group = 'harvest only' | 'trial only' | 'both';
const GROUPS: Group[] = ['harvest only', 'trial only', 'both'];
const TOTAL = 'total';

export interface OverlapRow {
  label: string;
  harvest: number;
  trial: number;
  both: number;
  harvestOnly: number;
  trialOnly: number;
  /** Median minutes harvestapi saw a shared job before the trial (negative: after). */
  medianLeadMinutes: number | null;
}

export interface OutcomeRow {
  label: string;
  group: Group;
  jobs: number;
  qualified: number;
  review: number;
  rejected: number;
  undecided: number;
  applied: number;
  dismissed: number;
}

export interface CostRow {
  label: string;
  actor: string;
  runs: number;
  rows: number;
  costUsd: number;
  jobs: number;
  qualified: number;
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

export interface AiSearchRow {
  label: string;
  harvestSightings: number;
  /** Harvest sightings whose item workplace type contradicts the search's work-type filter. */
  contradicting: number;
  trialRuns: number;
  /** Trial runs whose echoed search string lacks the keyword that was sent. */
  rewritten: number;
}

export interface JoinedRow {
  label: string;
  joined: number;
  reused: number;
  ranClaude: number;
}

export interface ActorReport {
  harvestActor: string;
  overlap: OverlapRow[];
  outcomes: OutcomeRow[];
  cost: CostRow[];
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

function groupJobs(sightings: Sighting[]): Map<string, JobSeen> {
  const jobs = new Map<string, JobSeen>();
  for (const s of sightings) {
    let job = jobs.get(s.jobId);
    if (!job) {
      job = { jobId: s.jobId, firstByActor: new Map(), first: s.seenAt };
      jobs.set(s.jobId, job);
    }
    const prev = job.firstByActor.get(s.actor);
    if (!prev || s.seenAt < prev) job.firstByActor.set(s.actor, s.seenAt);
    if (s.seenAt < job.first) job.first = s.seenAt;
  }
  return jobs;
}

export function buildActorReport(
  sightings: Sighting[],
  outcomes: JobOutcome[],
  runs: RunRow[],
  harvestActor = HARVEST_ACTOR,
): ActorReport {
  const jobs = groupJobs(sightings);
  const outcomeById = new Map(outcomes.map((o) => [o.jobId, o]));
  const isTrial = (actor: string) => actor !== harvestActor;

  const days = new Set<string>();
  for (const s of sightings) days.add(moroccoDay(s.seenAt));
  for (const r of runs) days.add(moroccoDay(r.startedAt));
  const labels = [...[...days].sort(), TOTAL];
  const inLabel = (label: string, date: Date) =>
    label === TOTAL || moroccoDay(date) === label;

  const actors = [
    ...new Set([
      harvestActor,
      ...sightings.map((s) => s.actor),
      ...runs.map((r) => r.actor),
    ]),
  ].sort((a, b) =>
    a === harvestActor ? -1 : b === harvestActor ? 1 : a.localeCompare(b),
  );

  const groupOf = (job: JobSeen): Group => {
    const h = job.firstByActor.has(harvestActor);
    const t = [...job.firstByActor.keys()].some(isTrial);
    return h && t ? 'both' : h ? 'harvest only' : 'trial only';
  };

  const overlap: OverlapRow[] = [];
  const outcomeRows: OutcomeRow[] = [];
  const joinedRows: JoinedRow[] = [];
  for (const label of labels) {
    const set = [...jobs.values()].filter((j) => inLabel(label, j.first));
    const row: OverlapRow = {
      label,
      harvest: 0,
      trial: 0,
      both: 0,
      harvestOnly: 0,
      trialOnly: 0,
      medianLeadMinutes: null,
    };
    const leads: number[] = [];
    const byGroup = new Map<Group, OutcomeRow>(
      GROUPS.map((group) => [
        group,
        {
          label,
          group,
          jobs: 0,
          qualified: 0,
          review: 0,
          rejected: 0,
          undecided: 0,
          applied: 0,
          dismissed: 0,
        },
      ]),
    );
    const joined: JoinedRow = { label, joined: 0, reused: 0, ranClaude: 0 };
    for (const job of set) {
      const group = groupOf(job);
      if (group !== 'trial only') row.harvest++;
      if (group !== 'harvest only') row.trial++;
      if (group === 'both') {
        row.both++;
        const h = job.firstByActor.get(harvestActor) as Date;
        const t = Math.min(
          ...[...job.firstByActor]
            .filter(([a]) => isTrial(a))
            .map(([, d]) => d.getTime()),
        );
        leads.push((t - h.getTime()) / 60_000);
      } else if (group === 'harvest only') row.harvestOnly++;
      else row.trialOnly++;

      const o = outcomeById.get(job.jobId);
      const out = byGroup.get(group) as OutcomeRow;
      out.jobs++;
      if (o?.outcome) out[o.outcome]++;
      else out.undecided++;
      out.applied += o?.applied ?? 0;
      out.dismissed += o?.dismissed ?? 0;
      if (o?.joined) {
        joined.joined++;
        if (o.joinedReused === true) joined.reused++;
        else if (o.joinedReused === false) joined.ranClaude++;
      }
    }
    row.medianLeadMinutes = median(leads);
    overlap.push(row);
    outcomeRows.push(...GROUPS.map((g) => byGroup.get(g) as OutcomeRow));
    joinedRows.push(joined);
  }

  const cost: CostRow[] = [];
  const coverage: CoverageRow[] = [];
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
      const qualified = outs.filter((o) => o?.outcome === 'qualified').length;
      const costUsd =
        actorRuns.reduce((n, r) => n + (r.costMicroUsd ?? 0), 0) / 1e6;
      cost.push({
        label,
        actor,
        runs: actorRuns.length,
        rows: actorRuns.reduce((n, r) => n + r.rows, 0),
        costUsd,
        jobs: seen.length,
        qualified,
        costPerQualifiedUsd: qualified > 0 ? costUsd / qualified : null,
      });
      coverage.push({
        label,
        actor,
        jobs: seen.length,
        workplaceType: outs.filter((o) => o?.workplaceType).length,
        place: outs.filter((o) => o?.place).length,
        salary: outs.filter((o) => o?.salary).length,
        applyLink: outs.filter((o) => o?.applyLink).length,
      });
    }
  }

  const aiSearch: AiSearchRow[] = labels.map((label) => {
    const harvest = sightings.filter(
      (s) => s.actor === harvestActor && inLabel(label, s.seenAt),
    );
    const trialRuns = runs.filter(
      (r) => isTrial(r.actor) && inLabel(label, r.startedAt),
    );
    return {
      label,
      harvestSightings: harvest.length,
      contradicting: harvest.filter(
        (s) =>
          s.filterWorkType !== null &&
          s.itemWorkplaceType !== null &&
          FILTER_TO_WORKPLACE[s.filterWorkType] !== undefined &&
          FILTER_TO_WORKPLACE[s.filterWorkType] !== s.itemWorkplaceType,
      ).length,
      trialRuns: trialRuns.length,
      rewritten: trialRuns.filter(isRewritten).length,
    };
  });

  return {
    harvestActor,
    overlap,
    outcomes: outcomeRows,
    cost,
    coverage,
    aiSearch,
    joined: joinedRows,
  };
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
): string {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) =>
    Math.max(...cells.map((r) => r[i].length)),
  );
  const line = (r: string[]) =>
    r
      .map((c, i) =>
        i < 2 && isNaN(Number(c)) ? c.padEnd(widths[i]) : c.padStart(widths[i]),
      )
      .join('  ');
  return [`\n${title}`, ...cells.map((r, i) => '  ' + line(r))].join('\n');
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number, d: number) =>
  d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;

export function formatActorReport(report: ActorReport): string {
  const parts: string[] = [];
  parts.push(
    table(
      'Overlap (jobs by first sighting day; lead = minutes harvestapi saw a shared job before the trial)',
      [
        'day',
        'harvest',
        'trial',
        'both',
        'harvest only',
        'trial only',
        'median lead',
      ],
      report.overlap.map((r) => [
        r.label,
        r.harvest,
        r.trial,
        r.both,
        r.harvestOnly,
        r.trialOnly,
        r.medianLeadMinutes === null ? '—' : `${r.medianLeadMinutes} min`,
      ]),
    ),
    table(
      'Outcomes by group (best outcome over current matches; decisions are applied/dismissed)',
      [
        'day',
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
        r.group,
        r.jobs,
        r.qualified,
        r.review,
        r.rejected,
        r.undecided,
        r.applied,
        r.dismissed,
      ]),
    ),
    table(
      'Cost per qualified job (by batch actor; jobs counted on the day the actor first saw them)',
      [
        'day',
        'actor',
        'runs',
        'rows',
        'cost',
        'jobs',
        'qualified',
        'per qualified',
      ],
      report.cost.map((r) => [
        r.label,
        r.actor,
        r.runs,
        r.rows,
        usd(r.costUsd),
        r.jobs,
        r.qualified,
        r.costPerQualifiedUsd === null ? '—' : usd(r.costPerQualifiedUsd),
      ]),
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
      'AI search (harvest filter contradicted by the item; trial keyword rewritten by the actor)',
      ['day', 'harvest sightings', 'contradicting', 'trial runs', 'rewritten'],
      report.aiSearch.map((r) => [
        r.label,
        r.harvestSightings,
        r.contradicting,
        r.trialRuns,
        r.rewritten,
      ]),
    ),
    table(
      'Joined jobs (joined = reason joined; reused = extraction copied, no attempt of its own)',
      ['day', 'joined', 'reused', 'ran Claude'],
      report.joined.map((r) => [r.label, r.joined, r.reused, r.ranClaude]),
    ),
  );
  return parts.join('\n');
}

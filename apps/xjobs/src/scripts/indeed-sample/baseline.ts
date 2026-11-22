import { moroccoDay } from '../actor-compare/report';
import { ENGINEERING_TITLE } from '../linkedin-region-test/logic';
import { mentions } from '../spellings/logic';
import type { PlaceId } from './actors';

export const PLACE_GROUPS: Record<
  PlaceId,
  { location: string; type: 'remote' | 'onsite' }
> = {
  'us-remote': { location: 'united states', type: 'remote' },
  'uk-remote': { location: 'europe', type: 'remote' },
  'ma-onsite': { location: 'morocco', type: 'onsite' },
};

export const GATE_PLACES: PlaceId[] = ['us-remote', 'ma-onsite'];

const PLACES = Object.keys(PLACE_GROUPS) as PlaceId[];
const WINDOW_DAYS = 7;
const MIN_SHARE = 0.9;

export interface BaselineRun {
  place: PlaceId;
  startedAt: Date;
  /** Lowercase `'succeeded'` for a finished run (the caller normalizes). */
  status: string;
  capped: boolean;
  costMicroUsd: number | null;
  costFinal: boolean;
}

export interface BaselineJob {
  place: PlaceId;
  jobId: string;
  title: string | null;
  descriptionText: string | null;
}

/**
 * The title alone must match `ENGINEERING_TITLE` (a null title is not
 * relevant), and at least one searched spelling must appear in the title or the
 * description. No spellings means not relevant.
 */
export function isRelevant(
  job: { title: string | null; descriptionText: string | null },
  spellings: readonly string[],
): boolean {
  if (job.title === null || !ENGINEERING_TITLE.test(job.title)) return false;
  const text = [job.title, job.descriptionText]
    .filter((s): s is string => s !== null)
    .join('\n');
  return spellings.some((s) => mentions(text, s));
}

function previousDays(today: string, count: number): string[] {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(base - (i + 1) * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * The latest Morocco day, among the 7 before `today` (today excluded), on which
 * every place ran, every run succeeded uncapped with a final cost, and each
 * place's run count is at least 90% of its busiest day in the window.
 */
export function pickBaselineDay(
  runs: BaselineRun[],
  today: string,
): { day: string | null; reason?: string } {
  const days = previousDays(today, WINDOW_DAYS); // latest first
  const counts = new Map<string, Map<PlaceId, BaselineRun[]>>();
  for (const d of days) counts.set(d, new Map(PLACES.map((p) => [p, []])));
  for (const r of runs)
    counts.get(moroccoDay(r.startedAt))?.get(r.place)?.push(r);

  const peak = (p: PlaceId) =>
    Math.max(...days.map((d) => counts.get(d)?.get(p)?.length ?? 0));
  const peaks = Object.fromEntries(PLACES.map((p) => [p, peak(p)])) as Record<
    PlaceId,
    number
  >;

  const failure = (d: string): string | null => {
    for (const p of PLACES) {
      const dayRuns = counts.get(d)?.get(p) ?? [];
      if (dayRuns.length === 0) return `${p} had no run`;
      if (dayRuns.some((r) => r.status !== 'succeeded'))
        return `${p} had a run that did not succeed`;
      if (dayRuns.some((r) => r.capped)) return `${p} had a capped run`;
      if (dayRuns.some((r) => !r.costFinal))
        return `${p} had a run without a final cost`;
      if (dayRuns.length < MIN_SHARE * peaks[p])
        return `${p} had ${dayRuns.length} runs, under 90% of its peak ${peaks[p]}`;
    }
    return null;
  };

  let latestCause: string | null = null;
  for (const d of days) {
    const cause = failure(d);
    if (cause === null) return { day: d };
    latestCause ??= `${d}: ${cause}`;
  }
  return {
    day: null,
    reason: `no full day in the ${WINDOW_DAYS} days before ${today} (latest ${latestCause})`,
  };
}

/**
 * Cost and relevant-job yield per place. Counts every run and job it is given,
 * so the caller passes only the chosen day's runs and jobs. Every place gets an
 * entry; jobs are deduped by `jobId` per place.
 */
export function baselineCost(
  runs: BaselineRun[],
  jobs: BaselineJob[],
  spellings: Record<PlaceId, string[]>,
): Record<
  PlaceId,
  { costUsd: number; relevant: number; perRelevantUsd: number | null }
> {
  const out = {} as ReturnType<typeof baselineCost>;
  for (const p of PLACES) {
    const costUsd =
      runs
        .filter((r) => r.place === p)
        .reduce((sum, r) => sum + (r.costMicroUsd ?? 0), 0) / 1e6;
    const relevantIds = new Set(
      jobs
        .filter((j) => j.place === p && isRelevant(j, spellings[p] ?? []))
        .map((j) => j.jobId),
    );
    const relevant = relevantIds.size;
    out[p] = {
      costUsd,
      relevant,
      perRelevantUsd: relevant === 0 ? null : costUsd / relevant,
    };
  }
  return out;
}

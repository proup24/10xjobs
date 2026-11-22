/**
 * The sample folder's files: `plan.json` (the dry-run object, everything a
 * `--from` replay needs) and one `<actor>/<searchId>.json` per finished run.
 * Pure: the caller passes the file reader.
 */
import { join } from 'node:path';
import {
  ACTORS,
  type ActorName,
  type PlaceId,
  type SampleSearch,
} from './actors';
import type { Keywords, PlannedRun } from './plan';
import type { BaselineInput, RunResult } from './report';

export interface PlanFileRun {
  actor: ActorName;
  searchId: string;
  search: SampleSearch;
  input: Record<string, unknown>;
  reservedUsd: number;
}

export interface PlanFile {
  dryRun: true;
  profile: string;
  keywords: Keywords;
  /** The other keywords of each place's group, printed and not sampled. */
  otherKeywords: Record<PlaceId, string[]>;
  /** The union of each place's group spellings: the relevance rule's terms. */
  spellings: Record<PlaceId, string[]>;
  baselineDay: string | null;
  baselineReason?: string;
  /** Null when there is no baseline day. */
  baseline: BaselineInput | null;
  runs: PlanFileRun[];
  reservedUsd: number;
  capUsd: number;
  fits: boolean;
}

/** What the paid loop writes per run. */
export interface RunFile {
  runId: string;
  status: string;
  usageTotalUsd: number | null;
  items: Record<string, unknown>[];
}

export function parsePlanFile(text: string): PlanFile {
  const plan = JSON.parse(text) as Partial<PlanFile>;
  for (const key of ['runs', 'keywords', 'spellings', 'baseline'] as const) {
    if (plan[key] === undefined) throw new Error(`plan.json has no ${key}`);
  }
  if (!Array.isArray(plan.runs))
    throw new Error('plan.json runs is not a list');
  return plan as PlanFile;
}

export function plannedRuns(plan: PlanFile): PlannedRun[] {
  return plan.runs.map((r) => ({
    actor: r.actor,
    search: r.search,
    input: r.input,
    reservedUsd: r.reservedUsd,
  }));
}

export function runFilePath(
  folder: string,
  actor: ActorName,
  searchId: string,
): string {
  return join(folder, actor, `${searchId}.json`);
}

/**
 * One RunResult per planned run whose file exists and whose Apify status is
 * `SUCCEEDED`; anything else is left out, so the report lists it in `notRun`.
 */
export function readResults(
  folder: string,
  planned: PlannedRun[],
  readFile: (path: string) => string | null,
): RunResult[] {
  const results: RunResult[] = [];
  for (const run of planned) {
    const text = readFile(runFilePath(folder, run.actor, run.search.id));
    if (text === null) continue;
    const file = JSON.parse(text) as RunFile;
    if (file.status !== 'SUCCEEDED') continue;
    results.push({
      actor: run.actor,
      searchId: run.search.id,
      place: run.search.place,
      costUsd:
        typeof file.usageTotalUsd === 'number' ? file.usageTotalUsd : null,
      jobs: (file.items ?? []).map((item) => ACTORS[run.actor].readItem(item)),
    });
  }
  return results;
}

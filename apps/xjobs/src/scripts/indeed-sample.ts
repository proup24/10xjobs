/**
 * PAID one-off, run only by the maintainer: Phase 5 slice 01's sample of four
 * Apify Indeed actors, compared with harvestapi's dev baseline.
 *
 *   pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <id> --dry-run
 *   pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <id>
 *   pnpm --filter @xjobs/xjobs db:indeed-sample -- --from tmp/indeed-sample/<ts>
 *
 * Reads the profile's keywords, the live LinkedIn groups of each sampled
 * place and harvestapi's latest full baseline day, fetches the actors' public
 * prices and plans every run with its reserved spend. `--dry-run` prints that
 * plan and exits before APIFY_TOKEN is read. The paid path refuses a plan over
 * the cap or without a baseline day, runs one actor run at a time, saves the
 * raw items under `tmp/indeed-sample/<ISO time>/`, re-reads each run's final
 * cost after 5 minutes and writes `report.json`. `--from <folder>` rebuilds the
 * report from a saved folder without Apify (it still reads dev's jobs for the
 * overlap). Refuses a remote database unless `XJOBS_ALLOW_REMOTE_DB=1`. It
 * writes nothing to the database.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { Channel } from 'src/common/enums';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, type DatabaseClient } from 'src/database';
import { isStrongJobKey, jobKey } from 'src/modules/ingest/normalize/job-key';
import { emptyRecord } from 'src/modules/ingest/normalize/record';
import { moroccoDay } from './actor-compare/report';
import { ACTORS, type ActorName, type PlaceId } from './indeed-sample/actors';
import { parseSampleArgs, SAMPLE_USAGE } from './indeed-sample/args';
import {
  baselineCost,
  PLACE_GROUPS,
  pickBaselineDay,
  type BaselineJob,
} from './indeed-sample/baseline';
import {
  parsePlanFile,
  plannedRuns,
  readResults,
  runFilePath,
  type PlanFile,
  type RunFile,
} from './indeed-sample/files';
import {
  buildPlan,
  parseEventPrices,
  type EventPrices,
  type PlannedRun,
} from './indeed-sample/plan';
import {
  loadBaselineJobs,
  loadBaselineRuns,
  loadDevLookup,
  loadPlaceGroups,
  loadPlainKeyword,
} from './indeed-sample/queries';
import { buildReport, titleCompanyKey } from './indeed-sample/report';

// apps/xjobs/src/scripts → the repo root (the app is CommonJS, so no import.meta).
const REPO_ROOT = resolve(__dirname, '../../../..');
const PLACES = Object.keys(PLACE_GROUPS) as PlaceId[];
const BASELINE_LOAD_DAYS = 8;
const WAIT_SECS = 900;
const LATE_CHARGES_MS = 5 * 60_000;

const logger = new Logger('IndeedSample');

async function withDb<T>(
  optIn: ReturnType<typeof captureRemoteOptIn>,
  fn: (db: DatabaseClient) => Promise<T>,
): Promise<T> {
  const env = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: env.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(env), logger);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/** Public act JSON, no token: each actor's FREE-tier event prices. */
async function fetchPrices(): Promise<Record<ActorName, EventPrices>> {
  const out = {} as Record<ActorName, EventPrices>;
  for (const spec of Object.values(ACTORS)) {
    const url = `https://api.apify.com/v2/acts/${spec.actorId.replace('/', '~')}`;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
    out[spec.name] = parseEventPrices(await response.json());
  }
  return out;
}

/** The dry-run object, also saved as `plan.json` for a replay. */
async function preparePlan(
  optIn: ReturnType<typeof captureRemoteOptIn>,
  profile: string,
): Promise<PlanFile> {
  const today = moroccoDay(new Date());
  const since = new Date(Date.now() - BASELINE_LOAD_DAYS * 86_400_000);
  const loaded = await withDb(optIn, async (db) => {
    const groups = await loadPlaceGroups(db);
    const plain = await loadPlainKeyword(db, profile);
    const segmentKeys = Object.fromEntries(
      PLACES.map((p) => [p, groups[p].segmentKeys]),
    ) as Record<PlaceId, string[]>;
    const runs = await loadBaselineRuns(db, segmentKeys, since);
    const picked = pickBaselineDay(runs, today);
    const jobs: BaselineJob[] = [];
    if (picked.day !== null)
      for (const p of PLACES)
        jobs.push(
          ...(await loadBaselineJobs(db, p, segmentKeys[p], picked.day)),
        );
    return { groups, plain, runs, picked, jobs };
  });
  const { groups, plain, runs, picked, jobs } = loaded;
  const spellings = Object.fromEntries(
    PLACES.map((p) => [p, groups[p].spellings]),
  ) as Record<PlaceId, string[]>;
  const baseline =
    picked.day === null
      ? null
      : baselineCost(
          runs.filter((r) => moroccoDay(r.startedAt) === picked.day),
          jobs,
          spellings,
        );
  const keywords = {
    plain,
    real: Object.fromEntries(
      PLACES.map((p) => [p, groups[p].realKeyword]),
    ) as Record<PlaceId, string>,
  };
  const plan = buildPlan(keywords, await fetchPrices());
  return {
    dryRun: true,
    profile,
    keywords,
    otherKeywords: Object.fromEntries(
      PLACES.map((p) => [p, groups[p].otherKeywords]),
    ) as Record<PlaceId, string[]>,
    spellings,
    baselineDay: picked.day,
    ...(picked.reason ? { baselineReason: picked.reason } : {}),
    baseline,
    runs: plan.runs.map((r) => ({
      actor: r.actor,
      searchId: r.search.id,
      search: r.search,
      input: r.input,
      reservedUsd: r.reservedUsd,
    })),
    reservedUsd: plan.reservedUsd,
    capUsd: plan.capUsd,
    fits: plan.fits,
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const round = (usd: number) => Number(usd.toFixed(4));

/**
 * The paid path: the only code that builds an Apify client. Runs go one at a
 * time in plan order; a run that does not succeed stops the loop. Prints
 * `{ stoppedAt, spentUsd, folder }` on a stop or a throw.
 */
async function runPaid(planned: PlannedRun[], folder: string): Promise<void> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');
  const { ApifyClient } = await import('apify-client');
  const client = new ApifyClient({ token });
  const written: { path: string; file: RunFile; reservedUsd: number }[] = [];
  let spentUsd = 0;
  let current: string | null = null;
  try {
    for (const run of planned) {
      current = `${run.actor}/${run.search.id}`;
      const started = await client
        .actor(ACTORS[run.actor].actorId)
        .start(run.input, { maxTotalChargeUsd: run.reservedUsd });
      const finished = await client
        .run(started.id)
        .waitForFinish({ waitSecs: WAIT_SECS });
      if (finished.status === 'RUNNING' || finished.status === 'READY')
        await client.run(finished.id).abort();
      const usage =
        typeof finished.usageTotalUsd === 'number'
          ? finished.usageTotalUsd
          : null;
      spentUsd += usage ?? run.reservedUsd;
      const items =
        finished.status === 'SUCCEEDED'
          ? ((await client.dataset(finished.defaultDatasetId).listItems())
              .items as Record<string, unknown>[])
          : [];
      const file: RunFile = {
        runId: finished.id,
        status: finished.status,
        usageTotalUsd: usage,
        items,
      };
      const path = runFilePath(folder, run.actor, run.search.id);
      writeJson(path, file);
      written.push({ path, file, reservedUsd: run.reservedUsd });
      logger.log(
        `${current}: ${finished.status}, ${items.length} rows, $${usage ?? '?'} (spent $${round(spentUsd)})`,
      );
      if (finished.status !== 'SUCCEEDED') {
        console.log(
          JSON.stringify({
            stoppedAt: current,
            status: finished.status,
            spentUsd: round(spentUsd),
            folder,
          }),
        );
        break;
      }
    }
    current = 'final cost re-read';
    // Late charges arrive after a run ends, as the trial channels found.
    logger.log('Waiting 5 minutes before re-reading the final costs');
    await sleep(LATE_CHARGES_MS);
    spentUsd = 0;
    for (const { path, file, reservedUsd } of written) {
      const run = await client.run(file.runId).get();
      if (typeof run?.usageTotalUsd === 'number')
        file.usageTotalUsd = run.usageTotalUsd;
      // An unknown cost counts at its reservation, as in the run loop.
      spentUsd += file.usageTotalUsd ?? reservedUsd;
      writeJson(path, file);
    }
    logger.log(`Final spend $${round(spentUsd)} over ${written.length} runs`);
  } catch (error) {
    console.error(
      JSON.stringify({ stoppedAt: current, spentUsd: round(spentUsd), folder }),
    );
    throw error;
  }
}

function strongKeyOf(applyUrl: string): string | null {
  const key = jobKey(
    Channel.LINKEDIN_JOB_BOARD,
    'x',
    // jobKey reads only the apply URL for LINKEDIN_JOB_BOARD; postingUrl is a required string.
    emptyRecord({ kind: 'job', postingUrl: '', applyUrl }),
  );
  return isStrongJobKey(key) ? key : null;
}

/** The report from a saved folder, exactly as `--from` builds it. */
async function reportFrom(
  optIn: ReturnType<typeof captureRemoteOptIn>,
  folder: string,
): Promise<void> {
  const plan = parsePlanFile(readFileSync(join(folder, 'plan.json'), 'utf8'));
  if (plan.baseline === null)
    throw new Error(
      `${folder}/plan.json has no baseline (${plan.baselineReason ?? 'no baseline day'})`,
    );
  const planned = plannedRuns(plan);
  const results = readResults(folder, planned, readOrNull);
  const jobs = results.flatMap((r) => r.jobs);
  const keys = [
    ...new Set(
      jobs
        .map((j) => (j.applyUrl ? strongKeyOf(j.applyUrl) : null))
        .filter((k): k is string => k !== null),
    ),
  ];
  const pairs = [
    ...new Set(
      jobs
        .map((j) => titleCompanyKey(j.title, j.company))
        .filter((k): k is string => k !== null),
    ),
  ];
  const dev = await withDb(optIn, (db) => loadDevLookup(db, keys, pairs));
  const report = buildReport({
    planned,
    results,
    spellings: plan.spellings,
    baseline: plan.baseline,
    dev,
    strongKeyOf,
  });
  writeJson(join(folder, 'report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  let args;
  try {
    args = parseSampleArgs(process.argv.slice(2));
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${SAMPLE_USAGE}`,
    );
  }
  if (args.from !== undefined) {
    await reportFrom(optIn, resolve(args.from));
    return;
  }
  const plan = await preparePlan(optIn, args.profile);
  if (args.dryRun) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!plan.fits)
    throw new Error(
      `Refusing: $${plan.reservedUsd} reserved passes the $${plan.capUsd} cap`,
    );
  if (plan.baselineDay === null)
    throw new Error(`Refusing: no baseline day (${plan.baselineReason})`);
  const folder = join(
    REPO_ROOT,
    'tmp',
    'indeed-sample',
    new Date().toISOString(),
  );
  writeJson(join(folder, 'plan.json'), plan);
  logger.log(`Saving to ${folder}`);
  await runPaid(plannedRuns(plan), folder);
  await reportFrom(optIn, folder);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

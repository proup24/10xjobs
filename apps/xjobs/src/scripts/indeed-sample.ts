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
  spendFile,
  spentUsd,
  type PlanFile,
  type RunFile,
  type SpendFile,
  type SpendRun,
} from './indeed-sample/files';
import {
  buildPlan,
  parseEventPrices,
  type EventPrices,
  type PlannedRun,
} from './indeed-sample/plan';
import { finishSample, runItems, startOptions } from './indeed-sample/paid';
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
// A minute past each run's own timeout, so Apify ends a slow run itself.
const WAIT_GRACE_SECS = 60;
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
      worstCaseUsd: r.worstCaseUsd,
      memoryMbytes: r.memoryMbytes,
      timeoutSecs: r.timeoutSecs,
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

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/**
 * The paid path: the only code that builds an Apify client. Runs go one at a
 * time in plan order; a run that does not succeed, or a throw, stops the loop
 * and prints `{ stoppedAt, runId, spentUsd, folder }`. Every started run is in
 * `spend.json` from the moment `start` returns. Whatever stopped the loop, it
 * aborts a run still going, waits 5 minutes, re-reads every started run's
 * final cost (best effort) and rewrites the files; then it rethrows a throw.
 * Resolves `{ stopped: true }` when a run ended without succeeding.
 */
async function runPaid(
  planned: PlannedRun[],
  folder: string,
): Promise<{ stopped: boolean }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');
  const { ApifyClient } = await import('apify-client');
  const client = new ApifyClient({ token });
  const ledger: SpendRun[] = [];
  const files = new Map<SpendRun, { path: string; file: RunFile }>();
  const spendPath = join(folder, 'spend.json');
  const saveSpend = () => writeJson(spendPath, spendFile(ledger));
  const stopLine = (entry: SpendRun | undefined) => ({
    stoppedAt: entry ? `${entry.actor}/${entry.searchId}` : attempting,
    runId: entry?.runId ?? null,
    status: entry?.status ?? null,
    spentUsd: round(spentUsd(ledger)),
    folder,
  });

  /** Aborts a run that is not finished and waits briefly for its final record. */
  const settle = async (runId: string) => {
    await client.run(runId).abort();
    return client.run(runId).waitForFinish({ waitSecs: 60 });
  };

  let failure: unknown = null;
  let stopped = false;
  let current: SpendRun | undefined;
  // The planned run being started, for a stop before Apify returns its id.
  let attempting: string | null = null;
  try {
    for (const run of planned) {
      current = undefined;
      attempting = `${run.actor}/${run.search.id}`;
      const started = await client
        .actor(ACTORS[run.actor].actorId)
        .start(run.input, startOptions(run));
      current = {
        actor: run.actor,
        searchId: run.search.id,
        runId: started.id,
        status: 'STARTED',
        usageTotalUsd: null,
        reservedUsd: run.reservedUsd,
      };
      ledger.push(current);
      saveSpend();
      let finished = await client
        .run(started.id)
        .waitForFinish({ waitSecs: run.timeoutSecs + WAIT_GRACE_SECS });
      if (!TERMINAL.has(finished.status)) finished = await settle(started.id);
      current.status = finished.status;
      current.usageTotalUsd =
        typeof finished.usageTotalUsd === 'number'
          ? finished.usageTotalUsd
          : null;
      saveSpend();
      // Kept for every status; the report reads only SUCCEEDED runs.
      const { items, itemsError } = await runItems(
        finished.status,
        async () =>
          (await client.dataset(finished.defaultDatasetId).listItems())
            .items as Record<string, unknown>[],
      );
      if (itemsError)
        logger.error(
          `Could not list items of ${finished.status} run ${finished.id}: ${itemsError}`,
        );
      const file: RunFile = {
        runId: finished.id,
        status: finished.status,
        usageTotalUsd: current.usageTotalUsd,
        startedAt: finished.startedAt
          ? new Date(finished.startedAt).toISOString()
          : null,
        finishedAt: finished.finishedAt
          ? new Date(finished.finishedAt).toISOString()
          : null,
        items,
        ...(itemsError ? { itemsError } : {}),
      };
      const path = runFilePath(folder, run.actor, run.search.id);
      writeJson(path, file);
      files.set(current, { path, file });
      logger.log(
        `${run.actor}/${run.search.id}: ${finished.status}, ${items.length} rows, $${current.usageTotalUsd ?? '?'} (spent $${round(spentUsd(ledger))})`,
      );
      if (finished.status !== 'SUCCEEDED') {
        stopped = true;
        console.log(JSON.stringify(stopLine(current)));
        break;
      }
    }
  } catch (error) {
    failure = error;
    if (current && !TERMINAL.has(current.status)) {
      try {
        const settled = await settle(current.runId);
        current.status = settled.status;
      } catch (abortError) {
        logger.error(
          `Could not abort run ${current.runId}: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
        );
      }
    }
    saveSpend();
    console.error(JSON.stringify(stopLine(current)));
  }

  if (ledger.length > 0) {
    // Late charges arrive after a run ends, as the trial channels found.
    logger.log('Waiting 5 minutes before re-reading the final costs');
    await sleep(LATE_CHARGES_MS);
    for (const entry of ledger) {
      try {
        const run = await client.run(entry.runId).get();
        if (run) entry.status = run.status;
        if (typeof run?.usageTotalUsd === 'number')
          entry.usageTotalUsd = run.usageTotalUsd;
      } catch (error) {
        logger.error(
          `Could not re-read run ${entry.runId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const saved = files.get(entry);
      if (saved) {
        saved.file.usageTotalUsd = entry.usageTotalUsd;
        writeJson(saved.path, saved.file);
      }
    }
    saveSpend();
    logger.log(
      `Final spend $${round(spentUsd(ledger))} over ${ledger.length} runs`,
    );
  }
  if (failure !== null) throw failure;
  return { stopped };
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
  const spendText = readOrNull(join(folder, 'spend.json'));
  // The real spend, runs that did not succeed included.
  const spend =
    spendText === null ? null : (JSON.parse(spendText) as SpendFile);
  const out = { ...report, spend };
  writeJson(join(folder, 'report.json'), out);
  console.log(JSON.stringify(out, null, 2));
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
  let failure: unknown = null;
  let stopped = false;
  try {
    ({ stopped } = await runPaid(plannedRuns(plan), folder));
  } catch (error) {
    failure = error;
  }
  // A stopped sample still gets its report: notRun lists what is missing.
  const { exitCode } = await finishSample({
    failure,
    stopped,
    report: () => reportFrom(optIn, folder),
    log: (line) => logger.error(line),
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

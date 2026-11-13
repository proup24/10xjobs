import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { isLocalUrl } from '@xjobs/database/env';
import { Queue } from 'bullmq';

/**
 * The processor worker, built, processes one seeded job end to end through
 * the fake `claude` (`XJOBS_CLAUDE_BIN`, read only under `NODE_ENV=test`).
 * No real `claude` call is made. The worker gets its own Redis prefix, so it
 * never takes another process's queue jobs, and runs no schedules.
 */
const ROOT = resolve(__dirname, '../../../..');
const WORKER = join(ROOT, 'apps/xjobs/dist/worker.js');
const FAKE = join(
  ROOT,
  'apps/xjobs/src/modules/processor/testing/fake-claude.mjs',
);
const SUCCESS = join(
  ROOT,
  'apps/xjobs/src/modules/processor/models/claude/fixtures/success.jsonl',
);
const { description: DESCRIPTION, output: OUTPUT } = JSON.parse(
  readFileSync(
    join(__dirname, '../support/fake-claude/extraction.json'),
    'utf8',
  ),
) as { description: string; output: unknown };

const url = process.env.DATABASE_URL;
const ALLOWED_CHILD_ENV = [
  'PATH',
  'HOME',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'DISABLE_AUTOUPDATER',
];

/** success.jsonl with the extraction as its structured output. */
function extractionScenario(): string {
  return readFileSync(SUCCESS, 'utf8')
    .split('\n')
    .map((line) => {
      if (!line.includes('"type":"result"')) return line;
      const result = JSON.parse(line);
      return JSON.stringify({
        ...result,
        structured_output: OUTPUT,
        result: JSON.stringify(OUTPUT),
      });
    })
    .join('\n');
}

/**
 * A `claude` stand-in: the extraction schema gets the extraction scenario,
 * the startup check the fake's own success fixture. Logs each call.
 */
function writeBin(dir: string): { bin: string; log: string } {
  const scenario = join(dir, 'extraction.jsonl');
  writeFileSync(scenario, extractionScenario());
  const log = join(dir, 'calls.jsonl');
  const bin = join(dir, 'claude');
  writeFileSync(
    bin,
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (!args.includes('--version'))
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, env: Object.keys(process.env) }) + '\\n');
const schema = args[args.indexOf('--json-schema') + 1] ?? '';
const env = { ...process.env };
if (schema.includes('"openings"')) env.FAKE_CLAUDE_SCENARIO = ${JSON.stringify(scenario)};
const run = spawnSync(process.execPath, [${JSON.stringify(FAKE)}, ...args], { stdio: 'inherit', env });
process.exit(run.status ?? 1);
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}

const seen = new Date('2026-11-01T00:00:00Z');

/** An active LinkedIn job board job, pending, with DESCRIPTION. */
async function seedJob(db: DatabaseClient): Promise<string> {
  const channel = 'LINKEDIN_JOB_BOARD';
  const run = await db.orm.public.SearchSegmentRun.create({
    channel,
    segmentKey: 'e2e',
    segmentHash: randomUUID(),
    queryIds: [],
    windowStart: seen,
    windowEnd: new Date(seen.getTime() + 3_600_000),
    startedAt: seen,
    finishedAt: seen,
    status: 'succeeded',
    fetched: 0,
    costMicroUsd: null,
    capped: false,
    truncatedQueryIds: [],
    perQuery: {},
    error: null,
  });
  const batch = await db.orm.public.CollectionBatch.create({
    channel,
    segmentRunId: run.id,
    storageKey: `${channel}/e2e/${run.id}.json`,
    formatVersion: 1,
    observedAt: seen,
    itemCount: 1,
    actor: 'e2e',
    apifyRunId: null,
    status: 'ingested',
  });
  const item = await db.orm.public.RawItem.create({
    channel,
    sourceKey: `e2e-${randomUUID()}`,
    kind: 'job',
    firstSeenAt: seen,
    lastSeenAt: seen,
    latestVersionId: null,
  });
  const version = await db.orm.public.RawItemVersion.create({
    rawItemId: item.id,
    contentHash: randomUUID(),
    payload: {},
    firstBatchId: batch.id,
    firstSeenAt: seen,
    lastSeenAt: seen,
  });
  await db.orm.public.RawItem.where({ id: item.id }).updateAll({
    latestVersionId: version.id,
  });
  const normalized = await db.orm.public.NormalizedVersion.create({
    rawVersionId: version.id,
    normalizerVersion: 1,
    status: 'valid',
    reason: null,
    record: {},
    jobKey: randomUUID(),
  });
  const job = await db.orm.public.NormalizedJob.create({
    jobKey: `e2e-${randomUUID()}`,
    kind: 'job',
    status: 'active',
    mergedIntoId: null,
    title: 'Senior Backend Engineer',
    companyName: 'E2E Corp',
    location: 'EMEA',
    contractType: 'Full-time',
    experienceLevel: 'Mid-Senior level',
    salaryText: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    descriptionText: DESCRIPTION,
    postingUrl: `https://example.com/e2e/${randomUUID()}`,
    closed: false,
    fieldSources: {},
    firstSeenAt: seen,
    lastSeenAt: seen,
    processingStatus: 'pending',
    processingReason: 'new',
    processingRequestedAt: new Date(),
    normalizerVersion: 1,
  });
  await db.orm.public.NormalizedJobSource.create({
    jobId: job.id,
    rawItemId: item.id,
    normalizedVersionId: normalized.id,
    linkedAt: seen,
  });
  return job.id;
}

async function jobState(db: DatabaseClient, id: string) {
  return db.orm.public.NormalizedJob.where({ id }).first();
}

/** Removes the seeded job, its extraction and attempts, and its raw chain. */
async function removeJob(db: DatabaseClient, jobId: string): Promise<void> {
  const { raw } = db;
  const run = (q: ReturnType<typeof raw.sql>) =>
    db.execute(q.affectedCount().build());
  const source = await db.orm.public.NormalizedJobSource.where({
    jobId,
  }).first();
  await run(
    raw.sql`UPDATE normalized_jobs SET "currentExtractionId" = NULL WHERE id = ${jobId}::uuid`,
  );
  await run(
    raw.sql`DELETE FROM processing_attempts WHERE "jobId" = ${jobId}::uuid`,
  );
  await run(
    raw.sql`DELETE FROM job_extractions WHERE "jobId" = ${jobId}::uuid`,
  );
  await run(
    raw.sql`DELETE FROM normalized_job_sources WHERE "jobId" = ${jobId}::uuid`,
  );
  await run(raw.sql`DELETE FROM normalized_jobs WHERE id = ${jobId}::uuid`);
  if (!source) return;
  const item = await db.orm.public.RawItem.where({
    id: source.rawItemId,
  }).first();
  const version = item?.latestVersionId
    ? await db.orm.public.RawItemVersion.where({
        id: item.latestVersionId,
      }).first()
    : null;
  const batch = version
    ? await db.orm.public.CollectionBatch.where({
        id: version.firstBatchId,
      }).first()
    : null;
  await run(
    raw.sql`DELETE FROM normalized_versions WHERE id = ${source.normalizedVersionId}::uuid`,
  );
  await run(
    raw.sql`UPDATE raw_items SET "latestVersionId" = NULL WHERE id = ${source.rawItemId}::uuid`,
  );
  await run(
    raw.sql`DELETE FROM raw_item_versions WHERE "rawItemId" = ${source.rawItemId}::uuid`,
  );
  await run(
    raw.sql`DELETE FROM raw_items WHERE id = ${source.rawItemId}::uuid`,
  );
  if (batch) {
    await run(
      raw.sql`DELETE FROM collection_batches WHERE id = ${batch.id}::uuid`,
    );
    await run(
      raw.sql`DELETE FROM search_segment_runs WHERE id = ${batch.segmentRunId}::uuid`,
    );
  }
}

async function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    child.kill('SIGTERM');
  });
}

describe.skipIf(!url || !isLocalUrl(url))('processor worker', () => {
  let db: DatabaseClient;
  let dir: string;
  let worker: ChildProcess | undefined;
  let output = '';
  let queue: Queue | undefined;
  let jobId: string | undefined;
  const prefix = `xjobs-e2e-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    db = createDatabaseClient({
      url: url as string,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60_000,
      logQueries: false,
    });
    dir = mkdtempSync(join(tmpdir(), 'xjobs-e2e-claude-'));
  });

  afterAll(async () => {
    if (worker) await exited(worker);
    // Every queue the worker opens on its own prefix, the match nudge included.
    const connection = {
      url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    };
    const others = ['match', 'ingest', 'infrastructure'].map(
      (name) => new Queue(name, { connection, prefix }),
    );
    for (const q of [queue, ...others]) {
      await q?.obliterate({ force: true }).catch(() => undefined);
      await q?.close();
    }
    if (jobId) await removeJob(db, jobId);
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('processes one seeded job through the fake claude', async () => {
    expect(existsSync(WORKER)).toBe(true);
    const { bin, log } = writeBin(dir);
    jobId = await seedJob(db);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      WORKER_ROLE: 'processor',
      XJOBS_CLAUDE_BIN: bin,
      CLAUDE_CODE_OAUTH_TOKEN: 'e2e-fake-token',
      ANTHROPIC_API_KEY: '',
      XJOBS_RUN_SCHEDULES: '0',
      REDIS_PREFIX: prefix,
    };
    delete env.WORKER_CHANNEL;
    worker = spawn(process.execPath, [WORKER], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout?.on('data', (b: Buffer) => (output += b.toString()));
    worker.stderr?.on('data', (b: Buffer) => (output += b.toString()));

    queue = new Queue('process', {
      connection: { url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' },
      prefix,
    });
    await queue.add('process-job', { jobId }, { jobId });

    let state = await jobState(db, jobId);
    const deadline = Date.now() + 60_000;
    while (
      state?.processingStatus !== 'processed' &&
      state?.processingStatus !== 'failed' &&
      Date.now() < deadline
    ) {
      if (worker.exitCode !== null)
        throw new Error(`worker exited ${worker.exitCode}:\n${output}`);
      await new Promise((r) => setTimeout(r, 500));
      state = await jobState(db, jobId);
    }

    expect(output).toContain('processor ready');
    expect(state, output).toMatchObject({
      processingStatus: 'processed',
      processingError: null,
    });
    expect(state?.currentExtractionId).toBeTruthy();

    // The startup check and the extraction, each isolated.
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { args: string[]; env: string[] });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.args).toEqual(
        expect.arrayContaining(['-p', '--max-turns', '3']),
      );
      expect(call.env.filter((k) => !ALLOWED_CHILD_ENV.includes(k))).toEqual(
        [],
      );
    }
  }, 120_000);
});

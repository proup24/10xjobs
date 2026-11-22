import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');

describe.skipIf(!url)('post extraction contract in PostgreSQL', () => {
  let db: DatabaseClient;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  function newJob(over: Record<string, unknown> = {}) {
    return db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'post',
      status: 'active',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: t0,
      normalizerVersion: 1,
      ...over,
    } as never);
  }

  function newExtraction(jobId: string, over: Record<string, unknown> = {}) {
    return db.orm.public.JobExtraction.create({
      jobId,
      inputHash: randomUUID(),
      schemaVersion: 1,
      promptHash: 'p',
      extractionModel: 'm',
      data: {},
      needsReview: false,
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      costUsd: 0,
      ...over,
    } as never);
  }

  beforeAll(() => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/processor_test'
    )
      throw new Error('Use a disposable localhost processor_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE processing_attempts, job_extractions, normalized_job_sources, normalized_jobs CASCADE`;
  });

  it('rejects a post_role job without a parent, and a parent on a non-role job', async () => {
    await expect(newJob({ kind: 'post_role', roleKey: 'a' })).rejects.toThrow();
    const parent = await newJob();
    await expect(
      newJob({ kind: 'job', parentJobId: parent.id }),
    ).rejects.toThrow();
  });

  it('accepts a post_role job with a parent', async () => {
    const parent = await newJob();
    const role = await newJob({
      kind: 'post_role',
      parentJobId: parent.id,
      roleKey: 'backend',
    });
    expect(role.parentJobId).toBe(parent.id);
  });

  it('rejects two role jobs with the same parent and role key', async () => {
    const parent = await newJob();
    const role = { kind: 'post_role', parentJobId: parent.id, roleKey: 'x' };
    await newJob(role);
    await expect(newJob(role)).rejects.toThrow();
    await expect(newJob({ ...role, roleKey: 'y' })).resolves.toBeDefined();
  });

  it('defaults an extraction docType to listing and rejects an unknown one', async () => {
    const job = await newJob({ kind: 'job' });
    const row = await newExtraction(job.id);
    expect(row.docType).toBe('listing');
    expect(row.verdict).toBeNull();
    const post = await newExtraction(job.id, {
      docType: 'post',
      verdict: 'hiring',
      verdictReason: 'says we are hiring',
      verdictConfidence: 'high',
    });
    expect(post.verdict).toBe('hiring');
    await expect(newExtraction(job.id, { docType: 'other' })).rejects.toThrow();
  });

  it('defaults an attempt docType to listing and rejects an unknown one', async () => {
    const base = {
      step: 'extraction',
      model: 'm',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      outcome: 'ok',
    };
    const row = await db.orm.public.ProcessingAttempt.create(base as never);
    expect(row.docType).toBe('listing');
    await expect(
      db.orm.public.ProcessingAttempt.create({
        ...base,
        docType: 'other',
      } as never),
    ).rejects.toThrow();
  });
});

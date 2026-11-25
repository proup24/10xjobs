import { randomUUID } from 'node:crypto';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import {
  type CallbackWebhook,
  PrismaCallbacksRepository,
} from './callbacks.repository';

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const INT = 'pg/int4@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMPTZ = 'pg/timestamptz-date@1';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. The
 * PostgreSQL specs run one file at a time (see `vitest.config.mts`).
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const at = new Date('2026-11-25T12:00:00.000Z');

describe.skipIf(!url)('callbacks repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaCallbacksRepository;
  // A second client, so two records run on two connections at once.
  let db2: DatabaseClient;
  let repo2: PrismaCallbacksRepository;

  async function exec(statement: ReturnType<DatabaseClient['raw']['sql']>) {
    await db.execute(statement.affectedCount().build());
  }

  const client = () =>
    createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });

  beforeAll(() => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.pathname !== '/processor_test'
    )
      throw new Error('Use a disposable localhost processor_test database');
    db = client();
    db2 = client();
    repo = new PrismaCallbacksRepository({ db } as unknown as DatabaseService);
    repo2 = new PrismaCallbacksRepository({
      db: db2,
    } as unknown as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
    await db2?.close();
  });
  beforeEach(async () => {
    await exec(
      db.raw
        .sql`TRUNCATE webhook_callbacks, webhook_deliveries, webhooks, job_decisions, job_matches, profiles, job_extractions, normalized_jobs CASCADE`,
    );
  });

  async function seedUser(): Promise<string> {
    const userId = randomUUID();
    await exec(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`,
    );
    await exec(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    return userId;
  }

  async function seedProfile(userId: string): Promise<string> {
    const profile = await db.orm.public.Profile.create({
      userId,
      position: 'backend_engineer',
      yearsOfExperience: 6,
      timezoneCurrent: 60,
      timezoneMin: -60,
      timezoneMax: 180,
      engagements: ['employee'],
      seniorities: ['senior'],
      noticePeriodDays: 30,
      contractTypes: ['full_time'],
      locations: {
        remote: [{ kind: 'region', code: 'EMEA' }],
        hybrid: [],
        onsite: [],
      },
      languages: [{ lang: 'en', level: 'fluent' }],
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
      state: 'published',
      publishedAt: at,
    } as never);
    return profile.id;
  }

  interface Job {
    jobId: string;
    extractionId: string;
  }

  async function seedJob(mergedIntoId: string | null = null): Promise<Job> {
    const job = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: mergedIntoId ? 'merged' : 'active',
      mergedIntoId,
      title: 'Backend Engineer',
      companyName: 'Acme',
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: at,
      lastSeenAt: at,
      processingStatus: 'processed',
      processingReason: null,
      processingRequestedAt: at,
      normalizerVersion: 1,
    } as never);
    const extraction = await db.orm.public.JobExtraction.create({
      jobId: job.id,
      inputHash: randomUUID(),
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptHash: 'p',
      decisionModel: 'd',
      extractionModel: 'e',
      data: fixtureDocument() as never,
      needsReview: false,
      arrangement: null,
      seniority: null,
      roleKind: null,
      contractType: null,
      engagement: null,
      isSoftwareEngineeringRole: null,
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      requiredTags: [],
      niceTags: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      costUsd: '0',
    });
    return { jobId: job.id, extractionId: extraction.id };
  }

  async function seedMatch(
    userId: string,
    profileId: string,
    job: Job,
    outcome: 'qualified' | 'rejected' | 'review' = 'qualified',
    checks: unknown = [{ rule: 'position', outcome: 'pass', reason: 'fits' }],
  ): Promise<void> {
    const review = outcome === 'review' ? 'seniority' : '';
    await exec(
      db.raw.sql`INSERT INTO job_matches
          (id, "userId", "profileId", "jobId", "extractionId", "matcherVersion",
           outcome, unverified, "reviewRule", "reviewField", "stackScore", checks,
           "decidedAt", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${profileId}::uuid, ${job.jobId}::uuid,
          ${job.extractionId}::uuid, 3, ${outcome}::text, false,
          NULLIF(${review}::text, ''), NULLIF(${review}::text, ''), 0.5,
          ${JSON.stringify(checks)}::jsonb, now(), now(), now())`,
    );
  }

  async function seedWebhook(
    userId: string,
    enabled = true,
  ): Promise<CallbackWebhook> {
    const id = randomUUID();
    await exec(
      db.raw
        .sql`INSERT INTO webhooks (id, "userId", url, enabled, "disabledReason")
        VALUES (${id}::uuid, ${userId}::uuid, 'https://hook.example.com/x', ${enabled}::boolean,
          NULLIF(${enabled ? '' : 'user'}::text, ''))`,
    );
    const found = await repo.findWebhook(id);
    return found!;
  }

  /** A user with a webhook, a published profile and a matched job. */
  async function matched() {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    const webhook = await seedWebhook(userId);
    const job = await seedJob();
    await seedMatch(userId, profileId, job);
    return { userId, profileId, webhook, job };
  }

  async function callbacks() {
    return db.query(
      db.raw
        .sql`SELECT "userId", "webhookId", "receivedAt", type, "jobId", result, signature
        FROM webhook_callbacks ORDER BY "createdAt", signature`
        .returnsRow({
          userId: UUID,
          webhookId: UUID,
          receivedAt: TIMESTAMPTZ,
          type: TEXT,
          jobId: UUID,
          result: TEXT,
          signature: TEXT,
        })
        .build(),
    );
  }

  async function decisions() {
    return db.query(
      db.raw
        .sql`SELECT "userId", "jobId", status, reason, note, "matchSnapshot", source, "decidedAt"
        FROM job_decisions ORDER BY "createdAt", id`
        .returnsRow({
          userId: UUID,
          jobId: UUID,
          status: TEXT,
          reason: TEXT,
          note: TEXT,
          matchSnapshot: JSONB,
          source: TEXT,
          decidedAt: TIMESTAMPTZ,
        })
        .build(),
    );
  }

  async function count(table: 'webhook_callbacks' | 'job_decisions') {
    const sql =
      table === 'webhook_callbacks'
        ? db.raw.sql`SELECT count(*)::int AS n FROM webhook_callbacks`
        : db.raw.sql`SELECT count(*)::int AS n FROM job_decisions`;
    const [row] = await db.query(sql.returnsRow({ n: INT }).build());
    return row!.n as number;
  }

  it('findWebhook returns an off webhook too', async () => {
    const userId = await seedUser();
    const webhook = await seedWebhook(userId, false);
    expect(webhook).toEqual({
      id: webhook.id,
      userId,
      secret: expect.any(String),
    });
    expect(webhook.secret.length).toBeGreaterThan(20);
    expect(await repo.findWebhook(randomUUID())).toBeNull();
    expect(await repo.findWebhook('not-a-uuid')).toBeNull();
  });

  it('ping logs one row and returns ok', async () => {
    const userId = await seedUser();
    const webhook = await seedWebhook(userId);
    expect(await repo.record(webhook, 'sig-1', { type: 'ping' }, at)).toEqual({
      result: 'ok',
    });
    expect(await callbacks()).toEqual([
      {
        userId,
        webhookId: webhook.id,
        receivedAt: at,
        type: 'ping',
        jobId: null,
        result: 'ok',
        signature: 'sig-1',
      },
    ]);
  });

  it('invalid logs type invalid with result invalid', async () => {
    const userId = await seedUser();
    const webhook = await seedWebhook(userId);
    expect(
      await repo.record(
        webhook,
        'sig-1',
        { type: 'invalid', error: 'status: Invalid option' },
        at,
      ),
    ).toEqual({ result: 'invalid', error: 'status: Invalid option' });
    expect(await callbacks()).toMatchObject([
      { type: 'invalid', jobId: null, result: 'invalid' },
    ]);
    expect(await count('job_decisions')).toBe(0);
  });

  it('applied on a matched job inserts a webhook-sourced decision', async () => {
    const s = await matched();
    expect(
      await repo.record(
        s.webhook,
        'sig-1',
        {
          type: 'feedback',
          feedback: { jobId: s.job.jobId, status: 'applied' },
        },
        at,
      ),
    ).toEqual({ result: 'saved', jobId: s.job.jobId });
    expect(await decisions()).toEqual([
      {
        userId: s.userId,
        jobId: s.job.jobId,
        status: 'applied',
        reason: null,
        note: null,
        matchSnapshot: null,
        source: 'webhook',
        decidedAt: at,
      },
    ]);
    expect(await callbacks()).toMatchObject([
      { type: 'feedback', jobId: s.job.jobId, result: 'saved' },
    ]);
  });

  it('dismissed stores reason, note and the match snapshot', async () => {
    const s = await matched();
    // A second profile of the user matched the same job; another user's match stays out.
    const second = await seedProfile(s.userId);
    await seedMatch(s.userId, second, s.job, 'review', []);
    const other = await seedUser();
    await seedMatch(other, await seedProfile(other), s.job);

    expect(
      await repo.record(
        s.webhook,
        'sig-1',
        {
          type: 'feedback',
          feedback: {
            jobId: s.job.jobId,
            status: 'dismissed',
            reason: 'salary',
            note: 'Too low',
          },
        },
        at,
      ),
    ).toEqual({ result: 'saved', jobId: s.job.jobId });
    const [decision] = await decisions();
    expect(decision).toMatchObject({
      status: 'dismissed',
      reason: 'salary',
      note: 'Too low',
      source: 'webhook',
    });
    const snapshot = decision!.matchSnapshot as Array<{ profileId: string }>;
    expect(
      [...snapshot].sort((a, b) => (a.profileId < b.profileId ? -1 : 1)),
    ).toEqual(
      [
        {
          profileId: s.profileId,
          outcome: 'qualified',
          matcherVersion: 3,
          checks: [{ rule: 'position', outcome: 'pass', reason: 'fits' }],
        },
        {
          profileId: second,
          outcome: 'review',
          matcherVersion: 3,
          checks: [],
        },
      ].sort((a, b) => (a.profileId < b.profileId ? -1 : 1)),
    );
  });

  it('already decided keeps the app decision', async () => {
    const s = await matched();
    await exec(
      db.raw
        .sql`INSERT INTO job_decisions (id, "userId", "jobId", status, "decidedAt", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${s.userId}::uuid, ${s.job.jobId}::uuid, 'applied',
          '2026-11-20T00:00:00Z'::timestamptz, now(), now())`,
    );
    expect(
      await repo.record(
        s.webhook,
        'sig-1',
        {
          type: 'feedback',
          feedback: { jobId: s.job.jobId, status: 'dismissed', reason: 'role' },
        },
        at,
      ),
    ).toEqual({
      result: 'already_decided',
      jobId: s.job.jobId,
      decision: 'applied',
    });
    expect(await decisions()).toMatchObject([
      {
        status: 'applied',
        reason: null,
        source: 'app',
        decidedAt: new Date('2026-11-20T00:00:00Z'),
      },
    ]);
    expect(await callbacks()).toMatchObject([
      { type: 'feedback', result: 'already_decided' },
    ]);
  });

  it('follows a merge to the root job', async () => {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    const webhook = await seedWebhook(userId);
    const b = await seedJob();
    const a = await seedJob(b.jobId);
    await seedMatch(userId, profileId, b);

    expect(
      await repo.record(
        webhook,
        'sig-1',
        { type: 'feedback', feedback: { jobId: a.jobId, status: 'applied' } },
        at,
      ),
    ).toEqual({ result: 'saved', jobId: b.jobId });
    expect(await decisions()).toMatchObject([
      { jobId: b.jobId, status: 'applied' },
    ]);
    // The log keeps the id the receiver sent.
    expect(await callbacks()).toMatchObject([
      { jobId: a.jobId, result: 'saved' },
    ]);
  });

  it('a job with no match answers not_matched and writes no decision', async () => {
    const userId = await seedUser();
    const webhook = await seedWebhook(userId);
    const job = await seedJob();
    // Another user's match on the job does not count.
    const other = await seedUser();
    await seedMatch(other, await seedProfile(other), job);
    const unknown = randomUUID();

    expect(
      await repo.record(
        webhook,
        'sig-1',
        { type: 'feedback', feedback: { jobId: job.jobId, status: 'applied' } },
        at,
      ),
    ).toEqual({ result: 'not_matched' });
    expect(
      await repo.record(
        webhook,
        'sig-2',
        { type: 'feedback', feedback: { jobId: unknown, status: 'applied' } },
        at,
      ),
    ).toEqual({ result: 'not_matched' });
    expect(await count('job_decisions')).toBe(0);
    expect(await callbacks()).toMatchObject([
      { type: 'feedback', jobId: job.jobId, result: 'not_matched' },
      { type: 'feedback', jobId: unknown, result: 'not_matched' },
    ]);
  });

  it('refuses a replayed signature', async () => {
    const s = await matched();
    const request = {
      type: 'feedback' as const,
      feedback: { jobId: s.job.jobId, status: 'applied' as const },
    };
    expect(await repo.record(s.webhook, 'sig-1', request, at)).toEqual({
      result: 'saved',
      jobId: s.job.jobId,
    });
    await exec(db.raw.sql`DELETE FROM job_decisions`);
    expect(await repo.record(s.webhook, 'sig-1', request, at)).toBe('replay');
    expect(await count('webhook_callbacks')).toBe(1);
    // Nothing was applied the second time.
    expect(await count('job_decisions')).toBe(0);
    expect(await repo.record(s.webhook, 'sig-1', { type: 'ping' }, at)).toBe(
      'replay',
    );
    expect(await count('webhook_callbacks')).toBe(1);
  });

  it('a concurrent insert answers already_decided', async () => {
    const s = await matched();
    const results = await Promise.all([
      repo.record(
        s.webhook,
        'sig-1',
        {
          type: 'feedback',
          feedback: { jobId: s.job.jobId, status: 'applied' },
        },
        at,
      ),
      repo2.record(
        s.webhook,
        'sig-2',
        {
          type: 'feedback',
          feedback: { jobId: s.job.jobId, status: 'dismissed' },
        },
        at,
      ),
    ]);
    const saved = results.filter((r) => r !== 'replay' && r.result === 'saved');
    const already = results.filter(
      (r) => r !== 'replay' && r.result === 'already_decided',
    );
    expect(saved).toHaveLength(1);
    expect(already).toHaveLength(1);
    const [decision] = await decisions();
    expect(already[0]).toEqual({
      result: 'already_decided',
      jobId: s.job.jobId,
      decision: decision!.status,
    });
    expect(await count('job_decisions')).toBe(1);
    expect((await callbacks()).map((c) => c.result).sort()).toEqual([
      'already_decided',
      'saved',
    ]);
  });
});

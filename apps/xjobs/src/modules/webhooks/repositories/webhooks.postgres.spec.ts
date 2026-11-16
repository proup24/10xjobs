import { randomUUID } from 'node:crypto';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { PrismaWebhooksRepository } from './webhooks.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract, which includes the `webhooks` and
 * `webhook_deliveries` tables. Truncates its tables. Every test on that database lives in
 * this file, the matcher one and the processor one, so they never run in parallel.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');

describe.skipIf(!url)('webhooks repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaWebhooksRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
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
    repo = new PrismaWebhooksRepository({ db } as unknown as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE webhook_deliveries, webhooks, job_matches, job_facts, profile_skills, profiles, job_extractions, normalized_jobs CASCADE`;
  });

  /** A user, a published profile, a job with facts, and a qualified match; returns their ids. */
  async function seedMatch() {
    const userId = randomUUID();
    await db.execute(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`
        .affectedCount()
        .build(),
    );
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
      publishedAt: new Date(),
    } as never);
    const job = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: 'active',
      mergedIntoId: null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      companyUrl: 'https://acme.test',
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: new Date(),
      processingStatus: 'processed',
      processingReason: null,
      processingRequestedAt: t0,
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
    await db.execute(
      db.raw.sql`INSERT INTO job_facts
          ("jobId", "extractionId", "factsVersion", "factsHash", facts, closed, "builtAt", "createdAt", "updatedAt")
        VALUES (${job.id}::uuid, ${extraction.id}::uuid, 1, 'h1',
          ${JSON.stringify({ seniority: { value: 'senior' } })}::jsonb, false, now(), now(), now())`
        .affectedCount()
        .build(),
    );
    const matchId = randomUUID();
    await db.execute(
      db.raw.sql`INSERT INTO job_matches
          (id, "userId", "profileId", "jobId", "extractionId", "matcherVersion",
           outcome, unverified, "stackScore", checks, "decidedAt", "createdAt", "updatedAt")
        VALUES (${matchId}::uuid, ${userId}::uuid, ${profile.id}::uuid, ${job.id}::uuid,
          ${extraction.id}::uuid, 1, 'qualified', false, 0.725,
          ${JSON.stringify([{ rule: 'position', outcome: 'pass', reason: 'fits' }])}::jsonb,
          now(), now(), now())`
        .affectedCount()
        .build(),
    );
    return { userId, profileId: profile.id, jobId: job.id, matchId };
  }

  it('reads a delivery as the payload input', async () => {
    const s = await seedMatch();
    const webhookId = randomUUID();
    const deliveryId = randomUUID();
    // The webhook's secret and counters take their column defaults.
    await db.execute(
      db.raw.sql`INSERT INTO webhooks (id, "userId", url)
        VALUES (${webhookId}::uuid, ${s.userId}::uuid, 'https://hook.example.com/x')`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, "profileId", "jobId", "matchId", "trigger", status)
        VALUES (${deliveryId}::uuid, ${s.userId}::uuid, ${webhookId}::uuid, 'match',
          ${s.profileId}::uuid, ${s.jobId}::uuid, ${s.matchId}::uuid, 'review', 'pending')`
        .affectedCount()
        .build(),
    );

    const input = await repo.loadPayloadInput(deliveryId);
    expect(input?.profile).toEqual({
      id: s.profileId,
      position: 'backend_engineer',
    });
    expect(input?.match).toMatchObject({
      id: s.matchId,
      trigger: 'review',
      stackScore: 0.725,
      unverified: false,
    });
    expect(input?.job).toMatchObject({
      id: s.jobId,
      companyName: 'Acme',
      companyUrl: 'https://acme.test',
      descriptionText: 'We build things.',
    });
    expect(input?.facts).toEqual({ seniority: { value: 'senior' } });
    expect(await repo.loadPayloadInput(randomUUID())).toBeNull();
  });

  it('samples the latest qualified match of a user', async () => {
    const s = await seedMatch();
    expect((await repo.latestQualifiedForUser(s.userId))?.match.id).toBe(
      s.matchId,
    );
    expect(await repo.latestQualifiedForUser(randomUUID())).toBeNull();
  });

  it('loads the labels and caches them', async () => {
    const labels = await repo.loadLabels();
    expect(Object.keys(labels).sort()).toEqual([
      'cities',
      'contractTypes',
      'countries',
      'currencies',
      'languages',
      'positions',
      'regions',
      'seniorities',
      'techs',
    ]);
    expect(await repo.loadLabels()).toBe(labels);
  });
});

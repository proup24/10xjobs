import { randomUUID } from 'node:crypto';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { DeliveryService } from '../services/delivery.service';
import { PrismaWebhooksRepository } from './webhooks.repository';

const TEXT = 'pg/text@1';
const INT = 'pg/int4@1';
const BOOL = 'pg/bool@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMPTZ = 'pg/timestamptz-date@1';

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
  // A second client, so two claims run on two connections at once.
  let db2: DatabaseClient;
  let repo2: PrismaWebhooksRepository;

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
    db2 = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo2 = new PrismaWebhooksRepository({
      db: db2,
    } as unknown as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
    await db2?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE webhook_deliveries, webhooks, job_matches, job_facts, profile_skills, profiles, job_extractions, normalized_jobs CASCADE`;
  });

  /** A signed-up user; returns its id. */
  async function seedUser(): Promise<string> {
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
    return userId;
  }

  /** A published profile of the user; returns its id. */
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
      publishedAt: new Date(),
    } as never);
    return profile.id;
  }

  /** An active job with an extraction and facts; returns their ids. */
  async function seedJob(title = 'Backend Engineer') {
    const job = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: 'active',
      mergedIntoId: null,
      title,
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
    return { jobId: job.id, extractionId: extraction.id };
  }

  /** The profile's match on the job, `qualified` unless `outcome` says otherwise; returns its id. */
  async function seedMatchRow(
    userId: string,
    profileId: string,
    job: { jobId: string; extractionId: string },
    outcome: 'qualified' | 'rejected' | 'review' = 'qualified',
  ): Promise<string> {
    const matchId = randomUUID();
    const review = outcome === 'review';
    await db.execute(
      db.raw.sql`INSERT INTO job_matches
          (id, "userId", "profileId", "jobId", "extractionId", "matcherVersion",
           outcome, unverified, "reviewRule", "reviewField", "stackScore", checks,
           "decidedAt", "createdAt", "updatedAt")
        VALUES (${matchId}::uuid, ${userId}::uuid, ${profileId}::uuid, ${job.jobId}::uuid,
          ${job.extractionId}::uuid, 1, ${outcome}::text, false,
          NULLIF(${review ? 'seniority' : ''}::text, ''), NULLIF(${review ? 'seniority' : ''}::text, ''),
          0.725,
          ${JSON.stringify([{ rule: 'position', outcome: 'pass', reason: 'fits' }])}::jsonb,
          now(), now(), now())`
        .affectedCount()
        .build(),
    );
    return matchId;
  }

  /** A user, a published profile, a job with facts, and a qualified match; returns their ids. */
  async function seedMatch() {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    const job = await seedJob();
    const matchId = await seedMatchRow(userId, profileId, job);
    return { userId, profileId, jobId: job.jobId, matchId };
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

    const loaded = await repo.loadPayloadInput(deliveryId);
    expect(loaded?.outcome).toBe('qualified');
    const input = loaded?.input;
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
  /** The user's webhook; returns its id. */
  async function seedWebhook(
    userId: string,
    over: { consecutiveFailures?: number; enabled?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.execute(
      db.raw
        .sql`INSERT INTO webhooks (id, "userId", url, enabled, "consecutiveFailures")
        VALUES (${id}::uuid, ${userId}::uuid, 'https://hook.example.com/x',
          ${over.enabled ?? true}::boolean, ${over.consecutiveFailures ?? 0}::int)`
        .affectedCount()
        .build(),
    );
    return id;
  }

  /** A pending test delivery created at `createdAt`; returns its id. */
  async function seedTestDelivery(
    userId: string,
    webhookId: string,
    createdAt: Date,
  ): Promise<string> {
    const id = randomUUID();
    await db.execute(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, status, "nextAttemptAt", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${userId}::uuid, ${webhookId}::uuid, 'test', 'pending',
          ${createdAt.toISOString()}::timestamptz, ${createdAt.toISOString()}::timestamptz, now())`
        .affectedCount()
        .build(),
    );
    return id;
  }

  const profiles = new Map<string, string>();
  /**
   * A pending match delivery created at `createdAt`, for a new job and the user's profile
   * (one per user); its match is not stored. Returns its id.
   */
  async function seedMatchDelivery(
    userId: string,
    webhookId: string,
    createdAt: Date,
  ): Promise<string> {
    const profileId = profiles.get(userId) ?? (await seedProfile(userId));
    profiles.set(userId, profileId);
    const { jobId } = await seedJob();
    const id = randomUUID();
    await db.execute(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, "profileId", "jobId", "trigger", status,
           "nextAttemptAt", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${userId}::uuid, ${webhookId}::uuid, 'match', ${profileId}::uuid,
          ${jobId}::uuid, 'decision', 'pending',
          ${createdAt.toISOString()}::timestamptz, ${createdAt.toISOString()}::timestamptz, now())`
        .affectedCount()
        .build(),
    );
    return id;
  }

  async function deliveryRow(id: string) {
    const [row] = await db.query(
      db.raw
        .sql`SELECT status, attempts, "nextAttemptAt", "lastStatusCode", "lastError",
          "deliveredAt", payload
        FROM webhook_deliveries WHERE id = ${id}::uuid`
        .returnsRow({
          status: TEXT,
          attempts: INT,
          nextAttemptAt: TIMESTAMPTZ,
          lastStatusCode: INT,
          lastError: TEXT,
          deliveredAt: TIMESTAMPTZ,
          payload: JSONB,
        })
        .build(),
    );
    return row;
  }

  async function webhookRow(id: string) {
    const [row] = await db.query(
      db.raw
        .sql`SELECT enabled, "disabledReason", "consecutiveFailures", "lastSuccessAt", "lastFailureAt"
        FROM webhooks WHERE id = ${id}::uuid`
        .returnsRow({
          enabled: BOOL,
          disabledReason: TEXT,
          consecutiveFailures: INT,
          lastSuccessAt: TIMESTAMPTZ,
          lastFailureAt: TIMESTAMPTZ,
        })
        .build(),
    );
    return row;
  }

  const now = new Date('2026-11-16T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const fail503 = { status: 503, error: 'http 503' };

  it('claim returns busy while another row of the webhook is sending', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const a = await seedTestDelivery(userId, webhookId, ago(2000));
    const b = await seedTestDelivery(userId, webhookId, ago(1000));

    // Two claims at once on two connections: the webhook row lock lets exactly one win.
    const results = await Promise.all([
      repo.claim(a, now),
      repo2.claim(b, now),
    ]);
    const won = results.filter(
      (r) => typeof r === 'object' && r !== null && 'delivery' in r,
    );
    expect(won).toHaveLength(1);
    expect(results.filter((r) => r === 'busy')).toHaveLength(1);

    const winner = won[0] as Extract<
      (typeof results)[number],
      { delivery: unknown }
    >;
    expect(winner.delivery).toMatchObject({
      kind: 'test',
      attempts: 1,
      payload: null,
      userId,
    });
    expect(winner.webhook).toMatchObject({
      id: webhookId,
      url: 'https://hook.example.com/x',
    });
    expect(winner.webhook.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const loser = winner.delivery.id === a ? b : a;
    expect(await deliveryRow(loser)).toMatchObject({
      status: 'pending',
      attempts: 0,
    });

    await repo.recordSuccess(winner.delivery.id, 200, now);
    expect(await repo.claim(loser, now)).toMatchObject({
      delivery: { id: loser },
    });
  });

  it('claims, fails, holds back and releases in SQL', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const a = await seedMatchDelivery(userId, webhookId, ago(3000));
    const b = await seedMatchDelivery(userId, webhookId, ago(2000));
    const c = await seedMatchDelivery(userId, webhookId, ago(1000));

    const claim = await repo.claim(a, now);
    if (typeof claim !== 'object' || claim === null || !('delivery' in claim))
      throw new Error('no claim');
    // The stored payload comes back as Postgres keeps it, so every attempt sends the same bytes.
    const stored = await repo.savePayload(
      a,
      { z: 1, a: { y: 'x', b: 2 } },
      now,
    );
    expect(stored).toEqual({ z: 1, a: { y: 'x', b: 2 } });

    expect(await repo.recordFailure(a, fail503, now)).toEqual({
      outcome: 'retry',
      disabled: false,
    });
    expect(await deliveryRow(a)).toMatchObject({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 60_000),
      lastStatusCode: 503,
      lastError: 'http 503',
    });
    expect(await webhookRow(webhookId)).toMatchObject({
      consecutiveFailures: 1,
      lastFailureAt: now,
    });

    // Failing: only the head is listed or claimed.
    expect(await repo.claim(b, now)).toBe('held');
    expect(await repo.listDue(now, 200)).toEqual([]);
    const later = new Date(now.getTime() + 60_000);
    expect(await repo.listDue(later, 200)).toEqual([a]);
    expect(await repo.claim(a, now)).toBeNull(); // not due

    const again = await repo.claim(a, later);
    expect(again).toMatchObject({
      delivery: { attempts: 2, payload: stored },
    });
    expect(
      JSON.stringify(
        (again as { delivery: { payload: unknown } }).delivery.payload,
      ),
    ).toBe(JSON.stringify(stored));

    // A 2xx resets the failures and releases the rest, oldest first.
    await db.execute(
      db.raw
        .sql`UPDATE webhook_deliveries SET "nextAttemptAt" = ${new Date(later.getTime() + 3_600_000).toISOString()}::timestamptz
        WHERE id = ${c}::uuid`
        .affectedCount()
        .build(),
    );
    await repo.recordSuccess(a, 201, later);
    expect(await deliveryRow(a)).toMatchObject({
      status: 'delivered',
      lastStatusCode: 201,
      lastError: null,
      deliveredAt: later,
    });
    expect(await webhookRow(webhookId)).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: later,
    });
    expect((await deliveryRow(c))?.nextAttemptAt).toEqual(later);
    // One head per webhook: b, then c once b is done.
    expect(await repo.listDue(later, 200)).toEqual([b]);
    expect(await repo.nextDue(webhookId, later)).toBe(b);
    await repo.claim(b, later);
    await repo.recordSuccess(b, 200, later);
    expect(await repo.nextDue(webhookId, later)).toBe(c);
  });

  it('gives up at the 7th attempt and disables at the 10th failure', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId, { consecutiveFailures: 3 });
    const a = await seedMatchDelivery(userId, webhookId, ago(2000));
    const b = await seedMatchDelivery(userId, webhookId, ago(1000));
    await db.execute(
      db.raw
        .sql`UPDATE webhook_deliveries SET attempts = 6 WHERE id = ${a}::uuid`
        .affectedCount()
        .build(),
    );
    await repo.claim(a, now);
    expect(await repo.recordFailure(a, fail503, now)).toEqual({
      outcome: 'failed',
      disabled: false,
    });
    expect(await deliveryRow(a)).toMatchObject({
      status: 'failed',
      attempts: 7,
    });

    // The next row is now the head; one failure short of the limit.
    await db.execute(
      db.raw
        .sql`UPDATE webhooks SET "consecutiveFailures" = 9 WHERE id = ${webhookId}::uuid`
        .affectedCount()
        .build(),
    );
    expect(await repo.listDue(now, 200)).toEqual([b]);
    await repo.claim(b, now);
    expect(
      await repo.recordFailure(b, { status: null, error: 'timeout' }, now),
    ).toEqual({ outcome: 'retry', disabled: true });
    expect(await deliveryRow(b)).toMatchObject({
      status: 'pending',
      lastStatusCode: null,
      lastError: 'timeout',
    });
    expect(await webhookRow(webhookId)).toMatchObject({
      enabled: false,
      disabledReason: 'failing',
      consecutiveFailures: 10,
    });

    // Off: due rows are listed so they can be skipped.
    const due = new Date(now.getTime() + 60_000);
    expect(await repo.listDue(due, 200)).toEqual([b]);
    expect(await repo.claim(b, due)).toEqual({ skipped: true, webhookId });
    expect((await deliveryRow(b))?.status).toBe('skipped');
  });

  it('a delivery whose webhook was deleted mid-send ends quietly', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const a = await seedTestDelivery(userId, webhookId, ago(2000));
    const b = await seedTestDelivery(userId, webhookId, ago(1000));
    await repo.claim(a, now);
    await repo.claim(b, now);
    await sql`DELETE FROM webhooks`;

    await expect(repo.recordFailure(a, fail503, now)).resolves.toEqual({
      outcome: 'gone',
      disabled: false,
    });
    await expect(repo.recordSuccess(b, 200, now)).resolves.toBeUndefined();
    await expect(repo.savePayload(a, { x: 1 }, now)).resolves.toBeNull();
    await expect(repo.claim(a, now)).resolves.toBeNull();
    expect(await deliveryRow(a)).toBeUndefined();
  });

  it('recoverStuck returns rows sending for over 5 min', async () => {
    const userId = await seedUser();
    const stale = await seedTestDelivery(
      userId,
      await seedWebhook(userId),
      ago(600_000),
    );
    const otherUser = await seedUser();
    const fresh = await seedTestDelivery(
      otherUser,
      await seedWebhook(otherUser),
      ago(600_000),
    );
    await repo.claim(stale, ago(300_001));
    await repo.claim(fresh, ago(299_000));

    expect(await repo.recoverStuck(now)).toBe(1);
    expect(await deliveryRow(stale)).toMatchObject({
      status: 'pending',
      attempts: 1,
      nextAttemptAt: now,
    });
    expect((await deliveryRow(fresh))?.status).toBe('sending');
  });

  it('retention clears payload of 31-day-old match rows and deletes 31-day-old test rows', async () => {
    const s = await seedMatch();
    const webhookId = await seedWebhook(s.userId);
    const old = ago(31 * 86_400_000);
    const recent = ago(29 * 86_400_000);
    const matchRow = randomUUID();
    await db.execute(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, "profileId", "jobId", "matchId", "trigger", status,
           attempts, "lastStatusCode", "lastError", "deliveredAt", payload, "createdAt", "updatedAt")
        VALUES (${matchRow}::uuid, ${s.userId}::uuid, ${webhookId}::uuid, 'match',
          ${s.profileId}::uuid, ${s.jobId}::uuid, ${s.matchId}::uuid, 'decision', 'delivered',
          2, 200, 'http 503', ${old.toISOString()}::timestamptz, '{"version":1}'::jsonb,
          ${old.toISOString()}::timestamptz, now())`
        .affectedCount()
        .build(),
    );
    const oldTest = await seedTestDelivery(s.userId, webhookId, old);
    const recentTest = await seedTestDelivery(s.userId, webhookId, recent);

    expect(await repo.applyRetention(now)).toEqual({ cleared: 1, deleted: 1 });
    expect(await deliveryRow(matchRow)).toMatchObject({
      status: 'delivered',
      payload: null,
      lastError: null,
      lastStatusCode: 200,
    });
    expect(await deliveryRow(oldTest)).toBeUndefined();
    expect(await deliveryRow(recentTest)).toBeDefined();
    expect(await repo.applyRetention(now)).toEqual({ cleared: 0, deleted: 0 });
  });
  it('lists one head per webhook, oldest first, and a failing head only once due', async () => {
    const u1 = await seedUser();
    const u2 = await seedUser();
    const u3 = await seedUser();
    const w1 = await seedWebhook(u1);
    const w2 = await seedWebhook(u2);
    const w3 = await seedWebhook(u3, { consecutiveFailures: 2 });
    const a1 = await seedMatchDelivery(u1, w1, ago(6000));
    const b1 = await seedMatchDelivery(u2, w2, ago(5000));
    await seedMatchDelivery(u1, w1, ago(4000));
    await seedMatchDelivery(u2, w2, ago(3000));
    // w3 is failing: its oldest pending match row waits for its retry, so nothing of w3 is due.
    const c1 = await seedMatchDelivery(u3, w3, ago(7000));
    await seedMatchDelivery(u3, w3, ago(2000));
    await db.execute(
      db.raw
        .sql`UPDATE webhook_deliveries SET "nextAttemptAt" = ${new Date(now.getTime() + 60_000).toISOString()}::timestamptz
        WHERE id = ${c1}::uuid`
        .affectedCount()
        .build(),
    );
    expect(await repo.listDue(now, 200)).toEqual([a1, b1]);
    expect(await repo.listDue(now, 1)).toEqual([a1]);
    expect(await repo.nextDue(w1, now)).toBe(a1);
    expect(await repo.nextDue(w3, now)).toBeNull();
    expect(await repo.nextDue(w3, new Date(now.getTime() + 60_000))).toBe(c1);
  });

  it('release gives the attempt back and retries after the first delay', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const a = await seedTestDelivery(userId, webhookId, ago(1000));
    await repo.claim(a, now);
    await repo.release(a, now);
    expect(await deliveryRow(a)).toMatchObject({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
    expect((await webhookRow(webhookId))?.consecutiveFailures).toBe(0);
    // Only a sending row is released.
    await repo.release(a, now);
    expect((await deliveryRow(a))?.attempts).toBe(0);
  });

  it('a delivery insert is not blocked while a claim holds the webhook row', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    await db2.transaction(async (tx) => {
      // What claim takes on the webhook row.
      await tx.query(
        tx.raw
          .sql`SELECT id FROM webhooks WHERE id = ${webhookId}::uuid FOR NO KEY UPDATE`
          .returnsRow({ id: 'pg/uuid@1' })
          .build(),
      );
      // The foreign key check of a new delivery takes KEY SHARE, which NO KEY UPDATE allows.
      await db.transaction(async (other) => {
        await other.execute(
          other.raw.sql`SET LOCAL lock_timeout = '2s'`.affectedCount().build(),
        );
        await other.execute(
          other.raw
            .sql`INSERT INTO webhook_deliveries ("userId", "webhookId", kind, status)
            VALUES (${userId}::uuid, ${webhookId}::uuid, 'test', 'pending')`
            .affectedCount()
            .build(),
        );
      });
    });
  });
  it('a test row goes past a failing head and leaves the failure counter alone', async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId, { consecutiveFailures: 9 });
    const head = await seedMatchDelivery(userId, webhookId, ago(3000));
    const held = await seedMatchDelivery(userId, webhookId, ago(2000));
    await db.execute(
      db.raw
        .sql`UPDATE webhook_deliveries SET "nextAttemptAt" = ${new Date(now.getTime() + 60_000).toISOString()}::timestamptz
        WHERE id = ${head}::uuid`
        .affectedCount()
        .build(),
    );
    const test = await seedTestDelivery(userId, webhookId, ago(1000));

    expect(await repo.listDue(now, 200)).toEqual([test]);
    expect(await repo.nextDue(webhookId, now)).toBe(test);
    expect(await repo.claim(held, now)).toBe('held');
    expect(await repo.claim(test, now)).toMatchObject({
      delivery: { id: test, kind: 'test' },
    });
    // The 10th failure in a row, but a test's: no count, no auto-disable.
    expect(await repo.recordFailure(test, fail503, now)).toEqual({
      outcome: 'retry',
      disabled: false,
    });
    expect(await webhookRow(webhookId)).toMatchObject({
      enabled: true,
      consecutiveFailures: 9,
      lastFailureAt: null,
    });
    expect(await deliveryRow(test)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'http 503',
    });

    // A test's 2xx neither resets the counter nor releases the held rows.
    const later = new Date(now.getTime() + 60_000);
    await repo.claim(test, later);
    await repo.recordSuccess(test, 200, later);
    expect((await deliveryRow(test))?.status).toBe('delivered');
    expect(await webhookRow(webhookId)).toMatchObject({
      consecutiveFailures: 9,
      lastSuccessAt: null,
    });
    expect(await repo.claim(held, later)).toBe('held');
  });

  describe('a match delivery whose match was deleted', () => {
    /** A pending decision delivery of job A, a qualified match on A, and the webhook. */
    async function pendingOnA() {
      const userId = await seedUser();
      const profileId = await seedProfile(userId);
      const a = await seedJob('Job A');
      const matchA = await seedMatchRow(userId, profileId, a);
      const webhookId = await seedWebhook(userId);
      const id = randomUUID();
      await db.execute(
        db.raw.sql`INSERT INTO webhook_deliveries
            (id, "userId", "webhookId", kind, "profileId", "jobId", "matchId", "trigger", status)
          VALUES (${id}::uuid, ${userId}::uuid, ${webhookId}::uuid, 'match', ${profileId}::uuid,
            ${a.jobId}::uuid, ${matchA}::uuid, 'decision', 'pending')`
          .affectedCount()
          .build(),
      );
      return { userId, profileId, a, id };
    }

    /** Ingest merges `from` into `into`; the match sweep's deleteInactive then drops `from`'s matches. */
    async function mergeAndSweep(from: string, into: string) {
      await db.execute(
        db.raw
          .sql`UPDATE normalized_jobs SET status = 'merged', "mergedIntoId" = ${into}::uuid
          WHERE id = ${from}::uuid`
          .affectedCount()
          .build(),
      );
      await sql`DELETE FROM job_matches m USING normalized_jobs j
        WHERE j.id = m."jobId" AND j.status <> 'active'`;
    }

    it("sends the merge root's qualified match when the job merged before its first send", async () => {
      const s = await pendingOnA();
      const b = await seedJob('Job B');
      const matchB = await seedMatchRow(s.userId, s.profileId, b);
      await mergeAndSweep(s.a.jobId, b.jobId);
      const [row] = await db.query(
        db.raw
          .sql`SELECT "matchId" FROM webhook_deliveries WHERE id = ${s.id}::uuid`
          .returnsRow({ matchId: 'pg/uuid@1' })
          .build(),
      );
      expect(row.matchId).toBeNull();

      const sent: { body: string }[] = [];
      const service = new DeliveryService(
        repo,
        { webAppUrl: 'https://app.example.com' },
        async (i) => {
          sent.push(i);
          return { ok: true, status: 200 };
        },
        () => now,
      );
      expect((await service.deliver(s.id)).result).toBe('delivered');
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0].body)).toMatchObject({
        event: 'match.qualified',
        deliveryId: s.id,
        match: { id: matchB },
        job: { id: b.jobId, title: 'Job B' },
      });
    });

    it('follows the merge chain to its root', async () => {
      const s = await pendingOnA();
      const b = await seedJob('Job B');
      const d = await seedJob('Job D');
      const matchD = await seedMatchRow(s.userId, s.profileId, d);
      await mergeAndSweep(s.a.jobId, b.jobId);
      await mergeAndSweep(b.jobId, d.jobId);
      const loaded = await repo.loadPayloadInput(s.id);
      expect(loaded?.input.match.id).toBe(matchD);
      expect(loaded?.input.job.id).toBe(d.jobId);
    });

    it("returns the root match's outcome, so a rejected one is not sent as qualified", async () => {
      const s = await pendingOnA();
      const b = await seedJob('Job B');
      await seedMatchRow(s.userId, s.profileId, b, 'rejected');
      await mergeAndSweep(s.a.jobId, b.jobId);
      expect((await repo.loadPayloadInput(s.id))?.outcome).toBe('rejected');
    });

    it('is null when the root has no match for the profile', async () => {
      const s = await pendingOnA();
      const b = await seedJob('Job B');
      await mergeAndSweep(s.a.jobId, b.jobId);
      expect(await repo.loadPayloadInput(s.id)).toBeNull();
    });
  });

  it("reads the match's current outcome after a rematch", async () => {
    const s = await seedMatch();
    const webhookId = await seedWebhook(s.userId);
    const id = randomUUID();
    await db.execute(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, "profileId", "jobId", "matchId", "trigger", status)
        VALUES (${id}::uuid, ${s.userId}::uuid, ${webhookId}::uuid, 'match',
          ${s.profileId}::uuid, ${s.jobId}::uuid, ${s.matchId}::uuid, 'decision', 'pending')`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`UPDATE job_matches SET outcome = 'rejected' WHERE id = ${s.matchId}::uuid`
        .affectedCount()
        .build(),
    );
    expect(await repo.loadPayloadInput(id)).toMatchObject({
      outcome: 'rejected',
      input: { match: { id: s.matchId } },
    });
  });
});

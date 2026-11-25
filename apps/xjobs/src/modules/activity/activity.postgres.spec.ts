import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { PrismaActivityRepository } from './activity.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. The
 * PostgreSQL specs run one file at a time (see `vitest.config.mts`).
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const at = new Date('2026-11-10T12:00:00.000Z');
const H = 24;
const hoursBefore = (hours: number) =>
  new Date(at.getTime() - hours * 3600_000);
const BOARD = Channel.LINKEDIN_JOB_BOARD;

describe.skipIf(!url)('activity in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaActivityRepository;

  async function exec(statement: ReturnType<DatabaseClient['raw']['sql']>) {
    await db.execute(statement.affectedCount().build());
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
    repo = new PrismaActivityRepository({ db } as unknown as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await exec(
      db.raw
        .sql`TRUNCATE job_views, match_reviews, webhook_deliveries, webhooks, job_decisions, job_matches, profile_query_search_builders, query_search_builder, profiles, job_extractions, normalized_jobs CASCADE`,
    );
  });

  async function seedUser(searchesResumedAt: Date | null = null) {
    const userId = randomUUID();
    await exec(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`,
    );
    // Signing up creates the users row; ON CONFLICT covers a database without that trigger.
    await exec(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    if (searchesResumedAt)
      await exec(
        db.raw
          .sql`UPDATE users SET "searchesResumedAt" = ${searchesResumedAt.toISOString()}::timestamptz WHERE id = ${userId}::uuid`,
      );
    return userId;
  }

  async function seedProfile(
    userId: string,
    over: { state?: 'draft' | 'published'; publishedAt?: Date | null } = {},
  ): Promise<string> {
    const state = over.state ?? 'published';
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
      state,
      publishedAt:
        over.publishedAt !== undefined
          ? over.publishedAt
          : state === 'published'
            ? hoursBefore(30 * 24)
            : null,
    } as never);
    return profile.id;
  }

  interface Job {
    jobId: string;
    extractionId: string;
  }

  async function seedJob(
    over: {
      lastSeenAt?: Date;
      mergedIntoId?: string;
      closed?: boolean;
      factsClosed?: boolean;
      expiresAt?: Date;
    } = {},
  ): Promise<Job> {
    const job = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: over.mergedIntoId ? 'merged' : 'active',
      mergedIntoId: over.mergedIntoId ?? null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: over.closed ?? false,
      expiresAt: over.expiresAt ?? null,
      fieldSources: {},
      firstSeenAt: hoursBefore(20 * 24),
      lastSeenAt: over.lastSeenAt ?? hoursBefore(1),
      processingStatus: 'processed',
      processingReason: null,
      processingRequestedAt: hoursBefore(20 * 24),
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
    if (over.factsClosed !== undefined)
      await exec(
        db.raw.sql`INSERT INTO job_facts
            ("jobId", "extractionId", "factsVersion", "factsHash", facts, closed, "builtAt", "createdAt", "updatedAt")
          VALUES (${job.id}::uuid, ${extraction.id}::uuid, 1, 'h1', '{}'::jsonb,
            ${over.factsClosed}::boolean, now(), now(), now())`,
      );
    return { jobId: job.id, extractionId: extraction.id };
  }

  async function seedMatch(
    userId: string,
    profileId: string,
    job: Job,
    over: { decidedAt?: Date; outcome?: 'qualified' | 'review' } = {},
  ): Promise<string> {
    const id = randomUUID();
    const outcome = over.outcome ?? 'qualified';
    const review = outcome === 'review' ? 'seniority' : '';
    await exec(
      db.raw.sql`INSERT INTO job_matches
          (id, "userId", "profileId", "jobId", "extractionId", "matcherVersion",
           outcome, unverified, "reviewRule", "reviewField", "stackScore", checks,
           "decidedAt", "createdAt", "updatedAt")
        VALUES (${id}::uuid, ${userId}::uuid, ${profileId}::uuid, ${job.jobId}::uuid,
          ${job.extractionId}::uuid, 1, ${outcome}::text, false,
          NULLIF(${review}::text, ''), NULLIF(${review}::text, ''), 0.5, '[]'::jsonb,
          ${(over.decidedAt ?? hoursBefore(25)).toISOString()}::timestamptz, now(), now())`,
    );
    return id;
  }

  async function seedDecision(
    userId: string,
    jobId: string,
    status: 'applied' | 'dismissed' | 'expired',
    decidedAt: Date,
  ): Promise<void> {
    await exec(
      db.raw
        .sql`INSERT INTO job_decisions (id, "userId", "jobId", status, "decidedAt", "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${jobId}::uuid, ${status}::text,
          ${decidedAt.toISOString()}::timestamptz, now(), now())`,
    );
  }

  async function seedView(
    userId: string,
    jobId: string,
    viewedAt: Date,
  ): Promise<void> {
    await exec(
      db.raw.sql`INSERT INTO job_views (id, "userId", "jobId", "viewedAt")
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${jobId}::uuid,
          ${viewedAt.toISOString()}::timestamptz)`,
    );
  }

  async function seedReview(
    userId: string,
    profileId: string,
    matchId: string,
    jobId: string,
    createdAt: Date,
  ): Promise<void> {
    await exec(
      db.raw.sql`INSERT INTO match_reviews
          (id, "userId", "profileId", "matchId", "jobId", choice, rule, field, "createdAt", "updatedAt")
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${profileId}::uuid, ${matchId}::uuid,
          ${jobId}::uuid, 'qualified', 'location', 'arrangement',
          ${createdAt.toISOString()}::timestamptz, ${createdAt.toISOString()}::timestamptz)`,
    );
  }

  async function seedDelivery(
    userId: string,
    profileId: string,
    over: {
      kind?: 'match' | 'test';
      status?: 'delivered' | 'failed';
      deliveredAt: Date;
    },
  ): Promise<void> {
    // A user has at most one webhook.
    const [webhook] = await db.query(
      db.raw.sql`INSERT INTO webhooks (id, "userId", url)
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, 'https://hook.example.com/x')
        ON CONFLICT ("userId") DO UPDATE SET url = EXCLUDED.url
        RETURNING id`
        .returnsRow({ id: 'pg/uuid@1' })
        .build(),
    );
    const webhookId = webhook!.id as string;
    const kind = over.kind ?? 'match';
    const jobId = kind === 'match' ? (await seedJob()).jobId : '';
    await exec(
      db.raw.sql`INSERT INTO webhook_deliveries
          (id, "userId", "webhookId", kind, "profileId", "jobId", "trigger", status, "deliveredAt")
        VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${webhookId}::uuid, ${kind}::text,
          NULLIF(${kind === 'match' ? profileId : ''}::text, '')::uuid, NULLIF(${jobId}::text, '')::uuid,
          NULLIF(${kind === 'match' ? 'decision' : ''}::text, ''), ${over.status ?? 'delivered'}::text,
          ${over.deliveredAt.toISOString()}::timestamptz)`,
    );
  }

  async function seedBuilder(
    over: { channel?: Channel; isActive?: boolean; isDeleted?: boolean } = {},
  ): Promise<string> {
    const isDeleted = over.isDeleted ?? false;
    const isActive = over.isActive ?? !isDeleted;
    const row = await db.orm.public.QuerySearchBuilder.create({
      channel: over.channel ?? BOARD,
      location: 'worldwide',
      experience: 'senior',
      technologies: [],
      domain: 'backend',
      type: 'remote',
      keyword: 'backend',
      version: 1,
      params: {},
      hash: randomUUID(),
      associatedProfiles: isActive ? 1 : 0,
      isActive,
      isDeleted,
    });
    return row.id;
  }

  async function link(profileId: string, queryId: string): Promise<void> {
    await exec(
      db.raw
        .sql`INSERT INTO profile_query_search_builders (id, "profileId", "queryId")
        VALUES (${randomUUID()}::uuid, ${profileId}::uuid, ${queryId}::uuid)`,
    );
  }

  /** A user with a published profile, one linked builder and one qualified match decided `waited` hours before `at`. */
  async function waitingUser(waited = 25) {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    const builderId = await seedBuilder();
    await link(profileId, builderId);
    const job = await seedJob();
    await seedMatch(userId, profileId, job, { decidedAt: hoursBefore(waited) });
    return { userId, profileId, builderId, job };
  }

  const paused = async () => [...(await repo.pausedBuilderIds(BOARD, at, H))];

  it('pauses a user whose match waited 25h with no signal', async () => {
    const u = await waitingUser(25);
    expect(await paused()).toEqual([u.builderId]);
    expect(await repo.userState(u.userId, at, H)).toMatchObject({
      paused: true,
    });
  });

  it('counts a match decided exactly H hours before as waiting', async () => {
    const u = await waitingUser(H);
    expect(await paused()).toEqual([u.builderId]);
  });

  it('does not pause a match that waited 23h', async () => {
    const u = await waitingUser(23);
    expect(await paused()).toEqual([]);
    expect((await repo.userState(u.userId, at, H)).paused).toBe(false);
  });

  it('does not pause an empty or fully decided list', async () => {
    const empty = await seedUser();
    const emptyProfile = await seedProfile(empty);
    await link(emptyProfile, await seedBuilder());

    const decided = await waitingUser(25);
    // Decided long ago: the match no longer waits and the decision is outside the span.
    await seedDecision(
      decided.userId,
      decided.job.jobId,
      'dismissed',
      hoursBefore(48),
    );

    expect(await paused()).toEqual([]);
  });

  describe('each signal keeps the user active', () => {
    it.each(['applied', 'dismissed', 'expired'] as const)(
      'a %s decision',
      async (status) => {
        const u = await waitingUser(25);
        await seedDecision(
          u.userId,
          (await seedJob()).jobId,
          status,
          hoursBefore(1),
        );
        expect(await paused()).toEqual([]);
      },
    );

    it('a delivered match webhook', async () => {
      const u = await waitingUser(25);
      await seedDelivery(u.userId, u.profileId, {
        deliveredAt: hoursBefore(1),
      });
      expect(await paused()).toEqual([]);
    });

    it('a job view', async () => {
      const u = await waitingUser(25);
      // The viewed job is the matched one: RLS only lets a user view a job they have a match for.
      await seedView(u.userId, u.job.jobId, hoursBefore(1));
      expect(await paused()).toEqual([]);
    });

    it('a review choice', async () => {
      const u = await waitingUser(25);
      const job = await seedJob();
      const matchId = await seedMatch(u.userId, u.profileId, job, {
        outcome: 'review',
        decidedAt: hoursBefore(25),
      });
      await seedReview(
        u.userId,
        u.profileId,
        matchId,
        job.jobId,
        hoursBefore(1),
      );
      expect(await paused()).toEqual([]);
    });

    it('a view wakes a paused user on the next tick', async () => {
      const u = await waitingUser(25);
      expect(await paused()).toEqual([u.builderId]);
      await seedView(u.userId, u.job.jobId, new Date(at.getTime() + 60_000));
      const later = new Date(at.getTime() + 120_000);
      expect([...(await repo.pausedBuilderIds(BOARD, later, H))]).toEqual([]);
    });

    it('a resume', async () => {
      const u = await waitingUser(25);
      await repo.resume(u.userId, hoursBefore(1));
      expect(await paused()).toEqual([]);
    });

    it('a profile published in the span', async () => {
      const userId = await seedUser();
      const profileId = await seedProfile(userId, {
        publishedAt: hoursBefore(1),
      });
      await link(profileId, await seedBuilder());
      await seedMatch(userId, profileId, await seedJob(), {
        decidedAt: hoursBefore(25),
      });
      expect(await paused()).toEqual([]);
    });

    it('not a signal exactly H hours before, nor one after the tick', async () => {
      const u = await waitingUser(30);
      await seedDecision(
        u.userId,
        (await seedJob()).jobId,
        'applied',
        hoursBefore(H),
      );
      await seedDelivery(u.userId, u.profileId, {
        deliveredAt: hoursBefore(-1),
      });
      await seedView(u.userId, u.job.jobId, hoursBefore(H));
      const reviewJob = await seedJob();
      const reviewMatch = await seedMatch(u.userId, u.profileId, reviewJob, {
        outcome: 'review',
        decidedAt: hoursBefore(30),
      });
      await seedReview(
        u.userId,
        u.profileId,
        reviewMatch,
        reviewJob.jobId,
        hoursBefore(-1),
      );
      expect(await paused()).toEqual([u.builderId]);
    });
  });

  it('a failed or test delivery is not a signal', async () => {
    const u = await waitingUser(25);
    await seedDelivery(u.userId, u.profileId, {
      status: 'failed',
      deliveredAt: hoursBefore(1),
    });
    await seedDelivery(u.userId, u.profileId, {
      kind: 'test',
      deliveredAt: hoursBefore(1),
    });
    expect(await paused()).toEqual([u.builderId]);
  });

  it('ignores review rows, archived jobs, jobs last seen over 7 days ago, and draft profiles', async () => {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    await link(profileId, await seedBuilder());
    const old = hoursBefore(25);
    // Review row.
    await seedMatch(userId, profileId, await seedJob(), {
      outcome: 'review',
      decidedAt: old,
    });
    // A job that is no longer active (merged into another).
    const survivor = await seedJob();
    await seedMatch(
      userId,
      profileId,
      await seedJob({ mergedIntoId: survivor.jobId }),
      { decidedAt: old },
    );
    // Last seen just over 7 days ago.
    await seedMatch(
      userId,
      profileId,
      await seedJob({ lastSeenAt: hoursBefore(7 * 24 + 1) }),
      { decidedAt: old },
    );
    // A draft profile's match.
    const draft = await seedProfile(userId, { state: 'draft' });
    await seedMatch(userId, draft, await seedJob(), { decidedAt: old });

    expect(await paused()).toEqual([]);
    expect((await repo.userState(userId, at, H)).paused).toBe(false);
  });

  // The Matches list hides closed jobs (match_details `closed`), so they never wait.
  it.each([
    ['its own closed flag', { closed: true }],
    ['closed job facts', { factsClosed: true }],
    ['a LinkedIn expiry at or before the tick', { expiresAt: hoursBefore(2) }],
  ] as const)(
    'a match on a job closed by %s does not pause',
    async (_, job) => {
      const userId = await seedUser();
      const profileId = await seedProfile(userId);
      await link(profileId, await seedBuilder());
      await seedMatch(userId, profileId, await seedJob(job), {
        decidedAt: hoursBefore(25),
      });

      expect(await paused()).toEqual([]);
      expect((await repo.userState(userId, at, H)).paused).toBe(false);
    },
  );

  it('counts a job with open facts or an expiry after the tick as waiting', async () => {
    const userId = await seedUser();
    const profileId = await seedProfile(userId);
    const builderId = await seedBuilder();
    await link(profileId, builderId);
    // Expires after the tick but before now(): expiry is judged at the tick.
    await seedMatch(
      userId,
      profileId,
      await seedJob({
        factsClosed: false,
        expiresAt: new Date(at.getTime() + 3600_000),
      }),
      { decidedAt: hoursBefore(25) },
    );

    expect(await paused()).toEqual([builderId]);
  });

  it('keeps a shared builder runnable while one owner is active', async () => {
    const active = await waitingUser(25);
    await seedDecision(
      active.userId,
      (await seedJob()).jobId,
      'applied',
      hoursBefore(2),
    );
    const idle = await waitingUser(25);
    await link(idle.profileId, active.builderId);

    expect(await paused()).toEqual([idle.builderId]);
  });

  it('pauses per user across profiles', async () => {
    const u = await waitingUser(25);
    const second = await seedProfile(u.userId);
    const secondBuilder = await seedBuilder();
    await link(second, secondBuilder);
    const posts = await seedBuilder({ channel: Channel.LINKEDIN_POSTS });
    await link(second, posts);

    expect((await paused()).sort()).toEqual(
      [u.builderId, secondBuilder].sort(),
    );
    expect([
      ...(await repo.pausedBuilderIds(Channel.LINKEDIN_POSTS, at, H)),
    ]).toEqual([posts]);
  });

  it('pauses only active builders with a published owner', async () => {
    const u = await waitingUser(25);
    await link(u.profileId, await seedBuilder({ isActive: false }));
    await link(u.profileId, await seedBuilder({ isDeleted: true }));
    const draft = await seedProfile(u.userId, { state: 'draft' });
    await link(draft, await seedBuilder());
    await seedBuilder();

    expect(await paused()).toEqual([u.builderId]);
  });

  it('userState: paused only when a builder of theirs is paused', async () => {
    const active = await waitingUser(25);
    await repo.resume(active.userId, hoursBefore(1));
    const idle = await seedUser();
    const idleProfile = await seedProfile(idle);
    await link(idleProfile, active.builderId);
    await seedMatch(idle, idleProfile, await seedJob(), {
      decidedAt: hoursBefore(25),
    });

    expect(await repo.userState(idle, at, H)).toMatchObject({
      paused: false,
    });
  });

  it('userState: lastActiveAt is the latest signal', async () => {
    const userId = await seedUser(hoursBefore(50));
    const profileId = await seedProfile(userId, {
      publishedAt: hoursBefore(100),
    });
    await seedDecision(
      userId,
      (await seedJob()).jobId,
      'expired',
      hoursBefore(40),
    );
    await seedDelivery(userId, profileId, { deliveredAt: hoursBefore(30) });
    // Not signals: a failed delivery, a test delivery, a draft's publishedAt.
    await seedDelivery(userId, profileId, {
      status: 'failed',
      deliveredAt: hoursBefore(1),
    });
    await seedDelivery(userId, profileId, {
      kind: 'test',
      deliveredAt: hoursBefore(1),
    });
    await seedProfile(userId, { state: 'draft', publishedAt: hoursBefore(2) });

    expect(await repo.userState(userId, at, H)).toEqual({
      paused: false,
      lastActiveAt: hoursBefore(30),
    });
    // A view newer than every other signal, then a review newer still.
    const viewJob = await seedJob();
    await seedView(userId, viewJob.jobId, hoursBefore(20));
    expect((await repo.userState(userId, at, H)).lastActiveAt).toEqual(
      hoursBefore(20),
    );
    const reviewMatch = await seedMatch(userId, profileId, viewJob, {
      outcome: 'review',
      decidedAt: hoursBefore(90),
    });
    await seedReview(
      userId,
      profileId,
      reviewMatch,
      viewJob.jobId,
      hoursBefore(10),
    );
    expect((await repo.userState(userId, at, H)).lastActiveAt).toEqual(
      hoursBefore(10),
    );
    expect(await repo.userState(await seedUser(), at, H)).toEqual({
      paused: false,
      lastActiveAt: null,
    });
  });

  it('resume never moves searchesResumedAt back', async () => {
    const userId = await seedUser();
    const resumedAt = async () =>
      (await db.orm.public.User.where({ id: userId }).first())
        ?.searchesResumedAt;

    await repo.resume(userId, at);
    expect(await resumedAt()).toEqual(at);
    await repo.resume(userId, hoursBefore(1));
    expect(await resumedAt()).toEqual(at);
    await repo.resume(userId, hoursBefore(-1));
    expect(await resumedAt()).toEqual(hoursBefore(-1));
  });
});

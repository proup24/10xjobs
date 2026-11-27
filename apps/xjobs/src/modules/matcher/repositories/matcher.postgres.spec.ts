import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  createDatabaseClient,
  type DatabaseClient,
  processorListsSeed,
} from '@xjobs/database';
import type { SeedEnvironmentVariables } from 'src/config';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { FACTS_VERSION } from 'src/modules/facts/config/facts.config';
import {
  MATCHER_VERSION,
  POST_AGE_STALE_MARGIN_MINUTES,
  POST_MAX_AGE_DAYS,
} from '../config/matcher.config';
import { PrismaRatesRepository } from 'src/modules/rates/rates.repository';
import { rolePost } from '../rules/fixtures.testing';
import { checkPostAge } from '../rules/post';
import {
  PrismaMatcherRepository,
  type StoredMatch,
} from './matcher.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Every
 * test on that database lives in this file and the processor one, so they
 * never run in parallel.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');
const DAY = 86_400_000;

describe.skipIf(!url)('matcher repository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaMatcherRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  async function source(jobId: string, channel: Channel): Promise<void> {
    const run = await db.orm.public.SearchSegmentRun.create({
      channel,
      segmentKey: 'k',
      segmentHash: randomUUID(),
      queryIds: [],
      windowStart: t0,
      windowEnd: new Date(t0.getTime() + 3_600_000),
      startedAt: t0,
      finishedAt: t0,
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
      storageKey: `${channel}/x/${run.id}.json`,
      formatVersion: 1,
      observedAt: t0,
      itemCount: 1,
      actor: 'test',
      apifyRunId: null,
      status: 'ingested',
    });
    const item = await db.orm.public.RawItem.create({
      channel,
      sourceKey: randomUUID(),
      kind: 'job',
      firstSeenAt: t0,
      lastSeenAt: t0,
      latestVersionId: null,
    });
    const version = await db.orm.public.RawItemVersion.create({
      rawItemId: item.id,
      contentHash: randomUUID(),
      payload: {},
      firstBatchId: batch.id,
      firstSeenAt: t0,
      lastSeenAt: t0,
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
    await db.orm.public.NormalizedJobSource.create({
      jobId,
      rawItemId: item.id,
      normalizedVersionId: normalized.id,
      linkedAt: t0,
    });
  }

  async function extraction(
    jobId: string,
    schemaVersion = EXTRACTION_SCHEMA_VERSION,
  ): Promise<string> {
    const row = await db.orm.public.JobExtraction.create({
      jobId,
      inputHash: randomUUID(),
      schemaVersion,
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
    return row.id;
  }

  interface JobSpec {
    channels?: Channel[];
    closed?: boolean;
    lastSeenAt?: Date;
    processingStatus?: string | null;
    schemaVersion?: number;
    expiresAt?: Date | null;
  }

  /** A processed active job with a current extraction, last seen now. */
  async function job(spec: JobSpec = {}): Promise<{
    id: string;
    extractionId: string;
  }> {
    const row = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'job',
      status: 'active',
      mergedIntoId: null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      location: 'Berlin, Germany',
      contractType: null,
      experienceLevel: null,
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionText: 'We build things.',
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: spec.closed ?? false,
      fieldSources: {},
      firstSeenAt: new Date(
        Math.min(t0.getTime(), (spec.lastSeenAt ?? t0).getTime()),
      ),
      lastSeenAt: spec.lastSeenAt ?? new Date(),
      processingStatus:
        spec.processingStatus === undefined
          ? 'processed'
          : spec.processingStatus,
      processingReason: null,
      processingRequestedAt: t0,
      normalizerVersion: 1,
      ...(spec.expiresAt ? { expiresAt: spec.expiresAt } : {}),
    } as never);
    for (const channel of spec.channels ?? [Channel.LINKEDIN_JOB_BOARD])
      await source(row.id, channel);
    const extractionId = await extraction(row.id, spec.schemaVersion);
    await db.orm.public.NormalizedJob.where({ id: row.id }).updateAll({
      currentExtractionId: extractionId,
    });
    return { id: row.id, extractionId };
  }

  /** Stores the job's facts row as `FactsService.build` would, built now. */
  async function facts(
    j: { id: string; extractionId: string },
    over: { factsHash?: string; closed?: boolean; factsVersion?: number } = {},
  ): Promise<void> {
    await db.execute(
      db.raw.sql`INSERT INTO job_facts
          ("jobId", "extractionId", "factsVersion", "factsHash", facts, closed, "builtAt", "createdAt", "updatedAt")
        VALUES (${j.id}::uuid, ${j.extractionId}::uuid, ${over.factsVersion ?? FACTS_VERSION}::int,
          ${over.factsHash ?? 'h1'}::text, '{}'::jsonb, ${over.closed ?? false}::boolean, now(), now(), now())
        ON CONFLICT ("jobId") DO UPDATE SET
          "extractionId" = EXCLUDED."extractionId", "factsVersion" = EXCLUDED."factsVersion",
          "factsHash" = EXCLUDED."factsHash", closed = EXCLUDED.closed, "builtAt" = now()`
        .affectedCount()
        .build(),
    );
  }

  async function profile(opts: { postSearch?: boolean } = {}): Promise<{
    id: string;
    userId: string;
    matchVersion: number;
  }> {
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
    const row = await db.orm.public.Profile.create({
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
      // A profile may not name worldwide (migration profile_places_no_worldwide).
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
    await db.orm.public.ProfileSkill.create({
      userId,
      profileId: row.id,
      technology: 'python',
      domain: 'backend',
      mastery: 8,
      importance: 9,
    } as never);
    // A switch is an engine write: it never bumps matchVersion.
    if (opts.postSearch)
      await db.execute(
        db.raw
          .sql`UPDATE profiles SET "postSearch" = true WHERE id = ${row.id}::uuid`
          .affectedCount()
          .build(),
      );
    // The skill insert above bumped the version (trigger), so read it back.
    const fresh = await db.orm.public.Profile.where({ id: row.id }).first();
    return {
      id: row.id,
      userId,
      matchVersion: (fresh as unknown as { matchVersion: number }).matchVersion,
    };
  }

  const decision = (
    over: Partial<StoredMatch> = {},
  ): Omit<
    StoredMatch,
    | 'profileId'
    | 'userId'
    | 'jobId'
    | 'extractionId'
    | 'factsHash'
    | 'profileVersion'
    | 'eligibilityVersion'
  > => ({
    outcome: 'qualified',
    unverified: false,
    review: null,
    stackScore: 0.75,
    checks: [
      {
        rule: 'position',
        outcome: 'pass',
        jobValue: 'backend',
        profileValue: 'backend_engineer',
        reason: 'same',
        unsure: false,
        unsureField: null,
      },
    ],
    ...over,
  });

  const row = (
    p: { id: string; userId: string; matchVersion: number },
    j: { id: string; extractionId: string },
    over: Partial<StoredMatch> = {},
  ): StoredMatch => ({
    profileId: p.id,
    userId: p.userId,
    jobId: j.id,
    extractionId: j.extractionId,
    factsHash: 'h1',
    profileVersion: p.matchVersion,
    eligibilityVersion: 0,
    ...decision(),
    ...over,
  });

  /** What a profile edit does through its triggers: raise `matchVersion`, here to `version`. */
  async function setMatchVersion(id: string, version: number) {
    await db.execute(
      db.raw
        .sql`UPDATE profiles SET "matchVersion" = ${String(version)}::int WHERE id = ${id}::uuid`
        .affectedCount()
        .build(),
    );
  }

  async function matchRow(profileId: string, jobId: string) {
    return db.orm.public.JobMatch.where({ profileId, jobId }).first();
  }

  interface RoleSpec {
    postedAt?: Date | null;
    verdictConfidence?: string | null;
    processingStatus?: string;
    postSources?: unknown;
  }

  /** Two sources: a plain post by Jane, and Sam's share of an original by Acme. */
  const TWO_SOURCES = {
    sources: [
      {
        author: { key: 'profile:jane-doe', name: 'Jane Doe' },
        original: null,
      },
      {
        author: { key: 'profile:sam-lee', name: 'Sam Lee' },
        original: { author: { key: 'company:acme', name: 'Acme' } },
      },
    ],
  };

  /**
   * A processed `post` job with its post extraction, and one `post_role` job
   * under it whose current extraction is a listing-shaped row of the post job
   * (as PostStore writes it). The role job has no source of its own.
   */
  async function roleJob(spec: RoleSpec = {}): Promise<{
    id: string;
    extractionId: string;
    postJobId: string;
  }> {
    const base = {
      status: 'active',
      mergedIntoId: null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      location: null,
      contractType: null,
      experienceLevel: null,
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionText: 'We are hiring a backend engineer.',
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: new Date(),
      processingReason: null,
      processingRequestedAt: t0,
      normalizerVersion: 1,
    };
    const post = await db.orm.public.NormalizedJob.create({
      ...base,
      jobKey: randomUUID(),
      kind: 'post',
      postingUrl: `https://www.linkedin.com/feed/update/${randomUUID()}`,
      processingStatus: 'processed',
      postSources: (spec.postSources ?? TWO_SOURCES) as never,
    } as never);
    const postExtraction = await db.orm.public.JobExtraction.create({
      jobId: post.id,
      inputHash: randomUUID(),
      schemaVersion: 1,
      promptHash: 'p',
      decisionModel: null,
      extractionModel: 'e',
      data: {} as never,
      needsReview: false,
      docType: 'post',
      verdict: 'hiring',
      verdictReason: 'hiring',
      verdictConfidence:
        spec.verdictConfidence === undefined ? 'sure' : spec.verdictConfidence,
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
    } as never);
    await db.orm.public.NormalizedJob.where({ id: post.id }).updateAll({
      currentExtractionId: postExtraction.id,
    });
    const role = await db.orm.public.NormalizedJob.create({
      ...base,
      jobKey: `${post.jobKey}#role:r1`,
      kind: 'post_role',
      parentJobId: post.id,
      roleKey: 'r1',
      postingUrl: post.postingUrl,
      processingStatus: spec.processingStatus ?? 'processed',
      ...(spec.postedAt === null
        ? {}
        : { postedAt: spec.postedAt ?? new Date(Date.now() - 2 * DAY) }),
    } as never);
    const extractionId = await extraction(post.id);
    await db.orm.public.NormalizedJob.where({ id: role.id }).updateAll({
      currentExtractionId: extractionId,
    });
    return { id: role.id, extractionId, postJobId: post.id };
  }

  async function block(userId: string, authorKey: string, name?: string) {
    await db.orm.public.BlockedAuthor.create({
      userId,
      authorKey,
      name: name ?? null,
      profileUrl: null,
    } as never);
  }

  async function setMatchUpdatedAt(jobId: string, at: Date) {
    await db.execute(
      db.raw
        .sql`UPDATE job_matches SET "updatedAt" = ${at.toISOString()}::timestamptz WHERE "jobId" = ${jobId}::uuid`
        .affectedCount()
        .build(),
    );
  }

  beforeAll(async () => {
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
    repo = new PrismaMatcherRepository(
      { db } as DatabaseService,
      new PrismaRatesRepository({ db } as DatabaseService),
    );
    await sql`TRUNCATE processing_attempts, job_extractions, cities, region_countries, tech_tags, regions, countries, role_kinds, seniorities, arrangements, contract_types, engagements, junk_flags CASCADE`;
    await db.transaction((tx) =>
      processorListsSeed.run(tx, {} as SeedEnvironmentVariables),
    );
    // Profiles name their languages from this list; the test database starts empty.
    await sql`INSERT INTO iso_languages (code, label) VALUES ('en', 'English'), ('fr', 'French') ON CONFLICT (code) DO NOTHING`;
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE blocked_authors, webhook_deliveries, webhooks, job_matches, work_authorizations, job_fact_conflicts, job_facts, profile_skills, profiles, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
  });

  describe('loadCandidate', () => {
    it('returns the current extraction of a fresh processed job', async () => {
      const j = await job();
      expect(await repo.loadCandidate(j.id)).toEqual({
        extractionId: j.extractionId,
        kind: 'job',
        post: null,
      });
      expect(await repo.listMatchableJobs()).toContain(j.id);
    });

    it.each([
      ['closed', () => job({ closed: true })],
      [
        'stale (31 days)',
        () => job({ lastSeenAt: new Date(Date.now() - 31 * DAY) }),
      ],
      ['pending', () => job({ processingStatus: 'pending' })],
      ['schema version 2', () => job({ schemaVersion: 2 })],
      ['no LinkedIn source', () => job({ channels: [Channel.ASHBY] })],
      [
        'merged',
        async () => {
          const j = await job();
          const target = await job();
          await db.orm.public.NormalizedJob.where({ id: j.id }).updateAll({
            status: 'merged',
            mergedIntoId: target.id,
          });
          return j;
        },
      ],
    ])('returns null for a %s job', async (_name, make) => {
      const j = await make();
      expect(await repo.loadCandidate(j.id)).toBeNull();
      expect(await repo.listMatchableJobs()).not.toContain(j.id);
      expect(await repo.listStaleJobs(10)).not.toContain(j.id);
    });

    it('returns null for an unknown job', async () => {
      expect(await repo.loadCandidate(randomUUID())).toBeNull();
    });
  });

  describe('listPublishedProfiles', () => {
    it('returns published profiles with skills, and only stale ones on request', async () => {
      const p = await profile();
      const j = await job();
      const all = await repo.listPublishedProfiles();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        id: p.id,
        userId: p.userId,
        position: 'backend_engineer',
        seniorities: ['senior'],
        yearsOfExperience: 6,
        timezoneMin: -60,
        timezoneMax: 180,
        skills: [{ technology: 'python', mastery: 8, importance: 9 }],
        matchVersion: p.matchVersion,
        eligibilityVersion: 0,
      });
      const stale = {
        jobId: j.id,
        factsHash: 'h1',
        extractionId: j.extractionId,
      };
      expect(
        await repo.listPublishedProfiles({ onlyStaleFor: stale }),
      ).toHaveLength(1);
      await repo.upsertMatches([row(p, j)]);
      expect(
        await repo.listPublishedProfiles({ onlyStaleFor: stale }),
      ).toHaveLength(0);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: {
            jobId: j.id,
            factsHash: 'h2',
            extractionId: j.extractionId,
          },
        }),
      ).toHaveLength(1);
    });

    it("loads contract types, languages and the user's eligibility", async () => {
      const p = await profile();
      const other = await profile();
      await db.orm.public.Profile.where({ id: p.id }).updateAll({
        contractTypes: ['full_time', 'contract'],
        languages: [
          { lang: 'en', level: 'fluent' },
          { lang: 'fr', level: 'native' },
        ],
      } as never);
      await db.orm.public.User.where({ id: p.userId }).updateAll({
        residenceCountry: 'MA',
        acceptsSponsorship: true,
      } as never);
      for (const [kind, place] of [
        ['citizenship', 'MA'],
        ['work-permit', 'EU'],
      ])
        await db.orm.public.WorkAuthorization.create({
          userId: p.userId,
          kind,
          place,
        } as never);
      const byId = new Map(
        (await repo.listPublishedProfiles()).map((x) => [x.id, x]),
      );
      expect(byId.get(p.id)).toMatchObject({
        contractTypes: ['full_time', 'contract'],
        languages: [
          { lang: 'en', level: 'fluent' },
          { lang: 'fr', level: 'native' },
        ],
        eligibility: {
          residenceCountry: 'MA',
          acceptsSponsorship: true,
        },
      });
      expect(
        [...(byId.get(p.id)?.eligibility.authorizations ?? [])].sort((a, b) =>
          a.kind.localeCompare(b.kind),
        ),
      ).toEqual([
        { kind: 'citizenship', place: 'MA' },
        { kind: 'work-permit', place: 'EU' },
      ]);
      expect(byId.get(other.id)).toMatchObject({
        contractTypes: ['full_time'],
        languages: [{ lang: 'en', level: 'fluent' }],
        eligibility: {
          authorizations: [],
          residenceCountry: null,
          acceptsSponsorship: null,
        },
      });
    });

    it('skips drafts', async () => {
      const p = await profile();
      await db.orm.public.Profile.where({ id: p.id }).updateAll({
        state: 'draft',
        publishedAt: null,
      } as never);
      expect(await repo.listPublishedProfiles()).toHaveLength(0);
    });
  });

  describe('loadContext', () => {
    it('reads regions, cities, approved countries and tech implications', async () => {
      const ctx = await repo.loadContext();
      expect(ctx.places.countriesOfRegion.size).toBeGreaterThan(0);
      expect(ctx.places.countries.has('FR')).toBe(true);
      expect(ctx.places.countries.has('UK')).toBe(false);
      expect(ctx.implies.has('nestjs')).toBe(true);
    });
  });

  describe('stale jobs', () => {
    it('lists a job with no row, then not, then again on a stale row', async () => {
      const p = await profile();
      const j = await job();
      await facts(j);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await repo.upsertMatches([row(p, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);

      await db.orm.public.JobMatch.where({
        profileId: p.id,
        jobId: j.id,
      }).updateAll({ matcherVersion: 0 });
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
    });

    it('a facts change makes rows stale', async () => {
      const p = await profile();
      const j = await job();
      await facts(j, { factsHash: 'h1' });
      await repo.upsertMatches([row(p, j, { factsHash: 'h1' })]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await facts(j, { factsHash: 'h2' });
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: {
            jobId: j.id,
            factsHash: 'h2',
            extractionId: j.extractionId,
          },
        }),
      ).toHaveLength(1);
      await repo.upsertMatches([row(p, j, { factsHash: 'h2' })]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a new extraction with the same facts makes rows stale (its needsReview may differ)', async () => {
      const p = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j)]);
      const newer = await extraction(j.id);
      await db.orm.public.NormalizedJob.where({ id: j.id }).updateAll({
        currentExtractionId: newer,
      });
      // The facts were built from the old extraction: build them again.
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await facts({ id: j.id, extractionId: newer });
      // Same facts hash, but the rows were decided on the old extraction.
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: { jobId: j.id, factsHash: 'h1', extractionId: newer },
        }),
      ).toHaveLength(1);
      await repo.upsertMatches([row(p, { id: j.id, extractionId: newer })]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: { jobId: j.id, factsHash: 'h1', extractionId: newer },
        }),
      ).toHaveLength(0);
    });

    it.each([
      ['are missing', async () => undefined],
      [
        'come from an older rule set',
        async (j: { id: string; extractionId: string }) =>
          facts(j, { factsVersion: FACTS_VERSION - 1 }),
      ],
      [
        'are older than the job row',
        async (j: { id: string; extractionId: string }) => {
          await facts(j);
          await sql`UPDATE job_facts SET "builtAt" = '-infinity'`;
        },
      ],
    ])(
      'lists a job whose facts %s, even with current rows',
      async (_n, make) => {
        const p = await profile();
        const j = await job();
        await repo.upsertMatches([row(p, j)]);
        await make(j);
        expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      },
    );

    it('lists an open job past its expiry so its facts are built again', async () => {
      const p = await profile();
      const j = await job({ expiresAt: new Date(Date.now() - DAY) });
      await facts(j, { closed: false });
      await repo.upsertMatches([row(p, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
    });

    it('a closed job is not listed again once its facts are built', async () => {
      const p = await profile();
      const j = await job({ expiresAt: new Date(Date.now() - DAY) });
      await repo.upsertMatches([row(p, j, { factsHash: 'open' })]);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await facts(j, { factsHash: 'closed', closed: true });
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await profile();
      expect(await repo.listStaleJobs(10)).toEqual([]);
      expect(await repo.matchesForJob(j.id)).toHaveLength(1);
      expect(await repo.deleteInactive()).toBe(0);
    });

    it('lists an already matched job again for a later profile', async () => {
      const first = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(first, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await profile();
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
    });

    it('a profile edit makes its rows stale', async () => {
      const p = await profile();
      const other = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j), row(other, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await setMatchVersion(p.id, p.matchVersion + 1);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      const stale = await repo.listPublishedProfiles({
        onlyStaleFor: {
          jobId: j.id,
          factsHash: 'h1',
          extractionId: j.extractionId,
        },
      });
      expect(stale.map((x) => x.id)).toEqual([p.id]);
      // Decided again on the edited profile, as the service records it.
      for (const edited of stale)
        await repo.upsertMatches([
          row({ ...p, matchVersion: edited.matchVersion }, j),
        ]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it("an eligibility bump makes the user's rows stale", async () => {
      const p = await profile();
      const other = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j), row(other, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      // The work_authorizations trigger bumps users.eligibilityVersion.
      await db.orm.public.WorkAuthorization.create({
        userId: p.userId,
        kind: 'citizenship',
        place: 'MA',
      } as never);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      const stale = await repo.listPublishedProfiles({
        onlyStaleFor: {
          jobId: j.id,
          factsHash: 'h1',
          extractionId: j.extractionId,
        },
      });
      expect(stale.map((x) => x.id)).toEqual([p.id]);
      expect(stale[0]?.eligibilityVersion).toBe(1);
      await repo.upsertMatches([row(p, j, { eligibilityVersion: 1 })]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a row without a recorded eligibility version is not stale by it', async () => {
      const p = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j)]);
      await sql`UPDATE job_matches SET "eligibilityVersion" = NULL`;
      await sql`UPDATE users SET "eligibilityVersion" = 3`;
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a row with a null profileVersion is stale', async () => {
      const p = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j)]);
      await sql`UPDATE job_matches SET "profileVersion" = NULL`;
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
    });

    it("stores the profile's matchVersion on each decision", async () => {
      const p = await profile();
      await setMatchVersion(p.id, 3);
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row({ ...p, matchVersion: 3 }, j)]);
      expect(await matchRow(p.id, j.id)).toMatchObject({ profileVersion: 3 });
    });

    it('a row on an older profile version is stale', async () => {
      const p = await profile();
      const other = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([row(p, j), row(other, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await setMatchVersion(p.id, p.matchVersion + 1);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      const stale = await repo.listPublishedProfiles({
        onlyStaleFor: {
          jobId: j.id,
          factsHash: 'h1',
          extractionId: j.extractionId,
        },
      });
      expect(stale.map((x) => x.id)).toEqual([p.id]);
    });

    it('an outcome flips when the edit changes it', async () => {
      const p = await profile();
      const j = await job();
      await facts(j);
      await repo.upsertMatches([
        row(p, j, { outcome: 'rejected', stackScore: null }),
      ]);
      const before = await matchRow(p.id, j.id);
      await setMatchVersion(p.id, p.matchVersion + 1);
      const [edited] = await repo.listPublishedProfiles({
        onlyStaleFor: {
          jobId: j.id,
          factsHash: 'h1',
          extractionId: j.extractionId,
        },
      });
      await repo.upsertMatches([
        row({ ...p, matchVersion: edited!.matchVersion }, j),
      ]);
      const after = await matchRow(p.id, j.id);
      expect(after).toMatchObject({
        outcome: 'qualified',
        profileVersion: edited!.matchVersion,
      });
      expect(after!.decidedAt.getTime()).toBeGreaterThan(
        before!.decidedAt.getTime(),
      );
    });

    it('ignores unmatchable jobs and respects the limit', async () => {
      await profile();
      await job({ closed: true });
      const a = await job();
      await job();
      expect(await repo.listStaleJobs(10)).toHaveLength(2);
      expect(await repo.listStaleJobs(1)).toHaveLength(1);
      expect(await repo.listMatchableJobs()).toContain(a.id);
    });
  });

  describe('upsertMatches', () => {
    it('stores and reads back a review with its rule and field', async () => {
      const p = await profile();
      const j = await job();
      await repo.upsertMatches([
        row(p, j, {
          outcome: 'review',
          review: { rule: 'location', field: 'openings' },
        }),
      ]);
      const [stored] = await repo.matchesForJob(j.id);
      expect(stored).toMatchObject({
        outcome: 'review',
        unverified: false,
        review: { rule: 'location', field: 'openings' },
      });
      const raw = await matchRow(p.id, j.id);
      expect(raw).toMatchObject({
        reviewRule: 'location',
        reviewField: 'openings',
      });
      // A later qualified decision clears them.
      await repo.upsertMatches([row(p, j)]);
      expect(await matchRow(p.id, j.id)).toMatchObject({
        outcome: 'qualified',
        reviewRule: null,
        reviewField: null,
      });
    });

    it('refuses a review without its rule and field, and a rule on another outcome', async () => {
      const p = await profile();
      const j = await job();
      await expect(
        repo.upsertMatches([row(p, j, { outcome: 'review', review: null })]),
      ).rejects.toThrow();
      await expect(
        repo.upsertMatches([
          row(p, j, {
            outcome: 'rejected',
            review: { rule: 'stack', field: 'techStack' },
          }),
        ]),
      ).rejects.toThrow();
    });

    it('stores and reads back a decision', async () => {
      const p = await profile();
      const j = await job();
      await repo.upsertMatches([row(p, j, { stackScore: 0.5 })]);
      const [stored] = await repo.matchesForJob(j.id);
      expect(stored).toMatchObject({
        profileId: p.id,
        userId: p.userId,
        jobId: j.id,
        extractionId: j.extractionId,
        factsHash: 'h1',
        outcome: 'qualified',
        unverified: false,
        stackScore: 0.5,
      });
      expect(stored?.checks).toHaveLength(1);
      expect(await matchRow(p.id, j.id)).toMatchObject({
        matcherVersion: MATCHER_VERSION,
        profileVersion: p.matchVersion,
        eligibilityVersion: 0,
      });
      expect(stored).toMatchObject({
        profileVersion: p.matchVersion,
        eligibilityVersion: 0,
      });
    });

    it('reads a null stack score back as null and orders by profile', async () => {
      const p1 = await profile();
      const p2 = await profile();
      const j = await job();
      await repo.upsertMatches([row(p1, j, { stackScore: null }), row(p2, j)]);
      const rows = await repo.matchesForJob(j.id);
      expect(rows.map((r) => r.profileId)).toEqual([p1.id, p2.id].sort());
      expect(rows.find((r) => r.profileId === p1.id)?.stackScore).toBeNull();
    });

    it('keeps decidedAt for the same outcome and moves it on a change', async () => {
      const p = await profile();
      const j = await job();
      await repo.upsertMatches([row(p, j, { outcome: 'rejected' })]);
      const first = (await matchRow(p.id, j.id))!;
      await new Promise((r) => setTimeout(r, 20));
      await repo.upsertMatches([row(p, j, { outcome: 'rejected' })]);
      const second = (await matchRow(p.id, j.id))!;
      expect(second.decidedAt).toEqual(first.decidedAt);
      expect(second.updatedAt.getTime()).toBeGreaterThan(
        first.updatedAt.getTime(),
      );
      await new Promise((r) => setTimeout(r, 20));
      await repo.upsertMatches([row(p, j, { outcome: 'qualified' })]);
      const third = (await matchRow(p.id, j.id))!;
      expect(third.decidedAt.getTime()).toBeGreaterThan(
        first.decidedAt.getTime(),
      );
    });

    it('an unchanged outcome still records the new profileVersion and keeps decidedAt', async () => {
      const p = await profile();
      const j = await job();
      await repo.upsertMatches([row(p, j, { outcome: 'rejected' })]);
      const first = (await matchRow(p.id, j.id))!;
      await new Promise((r) => setTimeout(r, 20));
      const next = p.matchVersion + 1;
      await setMatchVersion(p.id, next);
      await repo.upsertMatches([
        row(p, j, { outcome: 'rejected', profileVersion: next }),
      ]);
      const second = (await matchRow(p.id, j.id))!;
      expect(second.profileVersion).toBe(next);
      expect(second.profileVersion).not.toBe(first.profileVersion);
      expect(second.decidedAt).toEqual(first.decidedAt);
    });

    it('accepts an empty list', async () => {
      expect(await repo.upsertMatches([])).toEqual({ deliveryIds: [] });
    });
  });

  describe('upsertMatches and webhook deliveries', () => {
    /** A profile with a webhook on, and a job first seen after both. */
    async function watched() {
      const p = await profile();
      await db.execute(
        db.raw
          .sql`INSERT INTO webhooks (id, "userId", url, enabled, "enabledSince")
            VALUES (${randomUUID()}::uuid, ${p.userId}::uuid, 'https://hook.example.com/x', true, now() - interval '1 day')`
          .affectedCount()
          .build(),
      );
      const j = await job();
      await db.orm.public.NormalizedJob.where({ id: j.id }).updateAll({
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      });
      return { p, j };
    }
    const deliveries = () => db.orm.public.WebhookDelivery.where({}).all();

    it('a qualified upsert creates a delivery and returns its id', async () => {
      const { p, j } = await watched();
      const { deliveryIds } = await repo.upsertMatches([row(p, j)]);
      const stored = await deliveries();
      expect(stored).toHaveLength(1);
      expect(deliveryIds).toEqual([stored[0]!.id]);
      expect(stored[0]).toMatchObject({
        trigger: 'decision',
        status: 'pending',
        profileId: p.id,
        jobId: j.id,
      });
    });

    it('a rejected upsert creates none', async () => {
      const { p, j } = await watched();
      const out = await repo.upsertMatches([
        row(p, j, { outcome: 'rejected' }),
      ]);
      expect(out).toEqual({ deliveryIds: [] });
      expect(await deliveries()).toHaveLength(0);
    });

    it('re-upserting the same qualified row returns no ids', async () => {
      const { p, j } = await watched();
      expect((await repo.upsertMatches([row(p, j)])).deliveryIds).toHaveLength(
        1,
      );
      expect(await repo.upsertMatches([row(p, j)])).toEqual({
        deliveryIds: [],
      });
      expect(await deliveries()).toHaveLength(1);
    });

    it('rejected to qualified after a sent delivery returns no ids', async () => {
      const { p, j } = await watched();
      await repo.upsertMatches([row(p, j)]);
      await db.execute(
        db.raw.sql`UPDATE webhook_deliveries SET status = 'delivered'`
          .affectedCount()
          .build(),
      );
      await repo.upsertMatches([row(p, j, { outcome: 'rejected' })]);
      expect(await repo.upsertMatches([row(p, j)])).toEqual({
        deliveryIds: [],
      });
      expect(await deliveries()).toHaveLength(1);
    });
  });

  describe('deleteInactive', () => {
    it('removes the rows of a job that is no longer active', async () => {
      const p = await profile();
      const j = await job();
      const keep = await job();
      await repo.upsertMatches([row(p, j), row(p, keep)]);
      expect(await repo.deleteInactive()).toBe(0);
      await db.orm.public.NormalizedJob.where({ id: j.id }).updateAll({
        status: 'merged',
        mergedIntoId: keep.id,
      });
      expect(await repo.deleteInactive()).toBe(1);
      expect(await repo.matchesForJob(j.id)).toEqual([]);
      expect(await repo.matchesForJob(keep.id)).toHaveLength(1);
    });
  });

  describe('post role jobs', () => {
    it('a processed post_role job is matchable; an archived one is not', async () => {
      const role = await roleJob();
      expect(await repo.listMatchableJobs()).toContain(role.id);
      expect(await repo.loadCandidate(role.id)).not.toBeNull();
      const archived = await roleJob({ processingStatus: 'archived' });
      expect(await repo.loadCandidate(archived.id)).toBeNull();
      expect(await repo.listMatchableJobs()).not.toContain(archived.id);
      // The post job itself is never matched: its roles are.
      expect(await repo.loadCandidate(role.postJobId)).toBeNull();
      expect(await repo.listMatchableJobs()).not.toContain(role.postJobId);
    });

    it("loadCandidate reads the parent's verdict confidence, every author, and the role's postedAt", async () => {
      const postedAt = new Date('2026-11-20T10:00:00.000Z');
      const role = await roleJob({ postedAt, verdictConfidence: 'unsure' });
      expect(await repo.loadCandidate(role.id)).toEqual({
        extractionId: role.extractionId,
        kind: 'post_role',
        post: {
          verdictConfidence: 'unsure',
          authors: [
            { key: 'profile:jane-doe', name: 'Jane Doe' },
            { key: 'profile:sam-lee', name: 'Sam Lee' },
            { key: 'company:acme', name: 'Acme' },
          ],
          postedAt,
        },
      });
    });

    it('a null verdict confidence counts as unsure, and a role may have no date', async () => {
      const role = await roleJob({ verdictConfidence: null, postedAt: null });
      expect((await repo.loadCandidate(role.id))?.post).toMatchObject({
        verdictConfidence: 'unsure',
        postedAt: null,
      });
    });

    it('a listing candidate has kind job and no post', async () => {
      const j = await job();
      expect(await repo.loadCandidate(j.id)).toMatchObject({
        kind: 'job',
        post: null,
      });
    });

    it('listStaleJobs ignores profiles with post search off for role jobs', async () => {
      const on = await profile({ postSearch: true });
      await profile();
      const role = await roleJob();
      await facts(role);
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
      const stale = {
        jobId: role.id,
        factsHash: 'h1',
        extractionId: role.extractionId,
      };
      expect(
        (await repo.listPublishedProfiles({ onlyStaleFor: stale })).map(
          (p) => p.id,
        ),
      ).toEqual([on.id]);
      await repo.upsertMatches([row(on, role)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      expect(await repo.listPublishedProfiles({ onlyStaleFor: stale })).toEqual(
        [],
      );
    });

    it('a listing is still decided for a profile with post search off', async () => {
      const off = await profile();
      const j = await job();
      await facts(j);
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await repo.upsertMatches([row(off, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a role row decided before its original turned 30 is stale after', async () => {
      const p = await profile({ postSearch: true });
      const role = await roleJob({ postedAt: new Date(Date.now() - 31 * DAY) });
      await facts(role);
      await repo.upsertMatches([row(p, role)]);
      // Decided just now, after the 30-day mark: current.
      expect(await repo.listStaleJobs(10)).toEqual([]);
      // Decided two days ago, when the original was 29 days old: stale.
      await setMatchUpdatedAt(role.id, new Date(Date.now() - 2 * DAY));
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
      const stale = {
        jobId: role.id,
        factsHash: 'h1',
        extractionId: role.extractionId,
      };
      expect(
        (await repo.listPublishedProfiles({ onlyStaleFor: stale })).map(
          (x) => x.id,
        ),
      ).toEqual([p.id]);
      // Decided again: current again.
      await repo.upsertMatches([row(p, role)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a role row written just after the 30-day mark, within the margin, is stale; after the margin it is not', async () => {
      const p = await profile({ postSearch: true });
      const postedAt = new Date(Date.now() - 31 * DAY);
      const role = await roleJob({ postedAt });
      await facts(role);
      await repo.upsertMatches([row(p, role)]);
      const mark = postedAt.getTime() + POST_MAX_AGE_DAYS * DAY;
      const margin = POST_AGE_STALE_MARGIN_MINUTES * 60_000;
      // Decided on the engine clock just before the mark, written two minutes after it.
      await setMatchUpdatedAt(role.id, new Date(mark + 2 * 60_000));
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
      // Written after mark + margin: current, so the sweep does not loop.
      await setMatchUpdatedAt(role.id, new Date(mark + margin + 60_000));
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a role whose original turned 30 a moment ago is stale at once, not only after the margin', async () => {
      const p = await profile({ postSearch: true });
      const postedAt = new Date(
        Date.now() - POST_MAX_AGE_DAYS * DAY - 2 * 60_000,
      );
      const role = await roleJob({ postedAt });
      await facts(role);
      await repo.upsertMatches([row(p, role)]);
      // Decided on day 29; the mark passed two minutes ago, inside the margin.
      await setMatchUpdatedAt(role.id, new Date(postedAt.getTime() + 29 * DAY));
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
    });

    it('a role qualified on day 29 is stale after the mark, re-decided rejected, then current', async () => {
      const p = await profile({ postSearch: true });
      const postedAt = new Date(
        Date.now() - POST_MAX_AGE_DAYS * DAY - 3_600_000,
      );
      const role = await roleJob({ postedAt });
      await facts(role);
      const decideAt = (ms: number) => {
        const check = checkPostAge(
          rolePost({ ageDays: (ms - postedAt.getTime()) / DAY }),
        );
        return row(p, role, {
          outcome: check.outcome === 'fail' ? 'rejected' : 'qualified',
          checks: [check],
        });
      };
      const day29 = postedAt.getTime() + 29 * DAY;
      await repo.upsertMatches([decideAt(day29)]);
      await setMatchUpdatedAt(role.id, new Date(day29));
      expect((await matchRow(p.id, role.id))?.outcome).toBe('qualified');
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
      // The sweep re-decides it now, just after day 30.
      await repo.upsertMatches([decideAt(Date.now())]);
      expect((await matchRow(p.id, role.id))?.outcome).toBe('rejected');
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('a role with no postedAt is current once decided (the sweep does not loop on it)', async () => {
      const p = await profile({ postSearch: true });
      const role = await roleJob({ postedAt: null });
      await facts(role);
      expect(await repo.listStaleJobs(10)).toEqual([role.id]);
      await repo.upsertMatches([row(p, role)]);
      await setMatchUpdatedAt(role.id, new Date(Date.now() - 40 * DAY));
      expect(await repo.listStaleJobs(10)).toEqual([]);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: {
            jobId: role.id,
            factsHash: 'h1',
            extractionId: role.extractionId,
          },
        }),
      ).toEqual([]);
    });

    it('a young role row and a listing row are not stale by age', async () => {
      const p = await profile({ postSearch: true });
      const role = await roleJob({ postedAt: new Date(Date.now() - 10 * DAY) });
      const j = await job();
      await facts(role);
      await facts(j);
      await repo.upsertMatches([row(p, role), row(p, j)]);
      await setMatchUpdatedAt(role.id, new Date(Date.now() - 5 * DAY));
      await setMatchUpdatedAt(j.id, new Date(Date.now() - 40 * DAY));
      expect(await repo.listStaleJobs(10)).toEqual([]);
    });

    it('deleteInactive deletes rows of archived roles and of profiles with post search off', async () => {
      const on = await profile({ postSearch: true });
      const off = await profile({ postSearch: true });
      const kept = await roleJob();
      const archived = await roleJob();
      const listing = await job();
      await repo.upsertMatches([
        row(on, kept),
        row(off, kept),
        row(on, archived),
        row(off, listing),
      ]);
      expect(await repo.deleteInactive()).toBe(0);
      await db.orm.public.NormalizedJob.where({ id: archived.id }).updateAll({
        processingStatus: 'archived',
      });
      await db.execute(
        db.raw
          .sql`UPDATE profiles SET "postSearch" = false WHERE id = ${off.id}::uuid`
          .affectedCount()
          .build(),
      );
      expect(await repo.deleteInactive()).toBe(2);
      expect(
        (await repo.matchesForJob(kept.id)).map((m) => m.profileId),
      ).toEqual([on.id]);
      expect(await repo.matchesForJob(archived.id)).toEqual([]);
      // A listing row stays: post search does not gate listings.
      expect(await repo.matchesForJob(listing.id)).toHaveLength(1);
    });

    it("listPublishedProfiles loads each user's blocked authors and post search", async () => {
      const a = await profile({ postSearch: true });
      const b = await profile();
      await block(a.userId, 'profile:jane-doe', 'Jane Doe');
      // Keys compare lowercased: Prepare writes them lowercased.
      await block(a.userId, 'company:ACME');
      const byId = new Map(
        (await repo.listPublishedProfiles()).map((p) => [p.id, p]),
      );
      expect(byId.get(a.id)?.blockedAuthors.sort()).toEqual([
        'company:acme',
        'profile:jane-doe',
      ]);
      expect(byId.get(a.id)?.postSearch).toBe(true);
      expect(byId.get(b.id)).toMatchObject({
        blockedAuthors: [],
        postSearch: false,
      });
    });
  });
});

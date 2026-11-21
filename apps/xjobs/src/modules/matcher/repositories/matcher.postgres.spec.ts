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
import { MATCHER_VERSION } from '../config/matcher.config';
import { PrismaRatesRepository } from 'src/modules/rates/rates.repository';
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

  async function profile(): Promise<{
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
    await sql`TRUNCATE webhook_deliveries, webhooks, job_matches, work_authorizations, job_fact_conflicts, job_facts, profile_skills, profiles, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
  });

  describe('loadCandidate', () => {
    it('returns the current extraction of a fresh processed job', async () => {
      const j = await job();
      expect(await repo.loadCandidate(j.id)).toEqual({
        extractionId: j.extractionId,
        needsReview: false,
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
});

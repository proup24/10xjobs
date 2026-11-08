import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  createDatabaseClient,
  type DatabaseClient,
  processorListsSeed,
} from '@xjobs/database';
import type { SeedEnvironmentVariables } from 'src/config';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { MATCHER_VERSION } from '../config/matcher.config';
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

  async function extraction(jobId: string, schemaVersion = 2): Promise<string> {
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
  }

  /** A processed active job with a current v2 extraction, last seen now. */
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
    });
    for (const channel of spec.channels ?? [Channel.LINKEDIN_JOB_BOARD])
      await source(row.id, channel);
    const extractionId = await extraction(row.id, spec.schemaVersion);
    await db.orm.public.NormalizedJob.where({ id: row.id }).updateAll({
      currentExtractionId: extractionId,
    });
    return { id: row.id, extractionId };
  }

  async function profile(): Promise<{ id: string; userId: string }> {
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
      locations: { remote: [{ kind: 'worldwide' }], hybrid: [], onsite: [] },
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
    return { id: row.id, userId };
  }

  const decision = (
    over: Partial<StoredMatch> = {},
  ): Omit<StoredMatch, 'profileId' | 'userId' | 'jobId' | 'extractionId'> => ({
    outcome: 'qualified',
    unverified: false,
    stackScore: 0.75,
    checks: [
      {
        rule: 'position',
        outcome: 'pass',
        jobValue: 'backend',
        profileValue: 'backend_engineer',
        reason: 'same',
      },
    ],
    ...over,
  });

  const row = (
    p: { id: string; userId: string },
    j: { id: string; extractionId: string },
    over: Partial<StoredMatch> = {},
  ): StoredMatch => ({
    profileId: p.id,
    userId: p.userId,
    jobId: j.id,
    extractionId: j.extractionId,
    ...decision(),
    ...over,
  });

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
    repo = new PrismaMatcherRepository({ db } as DatabaseService);
    await sql`TRUNCATE processing_attempts, job_extractions, cities, region_countries, tech_tags, regions, countries, role_kinds, seniorities, arrangements, contract_types, engagements, junk_flags CASCADE`;
    await db.transaction((tx) =>
      processorListsSeed.run(tx, {} as SeedEnvironmentVariables),
    );
    // Profiles name their languages from this list; the test database starts empty.
    await sql`INSERT INTO iso_languages (code, label) VALUES ('en', 'English') ON CONFLICT (code) DO NOTHING`;
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE job_matches, profile_skills, profiles, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
  });

  describe('loadMatchableJob', () => {
    it('returns a fresh processed v2 job with its document', async () => {
      const j = await job();
      const loaded = await repo.loadMatchableJob(j.id);
      expect(loaded).toMatchObject({
        jobId: j.id,
        extractionId: j.extractionId,
        needsReview: false,
      });
      expect(loaded?.document.position.value?.roleKind).toBe('backend');
    });

    it.each([
      ['closed', () => job({ closed: true })],
      [
        'stale (31 days)',
        () => job({ lastSeenAt: new Date(Date.now() - 31 * DAY) }),
      ],
      ['pending', () => job({ processingStatus: 'pending' })],
      ['schema version 1', () => job({ schemaVersion: 1 })],
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
      expect(await repo.loadMatchableJob(j.id)).toBeNull();
      expect(await repo.listMatchableJobs()).not.toContain(j.id);
    });

    it('warns with the job id when a matchable job has no v2 document', async () => {
      const j = await job();
      await db.orm.public.JobExtraction.where({ id: j.extractionId }).updateAll(
        { data: { broken: true } as never },
      );
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        expect(await repo.loadMatchableJob(j.id)).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(j.id));
      } finally {
        warn.mockRestore();
      }
    });

    it('returns null for an unknown job', async () => {
      expect(await repo.loadMatchableJob(randomUUID())).toBeNull();
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
      });
      const stale = { jobId: j.id, extractionId: j.extractionId };
      expect(
        await repo.listPublishedProfiles({ onlyStaleFor: stale }),
      ).toHaveLength(1);
      await repo.upsertMatches([row(p, j)]);
      expect(
        await repo.listPublishedProfiles({ onlyStaleFor: stale }),
      ).toHaveLength(0);
      expect(
        await repo.listPublishedProfiles({
          onlyStaleFor: { jobId: j.id, extractionId: randomUUID() },
        }),
      ).toHaveLength(1);
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
    it('reads regions, cities and approved tech implications', async () => {
      const ctx = await repo.loadContext();
      expect(ctx.places.countriesOfRegion.size).toBeGreaterThan(0);
      expect(ctx.implies.has('nestjs')).toBe(true);
    });
  });

  describe('stale jobs', () => {
    it('lists a job with no row, then not, then again on change', async () => {
      const p = await profile();
      const j = await job();
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await repo.upsertMatches([row(p, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);

      const newer = await extraction(j.id);
      await db.orm.public.NormalizedJob.where({ id: j.id }).updateAll({
        currentExtractionId: newer,
      });
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
      await repo.upsertMatches([row(p, { id: j.id, extractionId: newer })]);
      expect(await repo.listStaleJobs(10)).toEqual([]);

      await db.orm.public.JobMatch.where({
        profileId: p.id,
        jobId: j.id,
      }).updateAll({ matcherVersion: 0 });
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
    });

    it('lists an already matched job again for a later profile', async () => {
      const first = await profile();
      const j = await job();
      await repo.upsertMatches([row(first, j)]);
      expect(await repo.listStaleJobs(10)).toEqual([]);
      await profile();
      expect(await repo.listStaleJobs(10)).toEqual([j.id]);
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
        outcome: 'qualified',
        unverified: false,
        stackScore: 0.5,
      });
      expect(stored?.checks).toHaveLength(1);
      expect((await matchRow(p.id, j.id))?.matcherVersion).toBe(
        MATCHER_VERSION,
      );
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
      await repo.upsertMatches([]);
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

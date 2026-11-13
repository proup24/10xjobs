import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from '../schema';
import { fixtureDocument } from '../schema/fixture.testing';
import { PrismaMatcherRepository } from 'src/modules/matcher/repositories/matcher.repository';
import { PrismaRatesRepository } from 'src/modules/rates/rates.repository';
import { archiveActorJobs } from './archive.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Specs on
 * that database never run in parallel (vitest.config.mts).
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');
const CHEAP = 'cheap_scraper/linkedin-job-scraper';
const HARVEST = 'harvestapi/linkedin-job-search';

describe.skipIf(!url)('archiveActorJobs in PostgreSQL', () => {
  let db: DatabaseClient;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  /** One raw item linked to `jobId`, sighted once in a batch of each actor. */
  async function source(jobId: string, actors: string[]): Promise<void> {
    const channel = Channel.LINKEDIN_JOB_BOARD;
    const item = await db.orm.public.RawItem.create({
      channel,
      sourceKey: randomUUID(),
      kind: 'job',
      firstSeenAt: t0,
      lastSeenAt: t0,
      latestVersionId: null,
    });
    let versionId = '';
    for (const actor of actors) {
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
        actor,
        apifyRunId: null,
        status: 'ingested',
      });
      if (!versionId) {
        const version = await db.orm.public.RawItemVersion.create({
          rawItemId: item.id,
          contentHash: randomUUID(),
          payload: {},
          firstBatchId: batch.id,
          firstSeenAt: t0,
          lastSeenAt: t0,
        });
        versionId = version.id;
      }
      await db.orm.public.RawItemSighting.create({
        batchId: batch.id,
        rawItemId: item.id,
        versionId,
        queryId: null,
        attribution: 'none',
        rank: null,
        observedAt: t0,
      } as never);
    }
    await db.orm.public.RawItem.where({ id: item.id }).updateAll({
      latestVersionId: versionId,
    });
    const normalized = await db.orm.public.NormalizedVersion.create({
      rawVersionId: versionId,
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

  async function extraction(jobId: string): Promise<string> {
    const row = await db.orm.public.JobExtraction.create({
      jobId,
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
    return row.id;
  }

  /** An active job; processed ones get a current extraction. */
  async function job(
    actors: string[],
    processingStatus: 'pending' | 'processed',
    processingError: string | null = null,
  ): Promise<{ id: string; extractionId: string | null }> {
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
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: new Date(),
      processingStatus,
      processingReason: processingStatus === 'pending' ? 'new' : null,
      processingRequestedAt: t0,
      processingError,
      normalizerVersion: 1,
    } as never);
    await source(row.id, actors);
    if (processingStatus === 'pending')
      return { id: row.id, extractionId: null };
    const extractionId = await extraction(row.id);
    await db.orm.public.NormalizedJob.where({ id: row.id }).updateAll({
      currentExtractionId: extractionId,
    });
    return { id: row.id, extractionId };
  }

  /** A published profile's match on the job. */
  async function match(j: { id: string; extractionId: string | null }) {
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
    await db.orm.public.JobMatch.create({
      userId,
      profileId: profile.id,
      jobId: j.id,
      extractionId: j.extractionId!,
      factsHash: 'h1',
      matcherVersion: 1,
      outcome: 'qualified',
      unverified: false,
      reviewRule: null,
      reviewField: null,
      stackScore: '0.5',
      checks: [],
      decidedAt: new Date(),
      profileUpdatedAt: profile.updatedAt,
      eligibilityVersion: 0,
    } as never);
  }

  async function row(id: string) {
    const r = await db.orm.public.NormalizedJob.where({ id }).first();
    if (!r) throw new Error(`no job ${id}`);
    return r;
  }

  async function matchCount(): Promise<number> {
    return (await db.orm.public.JobMatch.all()).length;
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
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE job_matches, work_authorizations, job_fact_conflicts, job_facts, profile_skills, profiles, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
  });

  it('archives jobs whose every source came only from the actor', async () => {
    const pending = await job([CHEAP], 'pending', 'timeout');
    const processed = await job([CHEAP], 'processed');
    const mixed = await job([CHEAP, HARVEST], 'pending');
    const result = await archiveActorJobs(db, CHEAP, { dryRun: false });
    expect(result).toEqual({
      jobs: 2,
      byStatus: { pending: 1, processed: 1 },
      matchesDeleted: 0,
    });
    const a = await row(pending.id);
    expect(a.processingStatus).toBe('archived');
    expect(a.processingError).toBeNull();
    const b = await row(processed.id);
    expect(b.processingStatus).toBe('archived');
    expect(b.currentExtractionId).toBe(processed.extractionId);
    expect((await row(mixed.id)).processingStatus).toBe('pending');
  });

  it("deletes the archived jobs' job_matches rows", async () => {
    const processed = await job([CHEAP], 'processed');
    const kept = await job([CHEAP, HARVEST], 'processed');
    await match(processed);
    await match(kept);
    const result = await archiveActorJobs(db, CHEAP, { dryRun: false });
    expect(result.matchesDeleted).toBe(1);
    const left = await db.orm.public.JobMatch.all();
    expect(left.map((m) => m.jobId)).toEqual([kept.id]);
  });

  it('changes nothing on dry run', async () => {
    const processed = await job([CHEAP], 'processed');
    await job([CHEAP], 'pending');
    await match(processed);
    const result = await archiveActorJobs(db, CHEAP, { dryRun: true });
    expect(result).toEqual({
      jobs: 2,
      byStatus: { pending: 1, processed: 1 },
      matchesDeleted: 1,
    });
    expect((await row(processed.id)).processingStatus).toBe('processed');
    expect(await matchCount()).toBe(1);
  });

  it('is idempotent', async () => {
    await job([CHEAP], 'pending');
    const processed = await job([CHEAP], 'processed');
    await match(processed);
    await archiveActorJobs(db, CHEAP, { dryRun: false });
    const again = await archiveActorJobs(db, CHEAP, { dryRun: false });
    expect(again).toEqual({ jobs: 0, byStatus: {}, matchesDeleted: 0 });
  });

  it('the matcher never selects an archived job', async () => {
    const processed = await job([CHEAP], 'processed');
    const kept = await job([CHEAP, HARVEST], 'processed');
    const matcher = new PrismaMatcherRepository(
      { db } as DatabaseService,
      new PrismaRatesRepository({ db } as DatabaseService),
    );
    expect(await matcher.listMatchableJobs()).toContain(processed.id);
    await archiveActorJobs(db, CHEAP, { dryRun: false });
    const ids = await matcher.listMatchableJobs();
    expect(ids).not.toContain(processed.id);
    expect(ids).toContain(kept.id);
  });
});

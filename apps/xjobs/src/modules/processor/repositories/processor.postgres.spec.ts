import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { DatabaseService } from 'src/database';
import {
  createDatabaseClient,
  type DatabaseClient,
  processorListsSeed,
} from '@xjobs/database';
import type { TypedColumns } from '../rules/typed-columns';
import { fixtureDocument } from '../schema/fixture.testing';
import {
  type NewAttempt,
  type NewExtraction,
  PrismaProcessorRepository,
  type ReuseKey,
} from './processor.repository';
import { PrismaPlaceVocabularyRepository } from 'src/modules/facts/places/place-vocabulary.repository';
import { PrismaVocabRepository } from './vocab.repository';
import { PrismaPrefilterRepository } from 'src/modules/prefilter/repositories/prefilter.repository';
import { skipShareLine, skipShareSql } from 'src/scripts/skip-share';
import { PREFILTER_VERSION } from 'src/modules/prefilter/config/prefilter.config';
import type { SeedEnvironmentVariables } from 'src/config';
import { loadOutcomes } from 'src/scripts/actor-compare/queries';
import { recentPlaceRows } from 'src/scripts/places-recheck/rows';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Every
 * test on that database lives in this file, so they never run in parallel.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');
const minutes = (n: number) => n * 60_000;

const noColumns: TypedColumns = {
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
};

const key = (inputHash: string = randomUUID()): ReuseKey => ({
  inputHash,
  docType: 'listing',
  schemaVersion: 1,
  promptHash: 'prompt-hash',
  extractionModel: 'anthropic/claude-opus-5.5',
});

const attempt = (over: Partial<NewAttempt> = {}): NewAttempt => ({
  jobId: null,
  extractionId: null,
  eval: false,
  step: 'extraction',
  outcome: 'ok',
  error: null,
  quoteFailures: 0,
  docType: 'listing',
  model: 'anthropic/claude-opus-5.5',
  providerRequestId: null,
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  costUsd: 0.01,
  latencyMs: 1000,
  ...over,
});

describe.skipIf(!url)('processor repositories in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaProcessorRepository;
  let vocab: PrismaVocabRepository;
  let prefilter: PrismaPrefilterRepository;

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  /** A raw item of `channel` with one version, its normalized version and its link to `jobId`. */
  async function source(
    jobId: string,
    channel: Channel,
    authorKey: string | null = null,
  ): Promise<void> {
    const run = await db.orm.public.SearchSegmentRun.create({
      channel,
      segmentKey: 'k',
      segmentHash: randomUUID(),
      queryIds: [],
      windowStart: t0,
      windowEnd: new Date(t0.getTime() + minutes(60)),
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
      record: authorKey ? { post: { author: { key: authorKey } } } : {},
      jobKey: randomUUID(),
    });
    await db.orm.public.NormalizedJobSource.create({
      jobId,
      rawItemId: item.id,
      normalizedVersionId: normalized.id,
      linkedAt: t0,
    });
  }

  interface JobSpec {
    channels?: Channel[];
    kind?: 'job' | 'post';
    processingStatus?: string | null;
    requestedAt?: Date | null;
    closed?: boolean;
    descriptionText?: string | null;
    reason?: 'new' | 'reopened' | 'joined';
    status?: 'active' | 'merged';
    mergedIntoId?: string;
    firstSeenAt?: Date;
    /** One LinkedIn posts source per author key (instead of `channels`). */
    authors?: string[];
    postSources?: unknown;
    workplaceType?: 'remote' | 'hybrid' | 'onsite' | null;
    countryCode?: string | null;
    expiresAt?: Date | null;
  }

  /** A normalized job with one source per channel (LinkedIn job board by default). */
  async function job(spec: JobSpec = {}): Promise<string> {
    const status =
      spec.processingStatus === undefined ? 'pending' : spec.processingStatus;
    const row = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: spec.kind ?? 'job',
      status: spec.status ?? 'active',
      mergedIntoId: spec.mergedIntoId ?? null,
      title: 'Backend Engineer',
      companyName: 'Acme',
      location: 'Berlin, Germany',
      contractType: 'Full-time',
      experienceLevel: 'Mid-Senior level',
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      descriptionText:
        spec.descriptionText === undefined
          ? 'We build things.'
          : spec.descriptionText,
      postingUrl: `https://example.com/${randomUUID()}`,
      closed: spec.closed ?? false,
      workplaceType: spec.workplaceType ?? null,
      countryCode: spec.countryCode ?? null,
      expiresAt: spec.expiresAt ?? null,
      fieldSources: {},
      postSources: (spec.postSources ?? null) as never,
      firstSeenAt: spec.firstSeenAt ?? t0,
      lastSeenAt: spec.firstSeenAt ?? t0,
      processingStatus: status,
      processingReason: status === 'pending' ? (spec.reason ?? 'new') : null,
      processingRequestedAt:
        spec.requestedAt === undefined
          ? status === null
            ? null
            : t0
          : spec.requestedAt,
      normalizerVersion: 1,
    });
    if (spec.authors)
      for (const author of spec.authors)
        await source(row.id, Channel.LINKEDIN_POSTS, author);
    else
      for (const channel of spec.channels ?? [Channel.LINKEDIN_JOB_BOARD])
        await source(row.id, channel);
    return row.id;
  }

  async function jobRow(id: string) {
    const row = await db.orm.public.NormalizedJob.where({ id }).first();
    if (!row) throw new Error(`no job ${id}`);
    return row;
  }

  function extraction(jobId: string, reuse = key()): NewExtraction {
    return {
      ...reuse,
      ...noColumns,
      jobId,
      data: fixtureDocument(),
      needsReview: false,
      costUsd: 0.02,
      verdict: null,
      verdictReason: null,
      verdictConfidence: null,
    };
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
    const database = { db } as DatabaseService;
    repo = new PrismaProcessorRepository(database);
    vocab = new PrismaVocabRepository(database);
    prefilter = new PrismaPrefilterRepository(database);
    await sql`TRUNCATE processing_attempts, job_extractions, cities, region_countries, tech_tags, regions, countries, role_kinds, seniorities, arrangements, contract_types, engagements, junk_flags CASCADE`;
    // About two thousand rows, one statement each: longer than the default hook timeout.
    await db.transaction((tx) =>
      processorListsSeed.run(tx, {} as SeedEnvironmentVariables),
    );
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await sql`TRUNCATE silenced_authors, processing_attempts, job_extractions, cities, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
    // The seeded rows stay; only what a test proposed or counted is undone.
    await sql`DELETE FROM tech_tags WHERE status = 'proposed'`;
    await sql`DELETE FROM role_kinds WHERE status = 'proposed'`;
    await sql`DELETE FROM seniorities WHERE status = 'proposed'`;
    await sql`DELETE FROM arrangements WHERE status = 'proposed'`;
    await sql`DELETE FROM contract_types WHERE status = 'proposed'`;
    await sql`DELETE FROM engagements WHERE status = 'proposed'`;
    await sql`DELETE FROM junk_flags WHERE status = 'proposed'`;
  });

  describe('listPendingInScope', () => {
    it('returns only pending LinkedIn job board jobs that are active jobs', async () => {
      const inScope = await job();
      // A LinkedIn job merged with its Ashby posting is still in scope.
      const merged = await job({
        channels: [Channel.ASHBY, Channel.LINKEDIN_JOB_BOARD],
      });
      await job({ channels: [Channel.ASHBY] });
      await job({ kind: 'post' });
      await job({ processingStatus: 'processed' });
      const gone = await job();
      const target = await job({ requestedAt: null, processingStatus: null });
      await db.orm.public.NormalizedJob.where({ id: gone }).updateAll({
        status: 'merged',
        mergedIntoId: target,
      });

      const ids = await repo.listPendingInScope(10);
      expect(new Set(ids)).toEqual(new Set([inScope, merged]));
    });

    it('lists a job whose only source is on the trial channel', async () => {
      const id = await job({ channels: [Channel.LINKEDIN_JOB_BOARD_CHEAP] });
      expect(await repo.listPendingInScope(10)).toContain(id);
    });

    it('orders by processingRequestedAt and respects the limit', async () => {
      const later = await job({
        requestedAt: new Date(t0.getTime() + minutes(5)),
      });
      const earlier = await job({ requestedAt: t0 });
      expect(await repo.listPendingInScope(10)).toEqual([earlier, later]);
      expect(await repo.listPendingInScope(1)).toEqual([earlier]);
    });
  });

  describe('claim', () => {
    it('moves a pending job to processing and counts the attempt', async () => {
      const id = await job();
      const claim = await repo.claim(id);
      expect(claim).toEqual({
        jobId: id,
        requestedAt: t0,
        attempts: 1,
        reason: 'new',
      });
      const row = await jobRow(id);
      expect(row.processingStatus).toBe('processing');
      expect(row.processingAttempts).toBe(1);
      expect(row.processingStartedAt).toBeInstanceOf(Date);
    });

    it('returns the processing reason', async () => {
      const id = await job({ reason: 'joined' });
      expect((await repo.claim(id))?.reason).toBe('joined');
    });

    it('stamps processingRequestedAt when a pending row has none', async () => {
      const id = await job({ requestedAt: null });
      const before = Date.now();
      const claim = (await repo.claim(id))!;
      expect(claim.requestedAt).toBeInstanceOf(Date);
      // The database clock may differ a little from this one.
      expect(Math.abs(claim.requestedAt.getTime() - before)).toBeLessThan(
        minutes(1),
      );
      expect((await jobRow(id)).processingRequestedAt).toEqual(
        claim.requestedAt,
      );
    });

    it('lets exactly one of two concurrent claims win', async () => {
      const id = await job();
      const results = await Promise.all([repo.claim(id), repo.claim(id)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await jobRow(id)).processingAttempts).toBe(1);
    });

    it('refuses a job merged after listing', async () => {
      const id = await job();
      const target = await job({ processingStatus: null });
      expect(await repo.listPendingInScope(10)).toContain(id);
      await db.orm.public.NormalizedJob.where({ id }).updateAll({
        status: 'merged',
        mergedIntoId: target,
      });
      expect(await repo.claim(id)).toBeNull();
      expect((await jobRow(id)).processingStatus).toBe('pending');
    });

    it('claims a job whose only source is on the trial channel', async () => {
      const id = await job({ channels: [Channel.LINKEDIN_JOB_BOARD_CHEAP] });
      expect(await repo.claim(id)).not.toBeNull();
    });

    it('refuses out-of-scope and non-pending jobs', async () => {
      const ashby = await job({ channels: [Channel.ASHBY] });
      const post = await job({ kind: 'post' });
      const processed = await job({ processingStatus: 'processed' });
      expect(await repo.claim(ashby)).toBeNull();
      expect(await repo.claim(post)).toBeNull();
      expect(await repo.claim(processed)).toBeNull();
      expect(await repo.claim(randomUUID())).toBeNull();
    });

    it('claims a closed job (the service marks it processed)', async () => {
      const id = await job({ closed: true });
      expect(await repo.claim(id)).not.toBeNull();
    });
  });

  describe('loadJob', () => {
    it('returns the title, description and kind of a listing job', async () => {
      const id = await job({ descriptionText: null });
      expect(await repo.loadJob(id)).toEqual({
        id,
        closed: false,
        title: 'Backend Engineer',
        descriptionText: null,
        kind: 'job',
        postSources: null,
      });
      expect(await repo.loadJob(randomUUID())).toBeNull();
    });

    it("returns a post job's kind and its post sources", async () => {
      const sources = [{ postUrl: 'https://www.linkedin.com/posts/1' }];
      const id = await job({ kind: 'post', postSources: { sources } });
      expect(await repo.loadJob(id)).toMatchObject({
        id,
        kind: 'post',
        postSources: sources,
      });
    });
  });

  describe('finish', () => {
    it('marks a claimed job processed with its extraction', async () => {
      const id = await job();
      const claim = (await repo.claim(id))!;
      const extractionId = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(claim, { status: 'processed', extractionId }),
      ).toBe('finished');
      const row = await jobRow(id);
      expect(row.processingStatus).toBe('processed');
      expect(row.currentExtractionId).toBe(extractionId);
      expect(row.processedAt).toBeInstanceOf(Date);
      expect(row.processingStartedAt).toBeNull();
    });

    it('is superseded by a reopen, but still points the job at the extraction', async () => {
      const id = await job();
      const claim = (await repo.claim(id))!;
      const reopenedAt = new Date(t0.getTime() + minutes(1));
      await db.orm.public.NormalizedJob.where({ id }).updateAll({
        processingStatus: 'pending',
        processingReason: 'reopened',
        processingRequestedAt: reopenedAt,
        processingAttempts: 0,
      });
      const extractionId = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(claim, { status: 'processed', extractionId }),
      ).toBe('superseded');
      const row = await jobRow(id);
      expect(row.processingStatus).toBe('pending');
      expect(row.processingRequestedAt).toEqual(reopenedAt);
      expect(row.processedAt).toBeNull();
      expect(row.currentExtractionId).toBe(extractionId);
    });

    it('records the error for a retry or a failure', async () => {
      const retry = await job();
      const retryClaim = (await repo.claim(retry))!;
      expect(
        await repo.finish(retryClaim, { status: 'pending', error: '429' }),
      ).toBe('finished');
      expect(await jobRow(retry)).toMatchObject({
        processingStatus: 'pending',
        processingError: '429',
        processingAttempts: 1,
        processingStartedAt: null,
      });

      const failed = await job();
      const failedClaim = (await repo.claim(failed))!;
      expect(
        await repo.finish(failedClaim, { status: 'failed', error: 'bad' }),
      ).toBe('finished');
      expect(await jobRow(failed)).toMatchObject({
        processingStatus: 'failed',
        processingError: 'bad',
      });
    });

    it('gives the attempt back when the provider was unavailable', async () => {
      const id = await job();
      await repo.claim(id);
      await repo.releaseStale(new Date(Date.now() + minutes(1)));
      const claim = (await repo.claim(id))!;
      expect(claim.attempts).toBe(2);
      expect(
        await repo.finish(claim, {
          status: 'pending',
          error: '401',
          refundAttempt: true,
        }),
      ).toBe('finished');
      expect(await jobRow(id)).toMatchObject({
        processingStatus: 'pending',
        processingError: '401',
        processingAttempts: 1,
        processingStartedAt: null,
      });
    });

    it('does not move the extraction of a job a newer run already finished', async () => {
      const id = await job();
      const first = (await repo.claim(id))!;
      await repo.releaseStale(new Date(Date.now() + minutes(1)));
      const second = (await repo.claim(id))!;
      const newer = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(second, { status: 'processed', extractionId: newer }),
      ).toBe('finished');
      const older = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(first, { status: 'processed', extractionId: older }),
      ).toBe('superseded');
      expect(await jobRow(id)).toMatchObject({
        processingStatus: 'processed',
        currentExtractionId: newer,
      });
    });

    it('does not let a stale run finish a newer claim', async () => {
      const id = await job();
      const first = (await repo.claim(id))!;
      await repo.releaseStale(new Date(Date.now() + minutes(1)));
      const second = (await repo.claim(id))!;
      expect(second.attempts).toBe(2);
      expect(await repo.finish(first, { status: 'failed', error: 'x' })).toBe(
        'superseded',
      );
      expect((await jobRow(id)).processingStatus).toBe('processing');
      expect(
        await repo.finish(second, { status: 'processed', extractionId: null }),
      ).toBe('finished');
    });
  });

  describe('releaseStale', () => {
    it('returns claims older than the cutoff to pending', async () => {
      const stale = await job();
      const fresh = await job();
      await repo.claim(stale);
      await repo.claim(fresh);
      const now = Date.now();
      await db.orm.public.NormalizedJob.where({ id: stale }).updateAll({
        processingStartedAt: new Date(now - minutes(20)),
      });

      expect(await repo.releaseStale(new Date(now - minutes(15)))).toBe(1);
      expect(await jobRow(stale)).toMatchObject({
        processingStatus: 'pending',
        processingStartedAt: null,
      });
      expect((await jobRow(fresh)).processingStatus).toBe('processing');
    });
  });

  describe('reuse', () => {
    it('saves new extractions with a null decisionModel', async () => {
      const id = await repo.saveExtraction(extraction(await job(), key()));
      const row = await db.orm.public.JobExtraction.where({ id }).first();
      expect(row?.decisionModel).toBeNull();
    });

    it('reuses on input, schema, prompt and generator only', async () => {
      const reuse = key('only-these');
      const id = await repo.saveExtraction(extraction(await job(), reuse));
      const jobId = (await repo.findReusable(reuse))?.jobId;
      expect(await repo.findReusable(reuse)).toEqual({ id, jobId });
      for (const other of [
        { inputHash: 'x' },
        { schemaVersion: 9 },
        { promptHash: 'x' },
        { extractionModel: 'x' },
      ])
        expect(await repo.findReusable({ ...reuse, ...other })).toBeNull();
    });

    it('never reuses a v3 row', async () => {
      const reuse = { ...key('v3-input'), schemaVersion: 3 };
      const jobId = await job();
      const id = await repo.saveExtraction(extraction(jobId, reuse));
      await db.orm.public.JobExtraction.where({ id }).update({
        decisionModel: 'typesafe/jev-1.14',
      });
      expect(
        await repo.findReusable({ ...reuse, schemaVersion: 4 }),
      ).toBeNull();
    });

    it('finds an extraction by its reuse key and copies it to another job', async () => {
      const first = await job();
      const second = await job();
      const reuse = key('same-input');
      const id = await repo.saveExtraction(extraction(first, reuse));

      expect(await repo.findReusable(reuse)).toEqual({ id, jobId: first });
      expect(
        await repo.findReusable({ ...reuse, promptHash: 'other' }),
      ).toBeNull();

      const copyId = await repo.copyExtraction(id, second);
      expect(copyId).not.toBe(id);
      const copy = await db.orm.public.JobExtraction.where({
        id: copyId,
      }).first();
      expect(copy?.jobId).toBe(second);
      expect(copy?.data).toEqual(fixtureDocument());
      expect(copy?.inputHash).toBe('same-input');
    });

    it('finds one extraction by id with its key and raw data', async () => {
      const jobId = await job();
      const reuse = { ...key('by-id'), docType: 'post' as const };
      const id = await repo.saveExtraction(extraction(jobId, reuse));
      expect(await repo.findExtraction(id)).toEqual({
        ...reuse,
        id,
        jobId,
        data: fixtureDocument(),
      });
      expect(await repo.findExtraction(randomUUID())).toBeNull();
    });
  });

  describe('findJoinedReusable', () => {
    const { inputHash: _ignored, ...joinKey } = key('x');

    it('returns an extraction of a job merged into the joined job', async () => {
      const target = await job();
      const merged = await job({ status: 'merged', mergedIntoId: target });
      const id = await repo.saveExtraction(extraction(merged, key('a')));
      expect(await repo.findJoinedReusable(target, joinKey)).toEqual({
        id,
        jobId: merged,
      });
    });

    it("returns the job's own older extraction", async () => {
      const target = await job();
      const id = await repo.saveExtraction(extraction(target, key('old')));
      expect(await repo.findJoinedReusable(target, joinKey)).toEqual({
        id,
        jobId: target,
      });
    });

    it('returns null for another prompt hash and for an unrelated job', async () => {
      const target = await job();
      const merged = await job({ status: 'merged', mergedIntoId: target });
      const unrelated = await job();
      await repo.saveExtraction(extraction(merged, key('a')));
      await repo.saveExtraction(extraction(unrelated, key('b')));
      expect(
        await repo.findJoinedReusable(target, { ...joinKey, promptHash: 'x' }),
      ).toBeNull();
      expect(await repo.findJoinedReusable(await job(), joinKey)).toBeNull();
    });
  });

  describe('attempts and spend', () => {
    it('sums the cost of non-eval attempts since a date', async () => {
      const id = await job();
      const since = new Date(Date.now() - minutes(1));
      await repo.recordAttempts([
        attempt({ jobId: id, costUsd: 0.25 }),
        attempt({ jobId: id, step: 'decision', costUsd: 0.5 }),
        attempt({ eval: true, costUsd: 10 }),
      ]);
      expect(await repo.spendSince(since)).toBeCloseTo(0.75, 6);
      expect(await repo.spendSince(new Date(Date.now() + minutes(1)))).toBe(0);
    });

    it("inserts an attempt with step 'verification'", async () => {
      const id = await job();
      await repo.recordAttempts([attempt({ jobId: id, step: 'verification' })]);
      const rows = await db.orm.public.ProcessingAttempt.where({
        jobId: id,
      }).all();
      expect(rows.map((r) => r.step)).toEqual(['verification']);
    });

    it("still inserts a legacy 'decision' attempt", async () => {
      const id = await job();
      await repo.recordAttempts([attempt({ jobId: id, step: 'decision' })]);
      const rows = await db.orm.public.ProcessingAttempt.where({
        jobId: id,
      }).all();
      expect(rows.map((r) => r.step)).toEqual(['decision']);
    });

    it('saves requiredTags and niceTags', async () => {
      const id = await job();
      const extractionId = await repo.saveExtraction({
        ...extraction(id),
        requiredTags: ['python'],
        niceTags: ['go'],
      });
      const row = await db.orm.public.JobExtraction.where({
        id: extractionId,
      }).first();
      expect(row?.requiredTags).toEqual(['python']);
      expect(row?.niceTags).toEqual(['go']);
    });

    it("stores an attempt's doc type", async () => {
      const id = await job();
      await repo.recordAttempts([
        attempt({ jobId: id }),
        attempt({ jobId: id, docType: 'post' }),
      ]);
      const rows = await db.orm.public.ProcessingAttempt.where({
        jobId: id,
      }).all();
      expect(rows.map((r) => r.docType).sort()).toEqual(['listing', 'post']);
    });

    it("stores an attempt's turn record, and null without one", async () => {
      const id = await job();
      const turns = {
        numTurns: 4,
        subtype: 'error_max_turns',
        requests: 3,
        textReplies: 1,
        enforceNudges: 1,
        toolCalls: 2,
        rejections: ['Output does not match required schema: /a: bad'],
      };
      await repo.recordAttempts([
        attempt({ jobId: id, step: 'generation', turns }),
        attempt({ jobId: id, step: 'generation_retry' }),
      ]);
      const rows = await db.orm.public.ProcessingAttempt.where({
        jobId: id,
      }).all();
      const by = Object.fromEntries(rows.map((r) => [r.step, r.turns]));
      expect(by).toEqual({ generation: turns, generation_retry: null });
    });

    it('stores every field of an attempt', async () => {
      const id = await job();
      const extractionId = await repo.saveExtraction(extraction(id));
      await repo.recordAttempts([
        attempt({
          jobId: id,
          extractionId,
          step: 'extraction_retry',
          outcome: 'invalid',
          error: 'openings.0: required',
          quoteFailures: 2,
          providerRequestId: 'gen-1',
        }),
      ]);
      const rows = await db.orm.public.ProcessingAttempt.where({
        jobId: id,
      }).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        extractionId,
        step: 'extraction_retry',
        outcome: 'invalid',
        error: 'openings.0: required',
        quoteFailures: 2,
        providerRequestId: 'gen-1',
        eval: false,
      });
    });
  });

  describe('markPending', () => {
    it('with nullStatus touches only null-status jobs in scope', async () => {
      const target = await job({ processingStatus: null });
      const ashby = await job({
        processingStatus: null,
        channels: [Channel.ASHBY],
      });
      const processed = await job({ processingStatus: 'processed' });

      expect((await repo.markPending({ nullStatus: true })).marked).toBe(1);
      const row = await jobRow(target);
      expect(row).toMatchObject({
        processingStatus: 'pending',
        processingReason: 'new',
        processingAttempts: 0,
        processingError: null,
      });
      expect(row.processingRequestedAt).toBeInstanceOf(Date);
      expect((await jobRow(ashby)).processingStatus).toBeNull();
      expect((await jobRow(processed)).processingStatus).toBe('processed');
    });

    it('with allInScope resets every in-scope job, whatever its status', async () => {
      const processed = await job({ processingStatus: 'processed' });
      const failed = await job({ processingStatus: 'failed' });
      const never = await job({ processingStatus: null });
      const ashby = await job({
        processingStatus: 'processed',
        channels: [Channel.ASHBY],
      });
      const post = await job({ kind: 'post', processingStatus: 'processed' });

      expect((await repo.markPending({ allInScope: true })).marked).toBe(3);
      for (const id of [processed, failed, never])
        expect(await jobRow(id)).toMatchObject({
          processingStatus: 'pending',
          processingReason: 'new',
          processingAttempts: 0,
          processingError: null,
        });
      expect((await jobRow(ashby)).processingStatus).toBe('processed');
      expect((await jobRow(post)).processingStatus).toBe('processed');
    });

    it('with failed and jobIds resets those jobs once each', async () => {
      const failed = await job({ processingStatus: 'failed' });
      const named = await job({ processingStatus: 'processed' });
      await job({ processingStatus: 'processed' });
      expect(
        (await repo.markPending({ failed: true, jobIds: [named, failed] }))
          .marked,
      ).toBe(2);
      expect((await jobRow(failed)).processingStatus).toBe('pending');
      expect((await jobRow(named)).processingStatus).toBe('pending');
      expect((await repo.markPending({})).marked).toBe(0);
    });
  });

  // Read-only script queries over the same tables; they live here so no two
  // files share this database.
  describe('db:places rows', () => {
    it('lists a LinkedIn job that has only location text', async () => {
      const id = await job({ channels: [Channel.LINKEDIN_JOB_BOARD_CHEAP] });
      const rows = await recentPlaceRows(
        db,
        new Date(t0.getTime() - minutes(1)),
      );
      expect(rows).toEqual([
        {
          location: 'Berlin, Germany',
          countryCode: null,
          regionCode: null,
          city: null,
          geoId: null,
        },
      ]);
      await db.orm.public.NormalizedJob.where({ id }).updateAll({
        location: null,
      });
      expect(
        await recentPlaceRows(db, new Date(t0.getTime() - minutes(1))),
      ).toEqual([]);
    });
  });

  describe('db:actor-compare outcomes', () => {
    /** A sighting of the job's raw item in its source's batch, at t0. */
    async function sight(jobId: string): Promise<void> {
      await db.execute(
        db.raw.sql`INSERT INTO raw_item_sightings
            (id, "batchId", "rawItemId", "versionId", "queryId", attribution, rank, "observedAt")
          SELECT gen_random_uuid(), v."firstBatchId", i.id, v.id, NULL, 'none', 1, ${t0.toISOString()}::timestamptz
          FROM normalized_job_sources s
          JOIN raw_items i ON i.id = s."rawItemId"
          JOIN raw_item_versions v ON v.id = i."latestVersionId"
          WHERE s."jobId" = ${jobId}::uuid`
          .affectedCount()
          .build(),
      );
    }

    /** A trial job that harvestapi joined at `joinedAt`, with an extraction. */
    async function joinedJob(joinedAt: Date): Promise<string> {
      const id = await job({
        channels: [
          Channel.LINKEDIN_JOB_BOARD_CHEAP,
          Channel.LINKEDIN_JOB_BOARD,
        ],
      });
      await sight(id);
      const extractionId = await repo.saveExtraction(extraction(id));
      await db.orm.public.NormalizedJob.where({ id }).updateAll({
        processingStatus: 'processed',
        processingReason: 'joined',
        processingRequestedAt: joinedAt,
        currentExtractionId: extractionId,
      });
      return id;
    }

    const attemptAt = (jobId: string, createdAt: Date) =>
      db.orm.public.ProcessingAttempt.create({
        ...attempt({ jobId }),
        costUsd: '0.01',
        createdAt,
      });

    it("counts a same-key joined job as reused when only the trial's earlier attempt is on it", async () => {
      const joinedAt = new Date(t0.getTime() + minutes(60));
      const reused = await joinedJob(joinedAt);
      await attemptAt(reused, t0);
      const ran = await joinedJob(joinedAt);
      await attemptAt(ran, t0);
      await attemptAt(ran, new Date(joinedAt.getTime() + minutes(1)));

      const outcomes = await db.transaction((tx) =>
        loadOutcomes(tx, new Date(t0.getTime() - minutes(1)).toISOString()),
      );

      expect(
        Object.fromEntries(outcomes.map((o) => [o.jobId, o.joinedReused])),
      ).toEqual({ [reused]: true, [ran]: false });
    });
  });

  describe('prefilter', () => {
    const reason = {
      version: PREFILTER_VERSION,
      tag: 'onsite',
      country: 'FR',
    } as const;
    const onsiteFR = { workplaceType: 'onsite', countryCode: 'FR' } as const;

    it('the skip share counts only active LinkedIn job board listings first seen in the window', async () => {
      const now = new Date();
      const month = new Date(now.getTime() - 30 * 24 * 3_600_000);
      const skipped = {
        ...onsiteFR,
        processingStatus: 'skipped',
        firstSeenAt: now,
      };
      expect(await db.query(skipShareSql(db.raw, 7))).toEqual([
        { skipped: 0, total: 0 },
      ]);

      await job(skipped);
      await job({ ...onsiteFR, firstSeenAt: now });
      // None of these belong in the denominator.
      await job({ ...skipped, channels: [Channel.ASHBY] });
      await job({ ...skipped, channels: [Channel.GREEN_HOUSE] });
      await job({ ...skipped, kind: 'post' });
      await job({ ...skipped, firstSeenAt: month });
      await job({
        ...skipped,
        status: 'merged',
        mergedIntoId: await job({ ...onsiteFR, firstSeenAt: month }),
      });

      expect(await db.query(skipShareSql(db.raw, 7))).toEqual([
        { skipped: 1, total: 2 },
      ]);
      expect(skipShareLine(1, 2)).toContain('1 of 2');
      expect(skipShareLine(0, 0)).toContain('n/a');
    });

    it('lists only never-processed, unjoined, in-scope pending listings in claim order', async () => {
      const later = await job({
        ...onsiteFR,
        requestedAt: new Date(t0.getTime() + minutes(5)),
      });
      const earlier = await job({ ...onsiteFR, requestedAt: t0 });
      await job({ ...onsiteFR, kind: 'post' });
      await job({ ...onsiteFR, channels: [Channel.ASHBY] });
      await job({ ...onsiteFR, reason: 'joined' });
      await job({ ...onsiteFR, processingStatus: 'processed' });
      const extracted = await job(onsiteFR);
      const extractionId = await repo.saveExtraction(extraction(extracted));
      await db.orm.public.NormalizedJob.where({ id: extracted }).updateAll({
        currentExtractionId: extractionId,
      });

      // Jobs that pass whatever the demand is are not listed.
      await job({ workplaceType: 'remote', countryCode: 'FR' });
      await job({ workplaceType: null, countryCode: 'FR' });
      await job({ workplaceType: 'onsite', countryCode: null });
      const remoteOk = await job(onsiteFR);
      await db.orm.public.NormalizedJob.where({ id: remoteOk }).updateAll({
        remoteAllowed: true,
      });

      const listed = await prefilter.listUncheckedPending(10);
      expect(listed.map((j) => j.id)).toEqual([earlier, later]);
      expect(listed[0]).toEqual({
        id: earlier,
        workplaceType: 'onsite',
        countryCode: 'FR',
        remoteAllowed: null,
        title: 'Backend Engineer',
        location: 'Berlin, Germany',
        descriptionText: 'We build things.',
      });
      expect(await prefilter.listUncheckedPending(1)).toHaveLength(1);
      expect(await prefilter.findUncheckedPending(earlier)).toMatchObject({
        id: earlier,
      });
      expect(await prefilter.findUncheckedPending(extracted)).toBeNull();
    });

    it('markSkipped records the reason and leaves the claim queue', async () => {
      const id = await job(onsiteFR);
      expect(await prefilter.markSkipped(id, reason)).toBe(true);
      expect(await jobRow(id)).toMatchObject({
        processingStatus: 'skipped',
        processingSkip: reason,
        processingRequestedAt: null,
      });
      expect(await repo.listPendingInScope(10)).toEqual([]);
      expect(await repo.claim(id)).toBeNull();
    });

    it('markSkipped leaves a job that changed since it was listed', async () => {
      const extracted = await job(onsiteFR);
      const extractionId = await repo.saveExtraction(extraction(extracted));
      await db.orm.public.NormalizedJob.where({ id: extracted }).updateAll({
        currentExtractionId: extractionId,
      });
      const claimed = await job(onsiteFR);
      await repo.claim(claimed);
      const joined = await job({ ...onsiteFR, reason: 'joined' });
      const retagged = await job({ ...onsiteFR, workplaceType: 'remote' });

      for (const id of [extracted, claimed, joined, retagged])
        expect(await prefilter.markSkipped(id, reason)).toBe(false);
      expect((await jobRow(extracted)).processingStatus).toBe('pending');
      expect((await jobRow(claimed)).processingStatus).toBe('processing');
      expect((await jobRow(joined)).processingStatus).toBe('pending');
      expect((await jobRow(retagged)).processingSkip).toBeNull();
    });

    it('loadDemand with no published profile is empty', async () => {
      await sql`DELETE FROM profiles WHERE state = 'published'`;
      expect(await prefilter.loadDemand()).toEqual({
        anywhere: false,
        countries: new Set(),
      });
    });

    it('a profile is rechecked once per publish or places edit, and recording the check never bumps matchVersion', async () => {
      const userId = randomUUID();
      const { raw } = db;
      // This database has only the processor's code lists: skip the profile code check.
      await db.execute(
        raw.sql`ALTER TABLE profiles DISABLE TRIGGER profiles_check_codes`
          .affectedCount()
          .build(),
      );
      await db.execute(
        raw.sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`})`
          .affectedCount()
          .build(),
      );
      await db.execute(
        raw.sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`
          .affectedCount()
          .build(),
      );
      const created = await db.orm.public.Profile.create({
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
      } as never);
      const id = created.id;
      const update = async (set: string, locations?: unknown) => {
        const statement =
          set === 'locations'
            ? raw.sql`UPDATE profiles SET locations = ${JSON.stringify(locations)}::jsonb WHERE id = ${id}::uuid`
            : set === 'publish'
              ? raw.sql`UPDATE profiles SET state = 'published', "publishedAt" = now() WHERE id = ${id}::uuid`
              : raw.sql`UPDATE profiles SET state = 'draft', "publishedAt" = NULL WHERE id = ${id}::uuid`;
        await db.execute(statement.affectedCount().build());
      };
      const state = async () => {
        const [row] = await db.query(
          raw.sql`SELECT "matchVersion" FROM profiles WHERE id = ${id}::uuid`
            .returnsRow({ matchVersion: 'pg/int4@1' })
            .build(),
        );
        return { matchVersion: Number(row?.matchVersion) };
      };
      const unrechecked = async () =>
        (await prefilter.listUnrecheckedProfiles()).filter((p) => p.id === id);
      try {
        // A draft is not listed; publishing asks for a recheck.
        expect(await unrechecked()).toEqual([]);
        await update('publish');
        const published = await state();
        expect(await unrechecked()).toEqual([
          {
            id,
            matchVersion: published.matchVersion,
            changedAt: expect.any(Date),
          },
        ]);
        // The change time is the later of publishedAt and updatedAt.
        const [first] = await unrechecked();
        const row = await db.orm.public.Profile.where({ id }).first();
        expect(first.changedAt.getTime()).toBe(
          Math.max(row!.updatedAt.getTime(), row!.publishedAt?.getTime() ?? 0),
        );

        // Recording the check clears it and leaves matchVersion alone.
        await prefilter.setRecheckedVersion(id, published.matchVersion);
        expect(await unrechecked()).toEqual([]);
        expect((await state()).matchVersion).toBe(published.matchVersion);

        // Unpublish, then republish with no edit: rechecked again.
        await update('unpublish');
        expect(await unrechecked()).toEqual([]);
        await update('publish');
        expect(await unrechecked()).toHaveLength(1);
        expect((await state()).matchVersion).toBe(published.matchVersion);
        await prefilter.setRecheckedVersion(id, published.matchVersion);

        // A places edit bumps matchVersion, so it is rechecked.
        await update('locations', {
          remote: [],
          hybrid: [{ kind: 'country', code: 'MA' }],
          onsite: [],
        });
        expect(await unrechecked()).toEqual([
          {
            id,
            matchVersion: published.matchVersion + 1,
            changedAt: expect.any(Date),
          },
        ]);
      } finally {
        await db.execute(
          raw.sql`ALTER TABLE profiles ENABLE TRIGGER profiles_check_codes`
            .affectedCount()
            .build(),
        );
        await db.execute(
          raw.sql`DELETE FROM profiles WHERE id = ${id}::uuid`
            .affectedCount()
            .build(),
        );
      }
    });

    it('reopenSkipped leaves a skipped post alone, and countReopenable counts what it would reopen', async () => {
      const since = new Date(t0.getTime() - minutes(60));
      const listing = await job(onsiteFR);
      const post = await job({ ...onsiteFR, kind: 'post' });
      expect(await prefilter.markSkipped(listing, reason)).toBe(true);
      await db.orm.public.NormalizedJob.where({ id: post }).updateAll({
        processingStatus: 'skipped',
      });

      expect(await prefilter.countReopenable({ firstSeenSince: since })).toBe(
        1,
      );
      expect((await jobRow(listing)).processingStatus).toBe('skipped');
      expect(await prefilter.reopenSkipped({ firstSeenSince: since })).toBe(1);
      expect((await jobRow(post)).processingStatus).toBe('skipped');
    });

    it('reopenSkipped reopens recent, open skips and keeps the reason', async () => {
      const since = new Date(t0.getTime() - minutes(60));
      const recent = await job(onsiteFR);
      const old = await job({
        ...onsiteFR,
        firstSeenAt: new Date(since.getTime() - minutes(1)),
      });
      const closed = await job({ ...onsiteFR, closed: true });
      const expired = await job({
        ...onsiteFR,
        expiresAt: new Date(Date.now() - minutes(1)),
      });
      for (const id of [recent, old, closed, expired])
        expect(await prefilter.markSkipped(id, reason)).toBe(true);

      expect(await prefilter.reopenSkipped({ firstSeenSince: since })).toBe(1);
      expect(await jobRow(recent)).toMatchObject({
        processingStatus: 'pending',
        processingReason: 'reopened',
        processingSkip: reason,
      });
      expect((await jobRow(recent)).processingRequestedAt).toBeInstanceOf(Date);
      for (const id of [old, closed, expired])
        expect((await jobRow(id)).processingStatus).toBe('skipped');
    });

    it('markPending leaves skipped jobs to allInScope, but sends one by id', async () => {
      const id = await job(onsiteFR);
      await prefilter.markSkipped(id, reason);
      expect(await repo.markPending({ allInScope: true })).toEqual({
        marked: 0,
        skippedArchived: 0,
        leftSkipped: 1,
      });
      expect(
        await repo.markPending({ failed: true, nullStatus: true }),
      ).toEqual({ marked: 0, skippedArchived: 0, leftSkipped: 0 });
      expect((await jobRow(id)).processingStatus).toBe('skipped');
      expect(await repo.markPending({ jobIds: [id] })).toEqual({
        marked: 1,
        skippedArchived: 0,
        leftSkipped: 0,
      });
      expect((await jobRow(id)).processingStatus).toBe('pending');
    });

    it('processingCounts counts skipped listings apart', async () => {
      const id = await job(onsiteFR);
      await job(onsiteFR);
      await prefilter.markSkipped(id, reason);
      const counts = await repo.processingCounts();
      expect(counts.listings).toMatchObject({ pending: 1, skipped: 1 });
      expect(counts.posts.skipped).toBe(0);
    });

    it('a run that finishes after its job was released, before any skip, leaves nothing to skip', async () => {
      const id = await job(onsiteFR);
      const claim = (await repo.claim(id))!;
      await repo.releaseStale(new Date(Date.now() + minutes(1)));
      const extractionId = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(claim, { status: 'processed', extractionId }),
      ).toBe('superseded');
      expect(await jobRow(id)).toMatchObject({
        processingStatus: 'pending',
        currentExtractionId: extractionId,
      });
      // The extraction and the status land in one statement: the skip that
      // would have followed is refused, so no skipped row holds an extraction.
      expect(await prefilter.markSkipped(id, reason)).toBe(false);
      expect(await prefilter.listUncheckedPending(10)).toEqual([]);
      expect((await jobRow(id)).processingStatus).toBe('pending');
    });

    it('a run that finishes after its job was released and skipped leaves it pending with the extraction', async () => {
      const id = await job(onsiteFR);
      const claim = (await repo.claim(id))!;
      await repo.releaseStale(new Date(Date.now() + minutes(1)));
      expect(await prefilter.markSkipped(id, reason)).toBe(true);
      const extractionId = await repo.saveExtraction(extraction(id));
      expect(
        await repo.finish(claim, { status: 'processed', extractionId }),
      ).toBe('superseded');
      const row = await jobRow(id);
      expect(row.processingStatus).toBe('pending');
      expect(row.currentExtractionId).toBe(extractionId);
      expect(row.processingRequestedAt).toBeInstanceOf(Date);
      expect(await prefilter.findUncheckedPending(id)).toBeNull();
    });
  });

  describe('archived jobs', () => {
    it('markPending skips archived under every selector', async () => {
      const id = await job({ processingStatus: 'archived' });
      expect(
        await repo.markPending({ allInScope: true, jobIds: [id] }),
      ).toEqual({ marked: 0, skippedArchived: 1, leftSkipped: 0 });
      expect(await repo.markPending({ jobIds: [id] })).toEqual({
        marked: 0,
        skippedArchived: 1,
        leftSkipped: 0,
      });
      expect(
        await repo.markPending({ nullStatus: true, failed: true }),
      ).toEqual({ marked: 0, skippedArchived: 0, leftSkipped: 0 });
      expect((await jobRow(id)).processingStatus).toBe('archived');
    });

    it('claim refuses an archived job', async () => {
      const id = await job({ processingStatus: 'archived' });
      expect(await repo.claim(id)).toBeNull();
    });

    it('listPendingInScope never lists an archived job', async () => {
      await job({ processingStatus: 'archived' });
      expect(await repo.listPendingInScope(10)).toEqual([]);
    });
  });

  describe('posts', () => {
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
    const daysAgo = (n: number) => hoursAgo(n * 24);

    /** A pending post job first seen `at`, with one LinkedIn posts source per author. */
    const post = (
      at: Date = hoursAgo(1),
      over: JobSpec = {},
    ): Promise<string> =>
      job({ kind: 'post', firstSeenAt: at, authors: ['profile:p1'], ...over });

    async function silence(authorKey: string): Promise<void> {
      await db.execute(
        db.raw
          .sql`INSERT INTO silenced_authors (id, "authorKey", reason, origin)
          VALUES (${randomUUID()}::uuid, ${authorKey}::text, 'test', 'manual')`
          .affectedCount()
          .build(),
      );
    }

    it('claims a pending post first seen within 7 days', async () => {
      const id = await post();
      expect(await repo.claim(id)).not.toBeNull();
      expect((await repo.jobState(id))?.inScope).toBe(true);
    });

    it('never claims a post first seen 8 days ago, and counts it out of window', async () => {
      const id = await post(daysAgo(8));
      expect(await repo.claim(id)).toBeNull();
      expect(await repo.listPendingPosts(10)).toEqual([]);
      expect((await repo.jobState(id))?.inScope).toBe(false);
      const counts = await repo.processingCounts();
      expect(counts.posts).toMatchObject({
        pending: 0,
        outOfWindow: 1,
        silenced: 0,
      });
    });

    it('holds a post whose only author is silenced, and claims it once un-silenced', async () => {
      const id = await post(hoursAgo(1), { authors: ['profile:junk'] });
      await silence('profile:junk');
      expect(await repo.listPendingPosts(10)).toEqual([]);
      expect(await repo.claim(id)).toBeNull();
      expect((await repo.processingCounts()).posts).toMatchObject({
        pending: 0,
        outOfWindow: 0,
        silenced: 1,
      });

      await sql`DELETE FROM silenced_authors`;
      expect(await repo.listPendingPosts(10)).toEqual([id]);
      expect(await repo.claim(id)).not.toBeNull();
    });

    it('still claims a post when only one of its authors is silenced', async () => {
      const id = await post(hoursAgo(1), {
        authors: ['profile:junk', 'profile:ok'],
      });
      await silence('profile:junk');
      expect(await repo.claim(id)).not.toBeNull();
    });

    it('lists in-scope pending posts newest first and respects the limit', async () => {
      const older = await post(hoursAgo(3));
      const newest = await post(hoursAgo(1));
      const middle = await post(hoursAgo(2));
      await post(daysAgo(8));
      await post(hoursAgo(1), { processingStatus: 'processed' });
      await job();
      expect(await repo.listPendingPosts(10)).toEqual([newest, middle, older]);
      expect(await repo.listPendingPosts(1)).toEqual([newest]);
    });

    it('keeps posts out of the listing queue', async () => {
      await post();
      expect(await repo.listPendingInScope(10)).toEqual([]);
    });

    it('counts listings and in-scope posts separately', async () => {
      await job();
      await job({ processingStatus: null });
      await post();
      await post(hoursAgo(2), { processingStatus: 'processed' });
      expect(await repo.processingCounts()).toEqual({
        listings: {
          pending: 1,
          processing: 0,
          processed: 0,
          failed: 0,
          archived: 0,
          skipped: 0,
          unset: 1,
        },
        posts: {
          pending: 1,
          processing: 0,
          processed: 1,
          failed: 0,
          archived: 0,
          skipped: 0,
          unset: 0,
          outOfWindow: 0,
          silenced: 0,
        },
      });
    });

    it('markPending with nullStatus marks in-window posts and skips out-of-window ones', async () => {
      const fresh = await post(hoursAgo(1), { processingStatus: null });
      const old = await post(daysAgo(8), { processingStatus: null });
      expect((await repo.markPending({ nullStatus: true })).marked).toBe(1);
      expect((await jobRow(fresh)).processingStatus).toBe('pending');
      expect((await jobRow(old)).processingStatus).toBeNull();
    });

    it('a listing reuse key still finds a listing row written without a doc type', async () => {
      const jobId = await job();
      const reuse = key('pre-change');
      const { docType: _docType, ...legacy } = reuse;
      const row = await db.orm.public.JobExtraction.create({
        ...legacy,
        ...noColumns,
        jobId,
        decisionModel: null,
        data: fixtureDocument() as never,
        needsReview: false,
        costUsd: '0.02',
      });
      expect(row.docType).toBe('listing');
      expect(await repo.findReusable(reuse)).toEqual({ id: row.id, jobId });
      expect(await repo.findReusable({ ...reuse, docType: 'post' })).toBeNull();
    });

    it('saves a post extraction with its doc type and verdict', async () => {
      const jobId = await post();
      const reuse: ReuseKey = { ...key('post-input'), docType: 'post' };
      const id = await repo.saveExtraction({
        ...extraction(jobId, reuse),
        verdict: 'hiring',
        verdictReason: 'hiring',
        verdictConfidence: 'sure',
      });
      expect(
        await db.orm.public.JobExtraction.where({ id }).first(),
      ).toMatchObject({
        docType: 'post',
        verdict: 'hiring',
        verdictReason: 'hiring',
        verdictConfidence: 'sure',
      });
      expect(await repo.findReusable(reuse)).toEqual({ id, jobId });
      expect(
        await repo.findReusable({ ...reuse, docType: 'listing' }),
      ).toBeNull();
    });

    describe('role jobs', () => {
      async function roleSetup() {
        const postId = await post(hoursAgo(2), {
          processingStatus: 'processed',
        });
        await db.orm.public.NormalizedJob.where({ id: postId }).updateAll({
          postedAt: hoursAgo(3),
        });
        const extractionId = await repo.saveExtraction(
          extraction(postId, { ...key(), docType: 'post' }),
        );
        return { postId, extractionId };
      }

      it('creates a post_role job copying the post, and updates it on a second upsert', async () => {
        const { postId, extractionId } = await roleSetup();
        const postRow = await jobRow(postId);
        const id = await repo.upsertRoleJob({
          postJobId: postId,
          roleKey: 'a',
          title: 'Backend Engineer',
          companyName: 'Acme',
          extractionId,
          linkKeys: [],
        });
        expect(await jobRow(id)).toMatchObject({
          kind: 'post_role',
          status: 'active',
          parentJobId: postId,
          roleKey: 'a',
          jobKey: `${postRow.jobKey}#role:a`,
          title: 'Backend Engineer',
          companyName: 'Acme',
          postingUrl: postRow.postingUrl,
          postedAt: postRow.postedAt,
          firstSeenAt: postRow.firstSeenAt,
          lastSeenAt: postRow.lastSeenAt,
          descriptionText: postRow.descriptionText,
          processingStatus: 'processed',
          currentExtractionId: extractionId,
        });
        expect((await jobRow(id)).processedAt).toBeInstanceOf(Date);

        const next = await repo.saveExtraction(
          extraction(postId, { ...key(), docType: 'post' }),
        );
        const again = await repo.upsertRoleJob({
          postJobId: postId,
          roleKey: 'a',
          title: 'Senior Backend Engineer',
          companyName: null,
          extractionId: next,
          linkKeys: [],
        });
        expect(again).toBe(id);
        expect(await jobRow(id)).toMatchObject({
          title: 'Senior Backend Engineer',
          companyName: null,
          currentExtractionId: next,
        });
      });

      it('upsertRoleJob writes linkKeys', async () => {
        const { postId, extractionId } = await roleSetup();
        const role = (linkKeys: string[]) =>
          repo.upsertRoleJob({
            postJobId: postId,
            roleKey: 'a',
            title: 'Role a',
            companyName: null,
            extractionId,
            linkKeys,
          });
        const id = await role(['ats:greenhouse/acme/1', 'linkedin-job:2']);
        expect((await jobRow(id)).linkKeys).toEqual([
          'ats:greenhouse/acme/1',
          'linkedin-job:2',
        ]);
        await role([]);
        expect((await jobRow(id)).linkKeys).toEqual([]);
      });

      it("upsertRoleJob sets postedAt to the original's date", async () => {
        const { postId, extractionId } = await roleSetup();
        const sources = (extra: object) => ({
          sources: [{ postedAt: '2026-11-20T10:00:00.000Z', ...extra }],
        });
        const postedAt = async (roleKey: string) =>
          (
            await jobRow(
              await repo.upsertRoleJob({
                postJobId: postId,
                roleKey,
                title: 'T',
                companyName: null,
                extractionId,
                linkKeys: [],
              }),
            )
          ).postedAt;
        await db.orm.public.NormalizedJob.where({ id: postId }).updateAll({
          postSources: sources({
            original: { postedAt: '2026-10-01T09:00:00.000Z' },
          }) as never,
        });
        expect(await postedAt('a')).toEqual(
          new Date('2026-10-01T09:00:00.000Z'),
        );
        await db.orm.public.NormalizedJob.where({ id: postId }).updateAll({
          postSources: sources({ original: null }) as never,
        });
        expect(await postedAt('b')).toEqual(
          new Date('2026-11-20T10:00:00.000Z'),
        );
      });

      it('listRoleJobIds lists processed active roles only', async () => {
        const { postId, extractionId } = await roleSetup();
        const role = (roleKey: string) =>
          repo.upsertRoleJob({
            postJobId: postId,
            roleKey,
            title: `Role ${roleKey}`,
            companyName: 'Acme',
            extractionId,
            linkKeys: [],
          });
        const a = await role('a');
        const b = await role('b');
        const c = await role('c');
        await repo.archiveRoleJobs(postId, ['a', 'c']);
        await db.orm.public.NormalizedJob.where({ id: b }).updateAll({
          processingStatus: 'archived',
        });
        expect((await repo.listRoleJobIds(postId)).sort()).toEqual(
          [a, c].sort(),
        );
      });

      it('archives a role job with no role key', async () => {
        const { postId, extractionId } = await roleSetup();
        const postRow = await jobRow(postId);
        const orphan = await db.orm.public.NormalizedJob.create({
          jobKey: `${postRow.jobKey}#role:none`,
          kind: 'post_role',
          status: 'active',
          mergedIntoId: null,
          parentJobId: postId,
          roleKey: null,
          postingUrl: postRow.postingUrl,
          closed: false,
          fieldSources: {},
          firstSeenAt: postRow.firstSeenAt,
          lastSeenAt: postRow.lastSeenAt,
          processingStatus: 'processed',
          currentExtractionId: extractionId,
          normalizerVersion: 1,
        });
        expect(await repo.archiveRoleJobs(postId, ['a'])).toBe(1);
        expect((await jobRow(orphan.id)).processingStatus).toBe('archived');
      });

      it('never claims, lists or counts a role job', async () => {
        const { postId, extractionId } = await roleSetup();
        const id = await repo.upsertRoleJob({
          postJobId: postId,
          roleKey: 'a',
          title: 'Backend Engineer',
          companyName: 'Acme',
          extractionId,
          linkKeys: [],
        });
        await db.orm.public.NormalizedJob.where({ id }).updateAll({
          processingStatus: 'pending',
        });
        expect(await repo.claim(id)).toBeNull();
        expect(await repo.listPendingInScope(10)).toEqual([]);
        expect(await repo.listPendingPosts(10)).toEqual([]);
        expect((await repo.markPending({ allInScope: true })).marked).toBe(1);
        const counts = await repo.processingCounts();
        expect(counts.posts.pending).toBe(1);
        expect(counts.posts.processed).toBe(0);
        expect(counts.listings.pending).toBe(0);
      });

      it('archives the role jobs not kept, and an upsert reactivates one', async () => {
        const { postId, extractionId } = await roleSetup();
        const role = (roleKey: string) =>
          repo.upsertRoleJob({
            postJobId: postId,
            roleKey,
            title: `Role ${roleKey}`,
            companyName: 'Acme',
            extractionId,
            linkKeys: [],
          });
        const a = await role('a');
        const b = await role('b');
        expect(await repo.archiveRoleJobs(postId, ['a'])).toBe(1);
        expect((await jobRow(a)).processingStatus).toBe('processed');
        expect(await jobRow(b)).toMatchObject({
          processingStatus: 'archived',
          status: 'active',
        });
        expect(await repo.archiveRoleJobs(postId, ['a'])).toBe(0);
        expect(await repo.archiveRoleJobs(postId, [])).toBe(1);

        expect(await role('b')).toBe(b);
        expect((await jobRow(b)).processingStatus).toBe('processed');
      });
    });

    it('counts non-eval post calls since a date', async () => {
      await repo.recordAttempts([
        attempt({ docType: 'post' }),
        attempt({ docType: 'post', outcome: 'error' }),
        attempt({ docType: 'post', eval: true }),
        attempt({ docType: 'listing' }),
      ]);
      expect(await repo.postCallsSince(hoursAgo(1))).toBe(2);
      expect(await repo.postCallsSince(new Date(Date.now() + 60_000))).toBe(0);
    });
  });

  describe('VocabRepository', () => {
    it('proposes an unknown term once, counting each sighting', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      const rows = await db.orm.public.TechTag.where({ code: 'bun' }).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'proposed',
        occurrences: 2,
        label: 'Bun',
      });
    });

    it('never touches an approved row with the same code', async () => {
      const before = await db.orm.public.TechTag.where({
        code: 'react',
      }).first();
      await vocab.propose([{ list: 'techTags', text: 'React' }]);
      const after = await db.orm.public.TechTag.where({
        code: 'react',
      }).first();
      expect(after).toEqual(before);
      expect(after?.status).toBe('approved');
    });

    it('snapshot leaves proposed terms out of the options and the vocabulary', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      const {
        options,
        vocab: snapshot,
        regionCountries,
      } = await vocab.snapshot();
      expect(options.techTags).toContain('react');
      expect(options.techTags).not.toContain('bun');
      expect(snapshot.approved.techTags.get('react')).toBe('react');
      expect(snapshot.approved.techTags.has('bun')).toBe(false);
      expect(regionCountries.get('EMEA')).toContain('DE');
    });

    it('snapshot holds the 17 seeded engineering role kinds', async () => {
      const { engineeringRoleKinds } = await vocab.snapshot();
      expect(engineeringRoleKinds.size).toBe(17);
      expect(engineeringRoleKinds.has('backend_engineer')).toBe(true);
      expect(engineeringRoleKinds.has('other')).toBe(false);
    });

    it('upserts cities by lower-cased name and country', async () => {
      const first = await vocab.upsertCities([
        { name: 'Berlin', countryCode: 'DE' },
      ]);
      const second = await vocab.upsertCities([
        { name: 'BERLIN', countryCode: 'DE' },
        { name: 'Paris', countryCode: 'FR' },
      ]);
      expect(second.get('BERLIN|DE')).toBe(first.get('Berlin|DE'));
      expect(second.get('Paris|FR')).toBeDefined();
      const berlin = await db.orm.public.City.where({
        nameKey: 'berlin',
        countryCode: 'DE',
      }).first();
      expect(berlin).toMatchObject({
        name: 'Berlin',
        status: 'proposed',
        occurrences: 2,
      });
    });

    it('maps accented and aliased city names to the existing city', async () => {
      const fes = await db.orm.public.City.create({
        name: 'Fès',
        nameKey: 'fès',
        countryCode: 'MA',
        geonamesId: null,
        aliases: ['Fez'],
        status: 'approved',
        occurrences: 3,
        firstSeenAt: new Date(),
        approvedAt: new Date(),
      });
      const ids = await vocab.upsertCities([
        { name: 'Fez', countryCode: 'MA' },
        { name: 'Fes', countryCode: 'MA' },
      ]);
      expect(ids.get('Fez|MA')).toBe(fes.id);
      expect(ids.get('Fes|MA')).toBe(fes.id);
      expect(
        await db.orm.public.City.where({ countryCode: 'MA' }).all(),
      ).toHaveLength(1);
      const after = await db.orm.public.City.where({ id: fes.id }).first();
      expect(after?.occurrences).toBe(5);
    });

    it('sends a spelling two cities share to the same city as load()', async () => {
      const make = (
        name: string,
        status: 'approved' | 'proposed',
        firstSeenAt: Date,
        aliases: string[] = [],
      ) =>
        db.orm.public.City.create({
          name,
          nameKey: name.toLowerCase(),
          countryCode: 'MA',
          geonamesId: null,
          aliases,
          status,
          occurrences: 1,
          firstSeenAt,
          approvedAt: status === 'approved' ? new Date() : null,
        });
      await make('Fes', 'proposed', new Date('2020-01-01'));
      const approved = await make('Fès', 'approved', new Date('2026-01-01'), [
        'Fes',
      ]);
      const ids = await vocab.upsertCities([
        { name: 'Fes', countryCode: 'MA' },
      ]);
      const places = await new PrismaPlaceVocabularyRepository({
        db,
      } as DatabaseService).load();
      expect(ids.get('Fes|MA')).toBe(approved.id);
      expect(places.cities.get('MA|fes')).toBe(approved.id);
    });

    it('does not insert a city whose name folds to nothing', async () => {
      const ids = await vocab.upsertCities([
        { name: ' - ', countryCode: 'MA' },
      ]);
      expect(ids.size).toBe(0);
      expect(
        await db.orm.public.City.where({ countryCode: 'MA' }).all(),
      ).toHaveLength(0);
    });

    it('sums the sightings of several spellings of one city in a batch', async () => {
      const fes = await db.orm.public.City.create({
        name: 'Fès',
        nameKey: 'fès',
        countryCode: 'MA',
        geonamesId: null,
        aliases: ['Fez'],
        status: 'approved',
        occurrences: 3,
        firstSeenAt: new Date(),
        approvedAt: new Date(),
      });
      const ids = await vocab.upsertCities([
        { name: 'Fez', countryCode: 'MA' },
        { name: 'Fes', countryCode: 'MA' },
        { name: 'Fez', countryCode: 'MA' },
      ]);
      expect(ids.get('Fez|MA')).toBe(fes.id);
      expect(ids.get('Fes|MA')).toBe(fes.id);
      const after = await db.orm.public.City.where({ id: fes.id }).first();
      expect(after?.occurrences).toBe(6);
    });

    it('loads approved places and every city under its folded name and aliases', async () => {
      const fes = await db.orm.public.City.create({
        name: 'Fès',
        nameKey: 'fès',
        countryCode: 'MA',
        geonamesId: null,
        aliases: ['Fez'],
        status: 'proposed',
        occurrences: 1,
        firstSeenAt: new Date(),
        approvedAt: null,
      });
      const places = await new PrismaPlaceVocabularyRepository({
        db,
      } as DatabaseService).load();
      expect(places.cities.get('MA|fes')).toBe(fes.id);
      expect(places.cities.get('MA|fez')).toBe(fes.id);
      expect(places.cityNames.get(fes.id)).toBe('Fès');
      expect(places.countries.has('DE')).toBe(true);
      expect(places.regionCountries.get('EMEA')?.has('DE')).toBe(true);
      expect(places.countryNames.get('germany')).toBe('DE');
      expect(places.cityCountries.get('fes')).toEqual(new Set(['MA']));
      expect(places.cityCountries.get('fez')).toEqual(new Set(['MA']));
    });

    it('bumps the occurrences of approved codes', async () => {
      const before = await db.orm.public.SeniorityTerm.where({
        code: 'senior',
      }).first();
      await vocab.bumpOccurrences('seniorities', ['senior', 'senior']);
      const after = await db.orm.public.SeniorityTerm.where({
        code: 'senior',
      }).first();
      expect(after!.occurrences).toBe(before!.occurrences + 2);
    });

    it('approves a proposed term so it is offered and matched', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      expect(await vocab.approve('techTags', 'bun')).toBe(true);
      expect(await vocab.approve('techTags', 'bun')).toBe(false);
      const { options, vocab: snapshot } = await vocab.snapshot();
      expect(options.techTags).toContain('bun');
      expect(snapshot.approved.techTags.get('bun')).toBe('bun');
      const row = await db.orm.public.TechTag.where({ code: 'bun' }).first();
      expect(row?.status).toBe('approved');
      expect(row?.approvedAt).not.toBeNull();
    });

    it('approve leaves an already approved row alone', async () => {
      const before = await db.orm.public.TechTag.where({
        code: 'react',
      }).first();
      await vocab.approve('techTags', 'react');
      expect(
        await db.orm.public.TechTag.where({ code: 'react' }).first(),
      ).toEqual(before);
    });

    it('aliases a proposed term to an approved one and deletes the proposal', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Reactjs' }]);
      await vocab.alias('techTags', 'reactjs', 'react');
      expect(
        await db.orm.public.TechTag.where({ code: 'reactjs' }).first(),
      ).toBeNull();
      const { vocab: snapshot } = await vocab.snapshot();
      expect(snapshot.approved.techTags.get('reactjs')).toBe('react');
    });

    it('alias refuses a missing or unapproved target and an approved source', async () => {
      await vocab.propose([
        { list: 'techTags', text: 'Bun' },
        { list: 'techTags', text: 'Deno' },
      ]);
      await expect(vocab.alias('techTags', 'bun', 'deno')).rejects.toThrow();
      await expect(vocab.alias('techTags', 'bun', 'nope')).rejects.toThrow();
      await expect(vocab.alias('techTags', 'react', 'bun')).rejects.toThrow();
      expect(
        await db.orm.public.TechTag.where({ code: 'bun' }).first(),
      ).not.toBeNull();
    });

    it('rejects a proposed term but never deletes an approved one', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      expect(await vocab.reject('techTags', 'bun')).toBe(true);
      expect(await vocab.reject('techTags', 'react')).toBe(false);
      expect(await vocab.reject('techTags', 'missing')).toBe(false);
      expect(
        await db.orm.public.TechTag.where({ code: 'bun' }).first(),
      ).toBeNull();
      expect(
        await db.orm.public.TechTag.where({ code: 'react' }).first(),
      ).not.toBeNull();
    });

    it('lists proposed terms and approves or rejects cities by id', async () => {
      await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
      expect((await vocab.listProposed('techTags')).map((r) => r.code)).toEqual(
        ['bun'],
      );
      const ids = await vocab.upsertCities([
        { name: 'Berlin', countryCode: 'DE' },
        { name: 'Paris', countryCode: 'FR' },
      ]);
      expect(await vocab.listProposedCities()).toHaveLength(2);
      expect(await vocab.approveCity(ids.get('Berlin|DE')!)).toBe(true);
      expect(await vocab.rejectCity(ids.get('Berlin|DE')!)).toBe(false);
      expect(await vocab.rejectCity(ids.get('Paris|FR')!)).toBe(true);
      expect(await vocab.listProposedCities()).toHaveLength(0);
      const berlin = await db.orm.public.City.where({
        id: ids.get('Berlin|DE')!,
      }).first();
      expect(berlin?.status).toBe('approved');
      expect(
        await db.orm.public.City.where({ id: ids.get('Paris|FR')! }).first(),
      ).toBeNull();
    });

    it('refuses to reject a city an extraction still names', async () => {
      const ids = await vocab.upsertCities([
        { name: 'Lyon', countryCode: 'FR' },
      ]);
      const lyon = ids.get('Lyon|FR')!;
      const jobId = await job();
      await repo.saveExtraction({
        ...extraction(jobId),
        cityIds: [lyon],
      });
      expect(await vocab.rejectCity(lyon)).toBe(false);
      expect(
        await db.orm.public.City.where({ id: lyon }).first(),
      ).not.toBeNull();
    });
  });
});

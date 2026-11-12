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
import type { SeedEnvironmentVariables } from 'src/config';

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
  schemaVersion: 1,
  promptHash: 'prompt-hash',
  decisionModel: 'typesafe/jev-1.14',
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

  async function sql(statement: TemplateStringsArray): Promise<void> {
    await db.execute(db.raw.sql(statement).affectedCount().build());
  }

  /** A raw item of `channel` with one version, its normalized version and its link to `jobId`. */
  async function source(jobId: string, channel: Channel): Promise<void> {
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

  interface JobSpec {
    channels?: Channel[];
    kind?: 'job' | 'post';
    processingStatus?: string | null;
    requestedAt?: Date | null;
    closed?: boolean;
    descriptionText?: string | null;
  }

  /** A normalized job with one source per channel (LinkedIn job board by default). */
  async function job(spec: JobSpec = {}): Promise<string> {
    const status =
      spec.processingStatus === undefined ? 'pending' : spec.processingStatus;
    const row = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: spec.kind ?? 'job',
      status: 'active',
      mergedIntoId: null,
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
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: t0,
      processingStatus: status,
      processingReason: status === 'pending' ? 'new' : null,
      processingRequestedAt:
        spec.requestedAt === undefined
          ? status === null
            ? null
            : t0
          : spec.requestedAt,
      normalizerVersion: 1,
    });
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
    await sql`TRUNCATE processing_attempts, job_extractions, cities, normalized_job_sources, normalized_jobs, normalized_versions, raw_item_sightings, raw_item_versions, raw_items, collection_batches, search_segment_runs CASCADE`;
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
      expect(claim).toEqual({ jobId: id, requestedAt: t0, attempts: 1 });
      const row = await jobRow(id);
      expect(row.processingStatus).toBe('processing');
      expect(row.processingAttempts).toBe(1);
      expect(row.processingStartedAt).toBeInstanceOf(Date);
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
    it('returns the posting and its LinkedIn evidence', async () => {
      const id = await job({ descriptionText: null });
      expect(await repo.loadJob(id)).toEqual({
        id,
        closed: false,
        title: 'Backend Engineer',
        companyName: 'Acme',
        descriptionText: null,
        evidence: {
          location: 'Berlin, Germany',
          contractType: 'Full-time',
          experienceLevel: 'Mid-Senior level',
          salary: null,
        },
      });
      expect(await repo.loadJob(randomUUID())).toBeNull();
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

      expect(await repo.markPending({ nullStatus: true })).toBe(1);
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

      expect(await repo.markPending({ allInScope: true })).toBe(3);
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
        await repo.markPending({ failed: true, jobIds: [named, failed] }),
      ).toBe(2);
      expect((await jobRow(failed)).processingStatus).toBe('pending');
      expect((await jobRow(named)).processingStatus).toBe('pending');
      expect(await repo.markPending({})).toBe(0);
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

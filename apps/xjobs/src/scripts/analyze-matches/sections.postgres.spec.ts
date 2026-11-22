import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import { EXTRACTION_SCHEMA_VERSION } from 'src/modules/processor/schema';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { fixtureHiringPost } from 'src/modules/processor/schema/fixture-post.testing';
import { shapePostExtraction } from './post-extraction';
import { SECTIONS } from './sections';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables.
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00Z');

describe.skipIf(!url)(
  'db:analyze listing-quality sections in PostgreSQL',
  () => {
    let db: DatabaseClient;

    async function job(
      kind: 'job' | 'post' | 'post_role',
      parentJobId?: string,
    ) {
      const row = await db.orm.public.NormalizedJob.create({
        jobKey: randomUUID(),
        kind,
        parentJobId: parentJobId ?? null,
        roleKey: kind === 'post_role' ? 'backend' : null,
        status: 'active',
        mergedIntoId: null,
        postingUrl: `https://example.com/${randomUUID()}`,
        closed: false,
        fieldSources: {},
        firstSeenAt: t0,
        lastSeenAt: t0,
        normalizerVersion: 1,
        processingStatus: 'processed',
      } as never);
      return row.id;
    }

    async function extraction(
      jobId: string,
      docType: 'listing' | 'post',
      data: unknown,
    ) {
      const row = await db.orm.public.JobExtraction.create({
        jobId,
        docType,
        inputHash: randomUUID(),
        schemaVersion: docType === 'post' ? 1 : EXTRACTION_SCHEMA_VERSION,
        promptHash: 'p',
        decisionModel: 'd',
        extractionModel: 'e',
        data: data as never,
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
      } as never);
      await db.orm.public.NormalizedJob.where({ id: jobId }).updateAll({
        currentExtractionId: row.id,
      });
    }

    async function rows(title: string): Promise<Record<string, unknown>[]> {
      const section = SECTIONS.find((s) => s.title.startsWith(title));
      if (!section) throw new Error(`no section ${title}`);
      const [row] = await db.query(
        section.sql(db.raw).returnsRow({ rows: 'pg/jsonb@1' }).build(),
      );
      return (row?.rows ?? []) as Record<string, unknown>[];
    }
    const total = (r: Record<string, unknown>[]) =>
      r.reduce((n, x) => n + Number(x.count), 0);

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
    });
    afterAll(async () => {
      await db?.close();
    });
    beforeEach(async () => {
      await db.execute(
        db.raw
          .sql`TRUNCATE job_matches, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs CASCADE`
          .affectedCount()
          .build(),
      );
    });

    it('sections 5 to 8 read listings only, never post rows or role jobs', async () => {
      await extraction(await job('job'), 'listing', fixtureDocument());
      const post = await job('post');
      await extraction(post, 'post', fixtureHiringPost());
      const role = fixtureDocument();
      role.techStack.value!.requirements[0]!.technology = {
        text: 'RoleOnlyTech',
        code: null,
      };
      await extraction(await job('post_role', post), 'listing', role);

      expect(total(await rows('5.'))).toBe(1);
      expect(total(await rows('6.'))).toBe(1);
      expect(total(await rows('7.'))).toBe(1);
      expect((await rows('8.')).map((r) => r.text)).not.toContain(
        'RoleOnlyTech',
      );
    });

    it('section 13 counts post calls, verdicts, role jobs and stuck posts per UTC day', async () => {
      const now = new Date();
      const daysAgo = (n: number, hours = 12) => {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - n);
        d.setUTCHours(hours, 0, 0, 0);
        return d;
      };
      const day = (d: Date) => d.toISOString().slice(0, 10);
      const attempt = (docType: string, evalRun: boolean, at: Date) =>
        db.orm.public.ProcessingAttempt.create({
          jobId: null,
          extractionId: null,
          eval: evalRun,
          step: 'generation',
          docType,
          model: 'm',
          providerRequestId: null,
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          costUsd: '0.5',
          latencyMs: 1,
          outcome: 'ok',
          error: null,
          quoteFailures: 0,
          createdAt: at,
        } as never);
      await attempt('post', false, daysAgo(0));
      await attempt('post', false, daysAgo(0, 1));
      await attempt('post', true, daysAgo(0)); // eval: ignored
      await attempt('listing', false, daysAgo(0)); // listing: ignored
      await attempt('post', false, daysAgo(9)); // outside the window

      const post = await job('post');
      await extraction(post, 'post', fixtureHiringPost());
      await db.orm.public.JobExtraction.where({ jobId: post }).updateAll({
        verdict: 'hiring',
        verdictConfidence: 'sure',
        createdAt: daysAgo(1),
      } as never);
      const role = await job('post_role', post);
      await db.orm.public.NormalizedJob.where({ id: role }).updateAll({
        processedAt: daysAgo(2),
      } as never);
      const stuck = await job('post');
      await db.orm.public.NormalizedJob.where({ id: stuck }).updateAll({
        processingStatus: 'pending',
        firstSeenAt: daysAgo(10),
        lastSeenAt: daysAgo(10),
      } as never);

      const shaped = shapePostExtraction((await rows('13.')) as never, now);
      const by = Object.fromEntries(shaped.map((r) => [r.day, r]));
      expect(by[day(daysAgo(0))]).toMatchObject({ calls: 2, cost_usd: 1 });
      expect(by[day(daysAgo(1))]).toMatchObject({ hiring_sure: 1 });
      expect(by[day(daysAgo(2))]).toMatchObject({ role_jobs: 1 });
      expect(by[day(daysAgo(3))]).toMatchObject({ left_window_pending: 1 });
      expect(shaped.reduce((n, r) => n + r.calls, 0)).toBe(2);
    });
  },
);

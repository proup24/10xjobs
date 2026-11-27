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

    /** A LinkedIn job board (or other channel) source for `jobId`: raw item, version, normalized version, link. */
    async function source(jobId: string, channel = 'LINKEDIN_JOB_BOARD') {
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
      } as never);
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
      } as never);
      const item = await db.orm.public.RawItem.create({
        channel,
        sourceKey: randomUUID(),
        kind: 'job',
        firstSeenAt: t0,
        lastSeenAt: t0,
        latestVersionId: null,
      } as never);
      const version = await db.orm.public.RawItemVersion.create({
        rawItemId: item.id,
        contentHash: randomUUID(),
        payload: {},
        firstBatchId: batch.id,
        firstSeenAt: t0,
        lastSeenAt: t0,
      } as never);
      const normalized = await db.orm.public.NormalizedVersion.create({
        rawVersionId: version.id,
        normalizerVersion: 1,
        status: 'valid',
        reason: null,
        record: {},
        jobKey: randomUUID(),
      } as never);
      await db.orm.public.NormalizedJobSource.create({
        jobId,
        rawItemId: item.id,
        normalizedVersionId: normalized.id,
        linkedAt: t0,
      } as never);
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

    it('sections 5 to 8 read listings and post role jobs split by kind, never post rows', async () => {
      await extraction(await job('job'), 'listing', fixtureDocument());
      const post = await job('post');
      await extraction(post, 'post', fixtureHiringPost());
      const role = fixtureDocument();
      role.techStack.value!.requirements[0]!.technology = {
        text: 'RoleOnlyTech',
        code: null,
      };
      await extraction(await job('post_role', post), 'listing', role);

      const byKind = (r: Record<string, unknown>[]) =>
        Object.fromEntries(
          [...new Set(r.map((x) => x.kind ?? x.job_kind))].map((k) => [
            k,
            total(r.filter((x) => (x.kind ?? x.job_kind) === k)),
          ]),
        );
      for (const n of ['5.', '6.', '7.'])
        expect(byKind(await rows(n))).toEqual({ job: 1, post_role: 1 });
      expect(
        (await rows('8.')).find((r) => r.text === 'RoleOnlyTech'),
      ).toMatchObject({ job_kind: 'post_role' });
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

    it('section 14 counts skipped listings by tag and country, their share of new listings, and samples titles', async () => {
      const now = new Date();
      const skip = async (
        tag: string,
        country: string,
        title: string,
        firstSeenAt: Date = now,
      ) => {
        const id = await job('job');
        await source(id);
        await db.orm.public.NormalizedJob.where({ id }).updateAll({
          processingStatus: 'skipped',
          processingSkip: { version: 1, tag, country },
          title,
          firstSeenAt,
          lastSeenAt: firstSeenAt,
        } as never);
        return id;
      };
      await skip('onsite', 'DE', 'Onsite Dev');
      await skip('hybrid', 'DE', 'Hybrid Dev');
      await skip('onsite', 'DE', 'Old Dev', new Date('2026-01-01T00:00:00Z'));
      const processed = await job('job');
      await source(processed);
      await db.orm.public.NormalizedJob.where({ id: processed }).updateAll({
        firstSeenAt: now,
        lastSeenAt: now,
      } as never);
      // An ATS listing and a merged row never count, skipped or not.
      for (const [channel, status] of [
        ['ASHBY', 'active'],
        ['LINKEDIN_JOB_BOARD', 'merged'],
      ] as const) {
        const other = await job('job');
        await source(other, channel);
        await db.orm.public.NormalizedJob.where({ id: other }).updateAll({
          status,
          mergedIntoId: status === 'merged' ? processed : null,
          firstSeenAt: now,
          lastSeenAt: now,
        } as never);
      }
      const post = await job('post'); // not a listing
      await db.orm.public.NormalizedJob.where({ id: post }).updateAll({
        firstSeenAt: now,
        lastSeenAt: now,
      } as never);

      const all = await rows('14.');
      const part = (p: string) => all.filter((r) => r.part === p);
      expect(
        part('by_tag_country').map((r) => `${r.tag}/${r.country}/${r.count}`),
      ).toEqual(expect.arrayContaining(['onsite/DE/1', 'hybrid/DE/1']));
      expect(part('by_tag_country')).toHaveLength(2);
      expect(part('share')).toEqual([
        expect.objectContaining({ count: 2, share: 0.667 }),
      ]);
      const sample = part('sample');
      expect(sample.map((r) => r.title).sort()).toEqual([
        'Hybrid Dev',
        'Onsite Dev',
      ]);
      expect(sample[0]).toMatchObject({ country: 'DE' });
    });
    it('section 15 splits recorded calls by request count and kind, and counts what the repeats did', async () => {
      const now = new Date();
      const turns = (
        requests: number,
        over: Partial<{
          textReplies: number;
          enforceNudges: number;
          rejections: string[];
          subtype: string;
        }> = {},
      ) => ({
        numTurns: requests + 1,
        subtype: 'success',
        requests,
        textReplies: 0,
        enforceNudges: 0,
        toolCalls: 1,
        rejections: [],
        ...over,
      });
      const attempt = (
        docType: string,
        record: unknown,
        options: { evalRun?: boolean; at?: Date } = {},
      ) =>
        db.orm.public.ProcessingAttempt.create({
          jobId: null,
          extractionId: null,
          eval: options.evalRun ?? false,
          step: 'generation',
          docType,
          model: 'm',
          providerRequestId: null,
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          costUsd: '0.01',
          latencyMs: 1,
          outcome: 'ok',
          error: null,
          quoteFailures: 0,
          turns: record,
          createdAt: options.at ?? now,
        } as never);
      const enumMiss =
        'Output does not match required schema: /openings/0/arrangement/value: must be equal to one of the allowed values';
      await attempt('listing', turns(1));
      await attempt('listing', turns(1));
      await attempt('listing', turns(2, { textReplies: 1, enforceNudges: 1 }));
      await attempt('listing', turns(2, { rejections: [enumMiss] }));
      await attempt(
        'listing',
        turns(3, {
          subtype: 'error_max_turns',
          rejections: [
            enumMiss,
            enumMiss.replace('/openings/0/', '/openings/1/'),
            'Output does not match required schema: /title: must be string',
          ],
        }),
      );
      await attempt('post', turns(1));
      await attempt('listing', null); // no record: ignored
      await attempt('listing', turns(3), { evalRun: true }); // eval: ignored
      await attempt('listing', turns(3), {
        at: new Date(now.getTime() - 9 * 86_400_000),
      }); // outside the window

      const all = await rows('15.');
      const part = (p: string) => all.filter((r) => r.part === p);
      const pick = (r: Record<string, unknown>) =>
        `${r.kind}/${r.key}/${r.count}/${r.share}`;
      expect(part('requests').map(pick)).toEqual([
        'listing/1/2/0.4',
        'listing/2/2/0.4',
        'listing/3/1/0.2',
        'post/1/1/1',
      ]);
      expect(part('multi').map(pick)).toEqual([
        'listing/calls/3/null',
        'listing/with_text_replies/1/0.333',
        'listing/with_enforce_nudges/1/0.333',
        'listing/with_rejections/2/0.667',
      ]);
      expect(part('max_turns').map(pick)).toEqual([
        'listing/error_max_turns/1/0.2',
        'post/error_max_turns/0/0',
      ]);
      // Array indices are normalized, so both openings count as one text.
      expect(part('rejection').map((r) => `${r.key}/${r.count}`)).toEqual([
        '/openings/N/arrangement/value: must be equal to one of the allowed values/3',
        '/title: must be string/1',
      ]);
    });
  },
);

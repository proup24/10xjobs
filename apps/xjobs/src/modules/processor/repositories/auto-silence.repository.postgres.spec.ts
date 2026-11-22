import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { originalAuthorOf } from 'src/modules/admin/post-author';
import type {
  PostAuthor,
  PostDetail,
} from 'src/modules/ingest/normalize/record';
import { PrismaSilencedAuthorsRepository } from 'src/modules/ingest/repositories/silenced-authors.repository';
import { PrismaAutoSilenceRepository } from './auto-silence.repository';

/**
 * Needs PROCESSOR_TEST_DATABASE_URL: a disposable `processor_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables. Specs on
 * that database never run in parallel (vitest.config.mts).
 */
const url = process.env.PROCESSOR_TEST_DATABASE_URL;
const t0 = new Date('2026-11-01T08:00:00.000Z');
const DAY = 24 * 60 * 60_000;

const author = (key: string | null, name = 'Agg Jobs'): PostAuthor => ({
  key,
  name,
  profileUrl: null,
  headline: 'Jobs every day',
  type: 'company',
});

/** A post source by `by`; with `original`, a share of that author's post. */
function source(
  by: PostAuthor,
  original?: PostAuthor | null,
  id = randomUUID(),
): PostDetail {
  return {
    id,
    url: `https://www.linkedin.com/posts/${id}`,
    author: by,
    text: 'look',
    truncated: false,
    attachedUrls: [],
    postedAt: null,
    original:
      original === undefined
        ? null
        : {
            id: `o-${id}`,
            url: null,
            author: original,
            text: '10 jobs inside',
            truncated: false,
            attachedUrls: [],
            postedAt: null,
          },
    links: { emails: [], linkedinJobIds: [], atsPostings: [], other: [] },
  };
}

type Ruling = {
  verdict: string;
  reason: string;
  /** Defaults to `sure`. */
  confidence?: 'sure' | 'unsure';
  docType?: string;
};
const JUNK: Ruling = { verdict: 'junk', reason: 'job_digest' };
const FILLED: Ruling = { verdict: 'not_hiring', reason: 'role_filled' };

describe.skipIf(!url)('AutoSilenceRepository in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaAutoSilenceRepository;
  let silenced: PrismaSilencedAuthorsRepository;

  async function extraction(jobId: string, ruling: Ruling): Promise<string> {
    const row = await db.orm.public.JobExtraction.create({
      jobId,
      inputHash: randomUUID(),
      schemaVersion: 1,
      promptHash: 'p',
      extractionModel: 'm',
      data: {},
      needsReview: false,
      docType: ruling.docType ?? 'post',
      verdict: ruling.docType === 'listing' ? null : ruling.verdict,
      verdictReason: ruling.docType === 'listing' ? null : ruling.reason,
      verdictConfidence:
        ruling.docType === 'listing' ? null : (ruling.confidence ?? 'sure'),
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      costUsd: 0,
    } as never);
    return (row as { id: string }).id;
  }

  /**
   * A post job first seen at `at` whose extractions are `rulings`, the last
   * one current. No rulings: never extracted.
   */
  async function post(
    sources: PostDetail[],
    at: Date,
    rulings: Ruling[],
    over: { processingStatus?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.orm.public.NormalizedJob.create({
      id,
      jobKey: `test:${id}`,
      kind: 'post',
      status: 'active',
      postingUrl: `https://www.linkedin.com/posts/${id}`,
      closed: false,
      fieldSources: {},
      postSources: { sources },
      firstSeenAt: at,
      lastSeenAt: at,
      normalizerVersion: 10,
      processingStatus: over.processingStatus ?? 'processed',
    } as never);
    let current: string | null = null;
    for (const ruling of rulings) current = await extraction(id, ruling);
    if (current)
      await db.execute(
        db.raw
          .sql`UPDATE normalized_jobs SET "currentExtractionId" = ${current}::uuid WHERE id = ${id}::uuid`
          .affectedCount()
          .build(),
      );
    return id;
  }

  /** `n` posts of `sources()` spread evenly from t0 over `days` days. */
  async function posts(
    n: number,
    days: number,
    sources: () => PostDetail[],
    ruling: Ruling | ((i: number) => Ruling) = JUNK,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const at = new Date(
        t0.getTime() + (n === 1 ? 0 : (i * days * DAY) / (n - 1)),
      );
      const r = typeof ruling === 'function' ? ruling(i) : ruling;
      ids.push(await post(sources(), at, [r]));
    }
    return ids;
  }

  const agg = author('company:agg');
  const own = () => [source(agg)];

  /** A role job of `postId` with a qualified match for a new user's profile. */
  async function qualifiedRole(postId: string): Promise<void> {
    const roleId = randomUUID();
    await db.orm.public.NormalizedJob.create({
      id: roleId,
      jobKey: `role:${roleId}`,
      kind: 'post_role',
      status: 'active',
      parentJobId: postId,
      roleKey: 'backend',
      postingUrl: `https://www.linkedin.com/posts/${postId}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: t0,
      lastSeenAt: t0,
      normalizerVersion: 10,
    } as never);
    const extractionId = await extraction(roleId, {
      verdict: '',
      reason: '',
      docType: 'listing',
    });
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
      jobId: roleId,
      extractionId,
      factsHash: 'h1',
      matcherVersion: 1,
      outcome: 'qualified',
      unverified: false,
      reviewRule: null,
      reviewField: null,
      stackScore: '0.5',
      checks: [],
      decidedAt: new Date(),
      profileVersion: profile.matchVersion,
      eligibilityVersion: 0,
    } as never);
  }

  const keys = async () => (await repo.candidates()).map((c) => c.authorKey);

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
    repo = new PrismaAutoSilenceRepository({ db } as DatabaseService);
    silenced = new PrismaSilencedAuthorsRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw
        .sql`TRUNCATE silenced_authors, auto_silence_dismissals, job_matches, profiles, processing_attempts, job_extractions, normalized_job_sources, normalized_jobs CASCADE`
        .affectedCount()
        .build(),
    );
  });

  it('makes a candidate of 10 junk posts over 8 days, with its evidence', async () => {
    await posts(10, 8, own, (i) =>
      i < 7 ? JUNK : { verdict: 'not_hiring', reason: 'job_digest' },
    );
    expect(await repo.candidates()).toEqual([
      {
        authorKey: 'company:agg',
        name: 'Agg Jobs',
        counted: 10,
        firstSeenAt: t0,
        lastSeenAt: new Date(t0.getTime() + 8 * DAY),
        verdicts: { junk: 7, not_hiring: 3 },
      },
    ]);
  });

  it('needs at least 10 counted posts', async () => {
    await posts(9, 8, own);
    expect(await keys()).toEqual([]);
  });

  it('needs at least 7 days from the first to the last post', async () => {
    await posts(10, 6, own);
    expect(await keys()).toEqual([]);
    await post(own(), new Date(t0.getTime() + 7 * DAY), [JUNK]);
    expect(await keys()).toEqual(['company:agg']);
  });

  it('is blocked by a single hiring post', async () => {
    await posts(10, 8, own);
    await post(own(), new Date(t0.getTime() + DAY), [
      { verdict: 'hiring', reason: 'hiring' },
    ]);
    expect(await keys()).toEqual([]);
  });

  it('does not count role_filled posts, which neither block nor reach the threshold', async () => {
    await posts(9, 8, own);
    await post(own(), new Date(t0.getTime() + DAY), [FILLED]);
    expect(await keys()).toEqual([]);
    await post(own(), new Date(t0.getTime() + 2 * DAY), [JUNK]);
    const [c] = await repo.candidates();
    expect(c).toMatchObject({ counted: 10, verdicts: { junk: 10 } });
  });

  it('counts against the original author of a share, never the sharer', async () => {
    const sharer = author('profile:sharer', 'Sam Sharer');
    await posts(10, 8, () => [source(sharer, agg)]);
    expect(await keys()).toEqual(['company:agg']);
  });

  it('counts a post job once per author, however many sources name them', async () => {
    const sharer = author('profile:sharer', 'Sam Sharer');
    await posts(5, 8, () => [source(agg), source(sharer, agg)]);
    expect(await keys()).toEqual([]);
  });

  it('keys authors exactly as originalAuthorOf does', async () => {
    const sharer = author('profile:sharer', 'Sam Sharer');
    const shapes = [
      source(agg),
      source(sharer, agg),
      source(sharer, null),
      source(sharer, author(null)),
    ];
    for (const shape of shapes) {
      await db.execute(
        db.raw.sql`TRUNCATE job_extractions, normalized_jobs CASCADE`
          .affectedCount()
          .build(),
      );
      await posts(10, 8, () => [shape]);
      const expected = originalAuthorOf(shape)?.key;
      expect(await keys()).toEqual(expected ? [expected] : []);
    }
  });

  it('reads only current post extractions of active, unarchived post jobs', async () => {
    await posts(9, 8, own);
    // Hiring once, then re-extracted as junk: counts as junk.
    await post(own(), new Date(t0.getTime() + DAY), [
      { verdict: 'hiring', reason: 'hiring' },
      JUNK,
    ]);
    expect(await keys()).toEqual(['company:agg']);
    await db.execute(
      db.raw.sql`TRUNCATE job_extractions, normalized_jobs CASCADE`
        .affectedCount()
        .build(),
    );
    await posts(9, 8, own);
    // Never extracted, archived, or a listing row: none counts.
    await post(own(), new Date(t0.getTime() + DAY), []);
    await post(own(), new Date(t0.getTime() + DAY), [JUNK], {
      processingStatus: 'archived',
    });
    await post(own(), new Date(t0.getTime() + DAY), [
      { verdict: '', reason: '', docType: 'listing' },
    ]);
    expect(await keys()).toEqual([]);
  });

  it('skips an author already silenced, manually or automatically', async () => {
    await posts(10, 8, own);
    await silenced.silence({
      authorKey: 'company:agg',
      name: null,
      reason: 'agency',
      origin: 'manual',
      evidence: null,
      createdBy: null,
    });
    expect(await keys()).toEqual([]);
    await silenced.unsilence('company:agg', null);
    expect(await keys()).toEqual(['company:agg']);
  });

  it('is blocked when any role job of the author ever qualified', async () => {
    await posts(10, 8, own);
    // A role_filled post's role job qualified before the role was filled.
    const filled = await post(own(), new Date(t0.getTime() + DAY), [FILLED]);
    expect(await keys()).toEqual(['company:agg']);
    await qualifiedRole(filled);
    expect(await keys()).toEqual([]);
  });

  it('counts only sure not-hiring and junk verdicts; an unsure one neither counts nor blocks', async () => {
    await posts(9, 8, own);
    await post(own(), new Date(t0.getTime() + DAY), [
      { ...JUNK, confidence: 'unsure' },
    ]);
    expect(await keys()).toEqual([]);
    await post(own(), new Date(t0.getTime() + 2 * DAY), [JUNK]);
    const [c] = await repo.candidates();
    expect(c).toMatchObject({ counted: 10, verdicts: { junk: 10 } });
  });

  it('is blocked by an unsure hiring verdict too', async () => {
    await posts(10, 8, own);
    await post(own(), new Date(t0.getTime() + DAY), [
      { verdict: 'hiring', reason: 'hiring', confidence: 'unsure' },
    ]);
    expect(await keys()).toEqual([]);
  });

  describe('after the owner removes an automatic silence', () => {
    /** Silences the author automatically, then removes it as the owner; returns when. */
    async function dismiss(key: string): Promise<Date> {
      await silenced.silence({
        authorKey: key,
        name: null,
        reason: 'automatic: not hiring or junk',
        origin: 'automatic',
        evidence: null,
        createdBy: null,
      });
      await silenced.unsilence(key, randomUUID());
      const rows = await db.query(
        db.raw
          .sql`SELECT "dismissedAt" FROM auto_silence_dismissals WHERE "authorKey" = ${key}`
          .returnsRow({ dismissedAt: 'pg/timestamptz-date@1' })
          .build(),
      );
      return rows[0]!.dismissedAt as Date;
    }

    it('is not a candidate on the same evidence, only on 10 new posts over 7 days', async () => {
      await posts(10, 8, own);
      expect(await keys()).toEqual(['company:agg']);
      const at = await dismiss('company:agg');
      expect(await keys()).toEqual([]);
      const after = (days: number) =>
        new Date(at.getTime() + 60_000 + days * DAY);
      for (let i = 0; i < 9; i++) await post(own(), after((i * 8) / 9), [JUNK]);
      expect(await keys()).toEqual([]);
      await post(own(), after(8), [JUNK]);
      const [c] = await repo.candidates();
      expect(c).toMatchObject({
        authorKey: 'company:agg',
        counted: 10,
        firstSeenAt: after(0),
        lastSeenAt: after(8),
      });
    });

    it('leaves no dismissal after a manual un-silence', async () => {
      await posts(10, 8, own);
      await silenced.silence({
        authorKey: 'company:agg',
        name: null,
        reason: 'agency',
        origin: 'manual',
        evidence: null,
        createdBy: null,
      });
      await silenced.unsilence('company:agg', randomUUID());
      expect(await keys()).toEqual(['company:agg']);
    });
  });
});

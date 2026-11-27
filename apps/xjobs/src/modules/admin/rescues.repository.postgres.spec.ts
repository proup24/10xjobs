import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type DatabaseClient } from '@xjobs/database';
import type { DatabaseService } from 'src/database';
import { PrismaRescuesRepository } from './rescues.repository';

/**
 * Needs INGEST_TEST_DATABASE_URL: a disposable `ingest_test` database on
 * 127.0.0.1, migrated to the current contract. Truncates its tables; files on
 * that database run one at a time (see `vitest.config.mts`).
 */
const url = process.env.INGEST_TEST_DATABASE_URL;

describe.skipIf(!url)('rescue reports in PostgreSQL', () => {
  let db: DatabaseClient;
  let repo: PrismaRescuesRepository;
  const userId = randomUUID();

  async function job(title: string): Promise<string> {
    const row = await db.orm.public.NormalizedJob.create({
      jobKey: randomUUID(),
      kind: 'post',
      status: 'active',
      mergedIntoId: null,
      title,
      postingUrl: `https://www.linkedin.com/posts/${randomUUID()}`,
      closed: false,
      fieldSources: {},
      firstSeenAt: new Date('2026-11-20T00:00:00Z'),
      lastSeenAt: new Date('2026-11-20T00:00:00Z'),
      normalizerVersion: 1,
      processingStatus: 'processed',
    } as never);
    return row.id;
  }

  async function rescue(
    jobId: string,
    createdAt: string,
    origin: 'junk' | 'disqualified',
    snapshot: unknown,
    note: string | null,
    undoneAt: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    await db.execute(
      db.raw
        .sql`INSERT INTO post_rescues (id, "userId", "jobId", origin, snapshot, note, "undoneAt", "createdAt", "updatedAt")
          VALUES (${id}::uuid, ${userId}::uuid, ${jobId}::uuid, ${origin}, ${JSON.stringify(snapshot)}::jsonb, NULLIF(${note ?? ''}::text, ''),
            NULLIF(${undoneAt ?? ''}::text, '')::timestamptz, ${createdAt}::timestamptz, ${createdAt}::timestamptz)`
        .affectedCount()
        .build(),
    );
    return id;
  }

  beforeAll(() => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.pathname !== '/ingest_test')
      throw new Error('Use a disposable localhost ingest_test database');
    db = createDatabaseClient({
      url: url!,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 1000,
      slowQueryMs: 60000,
      logQueries: false,
    });
    repo = new PrismaRescuesRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw
        .sql`TRUNCATE post_rescues, normalized_job_sources, normalized_jobs CASCADE`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`INSERT INTO auth.users (id, aud, role, email) VALUES (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@example.com`}) ON CONFLICT (id) DO NOTHING`
        .affectedCount()
        .build(),
    );
    await db.execute(
      db.raw
        .sql`INSERT INTO users (id, "createdAt", "updatedAt") VALUES (${userId}::uuid, now(), now()) ON CONFLICT (id) DO NOTHING`
        .affectedCount()
        .build(),
    );
  });

  it('lists rescues newest first with the snapshot, the job and the user, undone ones included', async () => {
    const a = await job('Post A');
    const b = await job('Post B');
    const junk = {
      verdict: { value: 'junk', confidence: 'sure', reason: 'funnel' },
      extractionId: randomUUID(),
    };
    const dq = {
      profiles: [
        {
          profileId: randomUUID(),
          matchId: randomUUID(),
          matcherVersion: 3,
          failed: [{ rule: 'seniority', outcome: 'fail', reason: 'Seniority' }],
        },
      ],
      extractionId: randomUUID(),
    };
    const older = await rescue(a, '2026-11-26T10:00:00Z', 'junk', junk, 'Real');
    const newer = await rescue(
      b,
      '2026-11-27T10:00:00Z',
      'disqualified',
      dq,
      null,
      '2026-11-27T11:00:00Z',
    );

    const rows = await repo.list(100);

    expect(rows.map((r) => r.id)).toEqual([newer, older]);
    expect(rows[0]).toMatchObject({
      origin: 'disqualified',
      note: null,
      snapshot: dq,
      user: { id: userId },
      job: { id: b, kind: 'post', title: 'Post B' },
    });
    expect(rows[0]!.undoneAt).toEqual(new Date('2026-11-27T11:00:00Z'));
    expect(rows[0]!.createdAt).toEqual(new Date('2026-11-27T10:00:00Z'));
    expect(rows[1]).toMatchObject({
      origin: 'junk',
      note: 'Real',
      snapshot: junk,
      undoneAt: null,
    });
    expect(rows[1]!.job.postingUrl).toMatch(/^https:\/\/www\.linkedin\.com/);
  });

  it('honours the limit', async () => {
    const a = await job('A');
    const b = await job('B');
    await rescue(a, '2026-11-26T10:00:00Z', 'junk', {}, null);
    const newest = await rescue(b, '2026-11-27T10:00:00Z', 'junk', {}, null);
    expect((await repo.list(1)).map((r) => r.id)).toEqual([newest]);
  });
});

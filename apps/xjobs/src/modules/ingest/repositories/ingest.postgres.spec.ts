import { randomUUID } from 'node:crypto';
import { Channel } from 'src/common/enums';
import {
  createDatabaseClient,
  type DatabaseClient,
} from 'src/database/connection.source';
import type { DatabaseService } from 'src/database';
import { PrismaIngestRepository } from './ingest.repository';
import { normalizeItem } from '../utils';
import { IngestIdentityConflict } from '../types';

const url = process.env.INGEST_TEST_DATABASE_URL;
const first = new Date('2026-10-30T10:00:00Z');
const later = new Date('2026-10-30T11:00:00Z');
const older = new Date('2026-10-30T09:00:00Z');
const collected = {
  applyUrl: null,
  title: 'Engineer',
  company: 'Acme',
  location: null,
  postedAt: null,
  postedAtPrecision: 'day',
  description: 'Build APIs',
  contact: null,
  search: 'typescript in Germany',
} as const;
/** A null source ID is sent as blank, which ingest stores as a URL-only identity. */
const item = (externalId: string | null = '123') =>
  normalizeItem(Channel.LINKEDIN_JOB_BOARD, {
    ...collected,
    source: 'linkedin-jobs',
    sourceJobId: externalId ?? '',
    url: 'https://www.linkedin.com/jobs/view/123',
    raw: { id: externalId },
  });

describe.skipIf(!url)('ingest PostgreSQL transactions', () => {
  let db: DatabaseClient;
  let repository: PrismaIngestRepository;
  let queryId: string;
  let otherQueryId: string;

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
    repository = new PrismaIngestRepository({ db } as DatabaseService);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.execute(
      db.raw
        .sql`TRUNCATE raw_jobs, ats_posting_identities, query_search_builder, users CASCADE`
        .affectedCount()
        .build(),
    );
    async function query() {
      const user = await db.orm.public.User.create({
        email: `${randomUUID()}@test.invalid`,
        name: 'Test',
      });
      const profile = await db.orm.public.Profile.create({
        userId: user.id,
        position: 'backend_engineer',
        languages: ['EN'],
        country: 'MA',
        regions: ['GLOBAL'],
        yearsOfExperience: 5,
        timezoneCurrent: 0,
        timezoneMin: 0,
        timezoneMax: 60,
        engagements: ['employee'],
        arrangements: ['remote'],
        seniority: 'senior',
        noticePeriodDays: 0,
      });
      // Builders are shared; a profile uses one through an association row.
      const builder = await db.orm.public.QuerySearchBuilder.create({
        channel: Channel.LINKEDIN_JOB_BOARD,
        locationRegion: 'GLOBAL',
        experience: 'senior',
        technologies: [],
        type: 'remote',
        keyword: 'backend',
        version: 1,
        params: {},
        hash: randomUUID(),
        associatedProfiles: 1,
        isActive: true,
        isDeleted: false,
      });
      await db.orm.public.ProfileQuerySearchBuilder.create({
        profileId: profile.id,
        queryId: builder.id,
      });
      return builder;
    }
    queryId = (await query()).id;
    otherQueryId = (await query()).id;
  });

  it('stores one shared job with attribution to queries belonging to different users', async () => {
    const a = await repository.save(queryId, item(), first);
    const b = await repository.save(otherQueryId, item(), first);
    expect(a.outcome).toBe('inserted');
    expect(b).toEqual({ id: a.id, outcome: 'duplicate' });
    expect(await db.orm.public.RawJob.all()).toHaveLength(1);
    expect(await db.orm.public.RawJobQueryHit.all()).toHaveLength(2);
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).not.toHaveProperty('userId');
  });

  it('promotes URL fallback to source identity without inserting a second row', async () => {
    const a = await repository.save(queryId, item(null), first);
    const b = await repository.save(queryId, item(), later);
    expect(b).toEqual({ id: a.id, outcome: 'updated' });
    expect(await db.orm.public.RawJobIdentity.all()).toHaveLength(2);
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).toMatchObject({ externalId: '123' });
  });

  it('concurrent ingestion remains idempotent with all query hits retained', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repository.save(i % 2 ? queryId : otherQueryId, item(), first),
      ),
    );
    expect(results.filter((r) => r.outcome === 'inserted')).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.orm.public.RawJobQueryHit.all()).toHaveLength(2);
  });

  it('keeps newest content, earliest firstSeenAt, latest lastSeenAt and per-query timestamps', async () => {
    const a = await repository.save(
      queryId,
      { ...item(), description: 'Newest' },
      later,
    );
    await repository.save(otherQueryId, item(), older);
    await repository.save(
      queryId,
      { ...item(), description: 'Equal timestamp replay' },
      later,
    );
    const row = await db.orm.public.RawJob.where({ id: a.id }).first();
    expect(row).toMatchObject({
      description: 'Newest',
      firstSeenAt: older,
      lastSeenAt: later,
    });
    const hit = await db.orm.public.RawJobQueryHit.where({
      queryId: otherQueryId,
    }).first();
    expect(hit).toMatchObject({ firstSeenAt: older, lastSeenAt: older });
  });

  it('serializes concurrent updates without allowing stale content to win', async () => {
    const a = await repository.save(queryId, item(), older);
    await Promise.all([
      repository.save(queryId, { ...item(), description: 'Newest' }, later),
      repository.save(otherQueryId, item(), first),
    ]);
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).toMatchObject({ description: 'Newest', lastSeenAt: later });
  });

  it('rejects conflicting aliases atomically', async () => {
    const a = await repository.save(queryId, item(), first);
    const second = {
      ...item(),
      externalId: '456',
      url: 'https://www.linkedin.com/jobs/view/456',
    };
    await repository.save(queryId, second, first);
    await expect(
      repository.save(otherQueryId, { ...item(), url: second.url }, later),
    ).rejects.toBeInstanceOf(IngestIdentityConflict);
    expect(
      await db.orm.public.RawJobQueryHit.where({ queryId: otherQueryId }).all(),
    ).toHaveLength(0);
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).toMatchObject({ lastSeenAt: first });
    await expect(
      repository.save(otherQueryId, { ...item(), externalId: '789' }, later),
    ).rejects.toBeInstanceOf(IngestIdentityConflict);
  });

  it('associates exact ATS postings across channels without merging their records', async () => {
    const postingId = '12345678-abcd-4000-8000-123456789abc';
    const ats = { provider: 'ashby' as const, tenantKey: 'acme', postingId };
    const a = await repository.save(queryId, { ...item(), ats }, first);
    const query = await db.orm.public.QuerySearchBuilder.where({
      id: otherQueryId,
    }).update({ channel: Channel.ASHBY });
    const b = await repository.save(
      query!.id,
      {
        ...item(),
        channel: Channel.ASHBY,
        externalId: postingId,
        url: `https://jobs.ashbyhq.com/acme/${postingId}`,
        ats,
      },
      first,
    );
    expect(a.id).not.toBe(b.id);
    const rows = await db.orm.public.RawJob.all();
    expect(rows[0]!.atsPostingId).toBe(rows[1]!.atsPostingId);
    expect(await db.orm.public.AtsPostingIdentity.all()).toHaveLength(1);
  });

  it('does not deduplicate jobs solely on title and company', async () => {
    await repository.save(queryId, item(), first);
    await repository.save(
      queryId,
      {
        ...item(),
        externalId: '456',
        url: 'https://www.linkedin.com/jobs/view/456',
      },
      first,
    );
    expect(await db.orm.public.RawJob.all()).toHaveLength(2);
  });

  it('keeps identical native ATS IDs separate across boards', async () => {
    await db.orm.public.QuerySearchBuilder.where({ id: queryId }).update({
      channel: Channel.GREEN_HOUSE,
    });
    for (const tenant of ['acme', 'another']) {
      const job = normalizeItem(Channel.GREEN_HOUSE, {
        ...collected,
        source: 'greenhouse',
        sourceJobId: '123',
        url: `https://boards.greenhouse.io/${tenant}/jobs/123`,
        raw: {},
      });
      await repository.save(queryId, job, first);
    }
    expect(await db.orm.public.RawJob.all()).toHaveLength(2);
    expect(await db.orm.public.AtsPostingIdentity.all()).toHaveLength(2);
  });

  it('promotes a stale URL-only identity without replacing newer content', async () => {
    const a = await repository.save(
      queryId,
      { ...item(null), description: 'Newest' },
      later,
    );
    await repository.save(otherQueryId, item(), older);
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).toMatchObject({
      externalId: '123',
      description: 'Newest',
      firstSeenAt: older,
      lastSeenAt: later,
    });
  });

  it('keeps shared jobs when a lookup query is deleted', async () => {
    const a = await repository.save(queryId, item(), first);
    await db.orm.public.QuerySearchBuilder.where({ id: queryId }).delete();
    expect(
      await db.orm.public.RawJob.where({ id: a.id }).first(),
    ).not.toBeNull();
    expect(await db.orm.public.RawJobQueryHit.all()).toHaveLength(0);
  });
});

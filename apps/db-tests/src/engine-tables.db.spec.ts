import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

const now = '2026-11-03T00:00:00Z';

type Fixture = { table: string; row: () => Record<string, unknown> };

const queryId = randomUUID();
const rawJobId = randomUUID();
const atsId = randomUUID();

// Each row is minimal but valid, so a failed user insert can only be RLS or privileges.
const fixtures: Fixture[] = [
  {
    table: 'query_search_builder',
    row: () => ({
      id: randomUUID(),
      channel: 'ASHBY',
      experience: 'senior',
      technologies: [],
      type: 'remote',
      keyword: 'engineer',
      version: 1,
      params: {},
      hash: randomUUID(),
    }),
  },
  { table: 'profile_query_search_builders', row: () => ({}) },
  {
    table: 'raw_jobs',
    row: () => ({
      id: randomUUID(),
      channel: 'ASHBY',
      kind: 'job',
      url: `https://example.test/${randomUUID()}`,
      description: 'A job',
      raw: {},
      normalizationVersion: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    }),
  },
  { table: 'raw_job_identities', row: () => ({}) },
  { table: 'raw_job_query_hits', row: () => ({}) },
  {
    table: 'ats_posting_identities',
    row: () => ({
      id: randomUUID(),
      provider: 'ashby',
      tenantKey: randomUUID(),
      postingId: randomUUID(),
    }),
  },
];

describe('engine-only tables are hidden from users', () => {
  let user: TestUser;
  let profileId: string;
  const rows = new Map<string, Record<string, unknown>>();
  const cleanup: Array<[string, string]> = [];

  async function adminInsert(table: string, row: Record<string, unknown>) {
    const { error } = await admin().from(table).insert(row);
    if (error) throw new Error(`admin insert into ${table}: ${error.message}`);
    cleanup.push([table, row.id as string]);
  }

  beforeAll(async () => {
    user = await createTestUser();
    // Dependency order: parents first.
    const profile = {
      id: randomUUID(),
      userId: user.id,
      position: 'backend_engineer',
      languages: ['EN'],
      country: 'MA',
      city: 'Rabat',
      regions: ['MENA'],
      yearsOfExperience: 6,
      timezoneCurrent: 60,
      timezoneMin: -240,
      timezoneMax: 240,
      engagements: ['employee'],
      arrangements: ['remote'],
      seniority: 'senior',
      noticePeriodDays: 30,
    };
    await adminInsert('profiles', profile);
    profileId = profile.id;

    const [qsb, pqsb, raw, ident, hit, ats] = fixtures;
    const qRow = { ...qsb.row(), id: queryId };
    const aRow = { ...ats.row(), id: atsId };
    const rRow = { ...raw.row(), id: rawJobId, atsPostingId: atsId };
    const pRow = {
      id: randomUUID(),
      profileId,
      queryId,
    };
    const iRow = {
      id: randomUUID(),
      channel: 'ASHBY',
      identityType: 'url',
      identityValue: `https://example.test/${randomUUID()}`,
      rawJobId,
    };
    const hRow = {
      id: randomUUID(),
      queryId,
      rawJobId,
      firstSeenAt: now,
      lastSeenAt: now,
      observedUrl: 'https://example.test/x',
    };
    await adminInsert(qsb.table, qRow);
    await adminInsert(ats.table, aRow);
    await adminInsert(raw.table, rRow);
    await adminInsert(pqsb.table, pRow);
    await adminInsert(ident.table, iRow);
    await adminInsert(hit.table, hRow);
    rows.set(qsb.table, qRow);
    rows.set(ats.table, aRow);
    rows.set(raw.table, rRow);
    rows.set(pqsb.table, pRow);
    rows.set(ident.table, iRow);
    rows.set(hit.table, hRow);
  });

  afterAll(async () => {
    for (const [table, id] of cleanup.reverse()) {
      await admin().from(table).delete().eq('id', id);
    }
    await cleanupTestUsers();
  });

  describe.each(fixtures.map((f) => f.table))('%s', (table) => {
    it('exists for the admin but returns nothing to a signed-in user', async () => {
      const seen = await admin().from(table).select('id').limit(1);
      expect(seen.error).toBeNull();
      expect(seen.data).toHaveLength(1);

      const { data } = await user.client.from(table).select('*');
      expect(data ?? []).toEqual([]);
    });

    it('rejects an insert of a valid row with a privilege error', async () => {
      const valid = rows.get(table);
      expect(valid).toBeDefined();
      const { error } = await user.client
        .from(table)
        .insert({ ...valid, id: randomUUID() });
      expect(error?.code).toBe('42501');
    });
  });
});

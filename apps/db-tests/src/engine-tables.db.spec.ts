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
const segmentRunId = randomUUID();
const batchId = randomUUID();
const rawItemId = randomUUID();
const versionId = randomUUID();
const companyId = randomUUID();
const jobId = randomUUID();
const extractionId = randomUUID();
const normalizedVersionId = randomUUID();
// Set in beforeAll, before any row() that needs it runs.
let profileId = '';

// Each row is minimal but valid, so a failed user insert can only be RLS or privileges.
// Listed parents first: beforeAll inserts in this order and cleanup runs in reverse.
const fixtures: Fixture[] = [
  {
    table: 'query_search_builder',
    row: () => ({
      id: queryId,
      channel: 'ASHBY',
      location: 'remote',
      experience: 'senior',
      technologies: [],
      domain: 'backend',
      type: 'remote',
      keyword: 'engineer',
      version: 1,
      params: {},
      hash: randomUUID(),
    }),
  },
  {
    table: 'profile_query_search_builders',
    row: () => ({ id: randomUUID(), profileId, queryId }),
  },
  {
    table: 'search_segment_runs',
    row: () => ({
      id: segmentRunId,
      channel: 'ASHBY',
      segmentKey: 'backend|remote|remote',
      segmentHash: randomUUID(),
      queryIds: [queryId],
      windowStart: '2026-11-02T00:00:00Z',
      windowEnd: now,
      startedAt: now,
      finishedAt: now,
      status: 'succeeded',
      fetched: 1,
      capped: false,
      truncatedQueryIds: [],
      perQuery: {},
    }),
  },
  {
    table: 'collection_batches',
    row: () => ({
      id: batchId,
      channel: 'ASHBY',
      segmentRunId,
      storageKey: `batches/${batchId}.json`,
      formatVersion: 1,
      observedAt: now,
      itemCount: 1,
      actor: 'test',
      status: 'pending',
    }),
  },
  {
    table: 'raw_items',
    row: () => ({
      id: rawItemId,
      channel: 'ASHBY',
      sourceKey: randomUUID(),
      kind: 'job',
      firstSeenAt: now,
      lastSeenAt: now,
    }),
  },
  {
    table: 'raw_item_versions',
    row: () => ({
      id: versionId,
      rawItemId,
      contentHash: randomUUID(),
      payload: {},
      firstBatchId: batchId,
      firstSeenAt: now,
      lastSeenAt: now,
    }),
  },
  {
    table: 'normalized_versions',
    row: () => ({
      id: normalizedVersionId,
      rawVersionId: versionId,
      normalizerVersion: 1,
      status: 'valid',
      record: {},
      jobKey: `test:${jobId}`,
    }),
  },
  {
    table: 'companies',
    row: () => ({
      id: companyId,
      linkedinId: `test-${companyId}`,
      industries: [],
      specialities: [],
      firstSeenAt: now,
      lastSeenAt: now,
    }),
  },
  {
    table: 'normalized_jobs',
    row: () => ({
      id: jobId,
      jobKey: `test:${jobId}`,
      kind: 'job',
      status: 'active',
      companyId,
      // The listing-location columns: an unknown column fails the insert.
      city: 'Paris',
      state: 'Île-de-France',
      geoId: '101240143',
      salaryProvidedByEmployer: true,
      postingUrl: 'https://example.test/job',
      closed: false,
      fieldSources: {},
      firstSeenAt: now,
      lastSeenAt: now,
      normalizerVersion: 1,
    }),
  },
  {
    table: 'job_extractions',
    row: () => ({
      id: extractionId,
      jobId,
      inputHash: 'test',
      schemaVersion: 2,
      promptHash: 'test',
      decisionModel: 'test',
      extractionModel: 'test',
      data: {},
      needsReview: false,
      worldwide: false,
      regionCodes: [],
      countryCodes: [],
      cityIds: [],
      techTags: [],
      mainStackTags: [],
      costUsd: 0,
    }),
  },
  {
    table: 'normalized_job_sources',
    row: () => ({
      id: randomUUID(),
      jobId,
      rawItemId,
      normalizedVersionId,
      linkedAt: now,
    }),
  },
  {
    table: 'raw_item_sightings',
    row: () => ({
      id: randomUUID(),
      batchId,
      rawItemId,
      versionId,
      queryId,
      attribution: queryId,
      observedAt: now,
    }),
  },
];

describe('engine-only tables are hidden from users', () => {
  let user: TestUser;
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
      contractTypes: ['full_time'],
      locations: {
        remote: [{ kind: 'region', code: 'MENA' }],
        hybrid: [],
        onsite: [],
      },
      languages: [{ lang: 'en', level: 'fluent' }],
      yearsOfExperience: 6,
      timezoneCurrent: 60,
      timezoneMin: -240,
      timezoneMax: 240,
      engagements: ['employee'],
      seniorities: ['senior'],
      noticePeriodDays: 30,
    };
    await adminInsert('profiles', profile);
    profileId = profile.id;

    for (const fixture of fixtures) {
      const row = fixture.row();
      await adminInsert(fixture.table, row);
      rows.set(fixture.table, row);
    }
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

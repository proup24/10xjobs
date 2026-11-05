import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, anon } from './support/admin.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

const INSUFFICIENT_PRIVILEGE = '42501';

const listColumns = 'code, label, aliases';

/** Tables with a `status` column: only approved rows are readable, and status is hidden. */
const statusTables = [
  { table: 'tech_tags', columns: listColumns },
  { table: 'role_kinds', columns: `${listColumns}, isEngineering` },
  { table: 'seniorities', columns: listColumns },
  { table: 'contract_types', columns: listColumns },
  { table: 'engagements', columns: listColumns },
  { table: 'regions', columns: listColumns },
  { table: 'countries', columns: listColumns },
  {
    table: 'cities',
    columns: 'id, name, countryCode, aliases',
    writeColumn: 'name',
  },
];

/** Tables with no hidden columns: every row is readable. */
const openTables = [
  {
    table: 'region_countries',
    columns: 'regionCode, countryCode',
    writeColumn: 'countryCode',
  },
  { table: 'iso_languages', columns: 'code, label' },
  { table: 'iso_currencies', columns: 'code, label' },
];

const allTables = [...statusTables, ...openTables].map((t) => ({
  writeColumn: 'label',
  ...t,
}));

const proposedTag = `db-test-proposed-${randomUUID()}`;
const proposedCityKey = `db-test-city-${randomUUID()}`;
const approvedCityKey = `db-test-city-${randomUUID()}`;

afterAll(async () => {
  const client = admin();
  await client.from('tech_tags').delete().eq('code', proposedTag);
  await client
    .from('cities')
    .delete()
    .in('nameKey', [proposedCityKey, approvedCityKey]);
  await cleanupTestUsers();
});

describe('value lists, read-only for users', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
    const client = admin();
    const tag = await client.from('tech_tags').insert({
      code: proposedTag,
      label: 'Proposed tag',
      aliases: [],
      implies: [],
      status: 'proposed',
      firstSeenAt: new Date().toISOString(),
    });
    if (tag.error) throw new Error(tag.error.message);
    // Any country will do for the proposed city.
    const country = await client.from('countries').select('code').limit(1);
    // Cities are not pre-seeded, so seed one approved city and one proposed city.
    const cities = await client.from('cities').insert(
      [
        [proposedCityKey, 'proposed'],
        [approvedCityKey, 'approved'],
      ].map(([key, status]) => ({
        id: randomUUID(),
        name: key,
        nameKey: key,
        countryCode: country.data?.[0]?.code,
        aliases: [],
        status,
        firstSeenAt: new Date().toISOString(),
      })),
    );
    if (cities.error) throw new Error(cities.error.message);
  });

  it.each(allTables)(
    '$table: reads rows in the granted columns',
    async ({ table, columns }) => {
      const { data, error } = await user.client.from(table).select(columns);
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
    },
  );

  it('tech_tags: hides the proposed row', async () => {
    const { data, error } = await user.client
      .from('tech_tags')
      .select('code')
      .eq('code', proposedTag);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('cities: hides the proposed row', async () => {
    const { data, error } = await user.client
      .from('cities')
      .select('id')
      .eq('name', proposedCityKey);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(statusTables)(
    '$table: refuses the hidden columns',
    async ({ table }) => {
      for (const column of [
        'status',
        'occurrences',
        'firstSeenAt',
        'approvedAt',
      ]) {
        const { error } = await user.client.from(table).select(column);
        expect(error?.code, `${table}.${column}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    },
  );

  it.each(allTables)(
    '$table: refuses insert, update and delete',
    async ({ table, writeColumn }) => {
      // The row shape is irrelevant: the privilege check comes first.
      const insert = await user.client
        .from(table)
        .insert({ [writeColumn]: 'db-test-write' } as never);
      expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const update = await user.client
        .from(table)
        .update({ [writeColumn]: 'changed' })
        .not(writeColumn, 'is', null);
      expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

      const del = await user.client
        .from(table)
        .delete()
        .not(writeColumn, 'is', null);
      expect(del.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    },
  );

  it.each(allTables)(
    '$table: an anonymous client reads nothing',
    async ({ table, columns }) => {
      const { data, error } = await anon().from(table).select(columns);
      if (error) {
        expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
      } else {
        expect(data).toEqual([]);
      }
    },
  );
});

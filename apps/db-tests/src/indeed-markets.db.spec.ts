import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

type Market = {
  site: string;
  countryCode: string;
  mainRemote: boolean;
  remoteLocation: string;
};

const markets = () =>
  withCatalog(async (c) => {
    const { rows } = await c.query(
      `select site, "countryCode", "mainRemote", "remoteLocation"
       from public.indeed_markets order by site`,
    );
    return rows as Market[];
  });

describe('indeed markets', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser();
  });

  it('seeds 62 markets with five main remote ones', async () => {
    const rows = await markets();
    expect(rows).toHaveLength(62);
    expect(
      rows
        .filter((r) => r.mainRemote)
        .map((r) => r.site)
        .sort(),
    ).toEqual(['br', 'ca', 'pl', 'uk', 'us']);
    expect(rows.every((r) => r.remoteLocation === 'Remote')).toBe(true);
  });

  it('maps uk to GB', async () => {
    const byCode = new Map((await markets()).map((r) => [r.site, r]));
    expect(byCode.get('uk')?.countryCode).toBe('GB');
    expect(byCode.get('ma')?.countryCode).toBe('MA');
  });

  it('authenticated users cannot read markets', async () => {
    const { data, error } = await user.client
      .from('indeed_markets')
      .select('site');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it('a channel column accepts INDEED', async () => {
    const inserted = await withCatalog(async (c) => {
      await c.query('begin');
      try {
        const { rowCount } = await c.query(
          `insert into public.query_search_builder
             (id, channel, location, experience, technologies, domain, type, keyword,
              version, params, hash)
           values ($1, 'INDEED', 'remote', 'senior', '{}', 'backend', 'remote', 'engineer',
                   1, '{}', $2)`,
          [randomUUID(), randomUUID()],
        );
        return rowCount;
      } finally {
        await c.query('rollback');
      }
    });
    expect(inserted).toBe(1);
  });
});

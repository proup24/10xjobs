import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { seedProfile } from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

type Op = { id: string; execute: { sql: string }[] };

/** The recount exactly as the 20261107T0531_builder_recount migration runs it. */
const recountSql = (
  JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../../libs/database/src/migrations/app/20261107T0531_builder_recount/ops.json',
      ),
      'utf8',
    ),
  ) as Op[]
)
  .find((op) => op.id === 'data.query_search_builder_recount')
  ?.execute.map((step) => step.sql)
  .join('\n');

const builder = (state: {
  associatedProfiles: number;
  isActive: boolean;
  isDeleted: boolean;
}) => ({
  id: randomUUID(),
  hash: randomUUID(),
  ...state,
});

describe('builder recount migration', () => {
  it('recounts builders from their profile links, and a second run changes nothing', async () => {
    expect(recountSql).toBeDefined();
    const user = await createTestUser();
    const profileId = await seedProfile(user.id);
    // Used by one profile, but counted as unused.
    const linked = builder({
      associatedProfiles: 0,
      isActive: false,
      isDeleted: false,
    });
    // Its profiles were deleted with their links: the cleanup migration's leftover.
    const orphan = builder({
      associatedProfiles: 2,
      isActive: true,
      isDeleted: false,
    });
    // Deleted builders stay inactive whatever their count.
    const deleted = builder({
      associatedProfiles: 1,
      isActive: false,
      isDeleted: true,
    });
    const ids = [linked.id, orphan.id, deleted.id];

    const { after, secondRun } = await withCatalog(async (c) => {
      await c.query('begin');
      try {
        for (const b of [linked, orphan, deleted])
          await c.query(
            `insert into public.query_search_builder
               (id, channel, location, experience, technologies, domain, type, keyword,
                version, params, hash, "associatedProfiles", "isActive", "isDeleted")
             values ($1, 'ASHBY', 'remote', 'senior', '{}', 'backend', 'remote', 'engineer',
                     1, '{}', $2, $3, $4, $5)`,
            [b.id, b.hash, b.associatedProfiles, b.isActive, b.isDeleted],
          );
        await c.query(
          `insert into public.profile_query_search_builders (id, "profileId", "queryId")
           values ($1, $2, $3)`,
          [randomUUID(), profileId, linked.id],
        );
        await c.query(recountSql as string);
        const after = await c.query(
          `select id, "associatedProfiles", "isActive", "isDeleted"
           from public.query_search_builder where id = any($1::uuid[])`,
          [ids],
        );
        // Idempotent: a second run leaves this test's builders as they are.
        await c.query(recountSql as string);
        const again = await c.query(
          `select id, "associatedProfiles", "isActive", "isDeleted"
           from public.query_search_builder where id = any($1::uuid[])`,
          [ids],
        );
        return { after: after.rows, secondRun: again.rows };
      } finally {
        await c.query('rollback');
      }
    });

    const byId = new Map(after.map((row) => [row.id, row]));
    expect(byId.get(linked.id)).toMatchObject({
      associatedProfiles: 1,
      isActive: true,
    });
    expect(byId.get(orphan.id)).toMatchObject({
      associatedProfiles: 0,
      isActive: false,
    });
    expect(byId.get(deleted.id)).toMatchObject({
      associatedProfiles: 0,
      isActive: false,
      isDeleted: true,
    });
    expect(secondRun).toEqual(expect.arrayContaining(after));
    expect(secondRun).toHaveLength(3);
  });
});

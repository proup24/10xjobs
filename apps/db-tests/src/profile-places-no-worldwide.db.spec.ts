import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { profileFields } from './support/fixtures.js';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';
import type { TestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

const OPS = join(
  __dirname,
  '../../../libs/database/src/migrations/app/20261109T1700_profile_places_no_worldwide/ops.json',
);

/** The one-off UPDATE of the migration, as the SQL the database runs. */
function stripSql(): string {
  const ops = JSON.parse(readFileSync(OPS, 'utf8')) as {
    invariantId?: string;
    execute: { sql: string }[];
  }[];
  const op = ops.find(
    (o) => o.invariantId === 'profile-places-strip-worldwide',
  );
  if (!op) throw new Error('strip op not found in ops.json');
  return op.execute.map((e) => e.sql).join('\n');
}

describe('the migration strips worldwide from existing profiles', () => {
  let a: TestUser;
  beforeAll(async () => {
    a = await createTestUser();
  });

  it('keeps the other places, and leaves a worldwide-only profile alone', async () => {
    const mixed = randomUUID();
    const only = randomUUID();
    const emea = { kind: 'region', code: 'EMEA' };
    const ww = { kind: 'worldwide' };
    const fr = { kind: 'country', code: 'FR' };

    for (const id of [mixed, only]) {
      const { error } = await admin()
        .from('profiles')
        .insert({ id, userId: a.id, ...profileFields() });
      if (error) throw new Error(error.message);
    }

    const rows = await withCatalog(async (c) => {
      await c.query('BEGIN');
      try {
        // Worldwide can no longer be written through the trigger: skip triggers
        // to stage rows as they were before the migration.
        await c.query("SET LOCAL session_replication_role = 'replica'");
        for (const [id, locations] of [
          [mixed, { remote: [ww, emea], hybrid: [ww, fr], onsite: [] }],
          [only, { remote: [ww], hybrid: [], onsite: [] }],
        ] as const) {
          await c.query(
            'UPDATE public.profiles SET locations = $2 WHERE id = $1',
            [id, JSON.stringify(locations)],
          );
        }
        await c.query("SET LOCAL session_replication_role = 'origin'");
        await c.query(stripSql());
        const res = await c.query(
          'SELECT id, locations FROM public.profiles WHERE id = ANY($1)',
          [[mixed, only]],
        );
        return res.rows as { id: string; locations: unknown }[];
      } finally {
        await c.query('ROLLBACK');
      }
    });

    const byId = new Map(rows.map((r) => [r.id, r.locations]));
    expect(byId.get(mixed)).toEqual({
      remote: [emea],
      hybrid: [fr],
      onsite: [],
    });
    expect(byId.get(only)).toEqual({ remote: [ww], hybrid: [], onsite: [] });
  });
});

import { expect, it } from 'vitest';
import { withCatalog } from './support/pg.js';

it('has row level security enabled on every table in public', async () => {
  const names = await withCatalog(async (client) => {
    const { rows } = await client.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    );
    return rows.map((r) => r.relname);
  });
  expect(names, `Tables in public without RLS: ${names.join(', ')}`).toEqual(
    [],
  );
});

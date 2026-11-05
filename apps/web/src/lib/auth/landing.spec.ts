import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/supabase/database.types';
import { landingPath } from './landing';

function fakeClient(rows: { id: string }[]) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
    select,
    limit,
  };
}

describe('landingPath', () => {
  it('sends a user with no profiles to /setup', async () => {
    const { client, from, select, limit } = fakeClient([]);
    expect(await landingPath(client)).toBe('/setup');
    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('id');
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('sends a user with a profile to /', async () => {
    const { client } = fakeClient([{ id: 'p1' }]);
    expect(await landingPath(client)).toBe('/');
  });
});

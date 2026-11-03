import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, stack } from './support/admin.js';
import { ownedTables } from './support/registry.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(cleanupTestUsers);

describe.each(ownedTables)('isolation: $table', (t) => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  const adminRow = async (id: string) => {
    const { data, error } = await admin()
      .from(t.table)
      .select('*')
      .eq('id', id);
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>[];
  };

  it("does not return another user's rows", async () => {
    const bRow = await t.seed(b.id);
    const byId = await a.client.from(t.table).select('*').eq('id', bRow);
    expect(byId.data).toEqual([]);

    const all = await a.client.from(t.table).select('*');
    expect(all.data ?? []).not.toContainEqual(
      expect.objectContaining({ [t.ownerColumn]: b.id }),
    );
  });

  it("does not update another user's row", async () => {
    const bRow = await t.seed(b.id);
    const before = await adminRow(bRow);
    const { data } = await a.client
      .from(t.table)
      .update(t.patch)
      .eq('id', bRow)
      .select();
    expect(data).toEqual([]);
    expect(await adminRow(bRow)).toEqual(before);
  });

  it.skipIf(!t.canDelete)("does not delete another user's row", async () => {
    if (!t.canDelete) return;
    const bRow = await t.seed(b.id);
    await a.client.from(t.table).delete().eq('id', bRow);
    expect(await adminRow(bRow)).toHaveLength(1);
  });

  it.skipIf(!t.insertPayload)(
    'cannot insert a row owned by another user',
    async () => {
      if (!t.insertPayload) return;
      const payload = {
        ...(await t.insertPayload(a.id)),
        [t.ownerColumn]: b.id,
      };
      const { error } = await a.client.from(t.table).insert(payload);
      expect(error).not.toBeNull();
      expect(await adminRow(payload['id'] as string)).toEqual([]);
    },
  );

  it('cannot hand its own row to another user', async () => {
    const aRow = await t.seed(a.id);
    const { error } = await a.client
      .from(t.table)
      .update({ [t.ownerColumn]: b.id })
      .eq('id', aRow);
    expect(error).not.toBeNull();
    const rows = await adminRow(aRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[t.ownerColumn]).toBe(a.id);
  });

  it('lets the owner read, update, insert and delete their own rows', async () => {
    const aRow = await t.seed(a.id);
    const read = await a.client.from(t.table).select('*').eq('id', aRow);
    expect(read.data).toHaveLength(1);

    const updated = await a.client
      .from(t.table)
      .update(t.patch)
      .eq('id', aRow)
      .select();
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(1);
    expect(updated.data?.[0]).toMatchObject(t.patch);

    if (t.insertPayload) {
      const payload = await t.insertPayload(a.id);
      const inserted = await a.client.from(t.table).insert(payload);
      expect(inserted.error).toBeNull();
      expect(await adminRow(payload['id'] as string)).toHaveLength(1);
    }

    if (t.canDelete) {
      const del = await a.client.from(t.table).delete().eq('id', aRow);
      expect(del.error).toBeNull();
      expect(await adminRow(aRow)).toEqual([]);
    }
  });

  it('shows nothing to anon', async () => {
    await t.seed(a.id);
    const { url, anonKey } = stack();
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await anon.from(t.table).select('*');
    expect(data ?? []).toEqual([]);
  });
});

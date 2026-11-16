import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, stack } from './support/admin.js';
import {
  cleanupDetailedJobs,
  profileFields,
  seedProfile,
} from './support/fixtures.js';
import { ownedTables } from './support/registry.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

// Detailed jobs reference the users' profiles, so they go before the users.
afterAll(async () => {
  await cleanupDetailedJobs();
  await cleanupTestUsers();
});

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
      .update(t.patch ?? { [t.ownerColumn]: a.id })
      .eq('id', bRow)
      .select();
    // A read-only table has no UPDATE grant, so the call errors and returns no data.
    expect(data ?? []).toEqual([]);
    expect(await adminRow(bRow)).toEqual(before);
  });

  it("does not delete another user's row", async () => {
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
      expect(error?.code).toBe('42501');
      expect(await adminRow(payload['id'] as string)).toEqual([]);
    },
  );

  it('cannot hand its own row to another user', async () => {
    const aRow = await t.seed(a.id);
    const before = await adminRow(aRow);
    const { error } = await a.client
      .from(t.table)
      .update({ [t.ownerColumn]: b.id })
      .eq('id', aRow);
    // With an UPDATE grant, RLS rejects the new owner with 42501. A read-only
    // table has no UPDATE grant, so PostgREST also answers 42501 (permission
    // denied), not zero rows; the admin read below shows nothing changed.
    if (t.patch) expect(error?.code).toBe('42501');
    const rows = await adminRow(aRow);
    expect(rows).toHaveLength(1);
    if (!t.patch) expect(rows).toEqual(before);
    expect(rows[0]?.[t.ownerColumn]).toBe(a.id);
  });

  it('lets the owner read their own rows', async () => {
    const aRow = await t.seed(a.id);
    const read = await a.client.from(t.table).select('*').eq('id', aRow);
    expect(read.data).toHaveLength(1);
  });

  it.skipIf(t.patch !== null)(
    'keeps a read-only table read-only for its owner',
    async () => {
      const aRow = await t.seed(a.id);
      const before = await adminRow(aRow);
      const updated = await a.client
        .from(t.table)
        .update({ [t.ownerColumn]: a.id })
        .eq('id', aRow)
        .select();
      expect(updated.data ?? []).toEqual([]);
      await a.client.from(t.table).delete().eq('id', aRow);
      expect(await adminRow(aRow)).toEqual(before);
    },
  );

  it.skipIf(t.patch === null)(
    'lets the owner update, insert and delete their own rows',
    async () => {
      if (!t.patch) return;
      const aRow = await t.seed(a.id);
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
    },
  );

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

describe('profiles and skills', () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  it("cannot attach a skill to another user's draft profile", async () => {
    const bProfile = await seedProfile(b.id);
    const id = randomUUID();
    const { error } = await a.client.from('profile_skills').insert({
      id,
      userId: a.id,
      profileId: bProfile,
      technology: 'rust',
      domain: 'backend',
      mastery: 5,
    });
    expect(error?.code).toBe('42501');
    const { data } = await admin()
      .from('profile_skills')
      .select('id')
      .eq('id', id);
    expect(data).toEqual([]);
  });

  it("rejects a skill whose userId is not its profile's owner", async () => {
    const bProfile = await seedProfile(b.id);
    const { error } = await admin().from('profile_skills').insert({
      id: randomUUID(),
      userId: a.id,
      profileId: bProfile,
      technology: 'rust',
      domain: 'backend',
      mastery: 5,
    });
    expect(error).not.toBeNull();
  });

  it('returns the whole draft row from insert().select()', async () => {
    const payload = { id: randomUUID(), userId: a.id, ...profileFields() };
    const { data, error } = await a.client
      .from('profiles')
      .insert(payload)
      .select()
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(payload.id);
    expect(data?.state).toBe('draft');
  });
});

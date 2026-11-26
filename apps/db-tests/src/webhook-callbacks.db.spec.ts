import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin } from './support/admin.js';
import { withCatalog } from './support/pg.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(async () => {
  await cleanupTestUsers();
});

const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};

/** The log of signed callbacks a webhook receives: owners read it, only the engine writes it. */
describe('webhook_callbacks', () => {
  let a: TestUser;
  let b: TestUser;
  let hookA: string;
  let hookB: string;

  const insert = (
    hook: string,
    user: string,
    signature: string,
    result = 'ok',
  ) =>
    withCatalog((c) =>
      c.query(
        `INSERT INTO public.webhook_callbacks ("webhookId", "userId", type, result, signature)
         VALUES ($1, $2, 'ping', $3, $4)`,
        [hook, user, result, signature],
      ),
    );

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    hookA = randomUUID();
    hookB = randomUUID();
    await withCatalog(async (c) => {
      await c.query(
        `INSERT INTO public.webhooks (id, "userId", url) VALUES ($1, $2, 'https://hook.example.com/a'), ($3, $4, 'https://hook.example.com/b')`,
        [hookA, a.id, hookB, b.id],
      );
    });
  });

  it("owner reads own callbacks, not another user's", async () => {
    await insert(hookA, a.id, 'sig-own-a');
    await insert(hookB, b.id, 'sig-own-b');
    const { data, error } = await a.client
      .from('webhook_callbacks')
      .select('userId, signature')
      .in('signature', ['sig-own-a', 'sig-own-b']);
    expect(error).toBeNull();
    expect(data).toEqual([{ userId: a.id, signature: 'sig-own-a' }]);
  });

  it('authenticated cannot insert, update or delete', async () => {
    const ins = await a.client.from('webhook_callbacks').insert({
      webhookId: hookA,
      userId: a.id,
      type: 'ping',
      result: 'ok',
      signature: 'sig-user-insert',
    });
    expect(ins.error).not.toBeNull();
    await insert(hookA, a.id, 'sig-user-write');
    await a.client
      .from('webhook_callbacks')
      .update({ result: 'saved' })
      .eq('signature', 'sig-user-write');
    await a.client
      .from('webhook_callbacks')
      .delete()
      .eq('signature', 'sig-user-write');
    const { data } = await admin()
      .from('webhook_callbacks')
      .select('result')
      .eq('signature', 'sig-user-write');
    expect(data).toEqual([{ result: 'ok' }]);
  });

  it('a duplicate (webhookId, signature) is refused', async () => {
    await insert(hookA, a.id, 'sig-dup');
    expect(await codeOf(() => insert(hookA, a.id, 'sig-dup'))).toBe('23505');
  });

  it('deleting the webhook deletes its callbacks', async () => {
    const hook = randomUUID();
    const u = await createTestUser();
    await withCatalog((c) =>
      c.query(
        `INSERT INTO public.webhooks (id, "userId", url) VALUES ($1, $2, 'https://hook.example.com/c')`,
        [hook, u.id],
      ),
    );
    await insert(hook, u.id, 'sig-cascade');
    await withCatalog((c) =>
      c.query(`DELETE FROM public.webhooks WHERE id = $1`, [hook]),
    );
    const { data } = await admin()
      .from('webhook_callbacks')
      .select('id')
      .eq('signature', 'sig-cascade');
    expect(data).toEqual([]);
  });

  it('result outside the five values is refused', async () => {
    expect(
      await codeOf(() => insert(hookA, a.id, 'sig-bad-result', 'bogus')),
    ).toBe('23514');
  });
});

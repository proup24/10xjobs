import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { anon } from './support/admin.js';
import { withCatalog } from './support/pg.js';
import {
  cleanupTestUsers,
  createTestUser,
  type TestUser,
} from './support/test-users.js';

afterAll(async () => {
  await cleanupTestUsers();
});

// Error codes the web app maps on.
const INVALID_URL = '22023';
const RAISED = 'P0001';

type WebhookRow = {
  id: string;
  userId: string;
  url: string;
  secret: string;
  enabled: boolean;
  enabledSince: Date;
  disabledReason: string | null;
  consecutiveFailures: number;
  updatedAt: Date;
};

type TestRow = {
  id: string;
  kind: string;
  status: string;
  nextAttemptAt: Date;
  profileId: string | null;
  jobId: string | null;
  matchId: string | null;
  trigger: string | null;
};

/**
 * The webhook_* RPCs (spec "Settings"): the only way a signed-in user writes their webhook or
 * asks for a test delivery. Each one acts on auth.uid() alone.
 */
describe('webhook RPCs', () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
  });

  // Every case starts with no webhook for either user.
  beforeEach(async () => {
    await withCatalog((c) =>
      c.query(`DELETE FROM public.webhooks WHERE "userId" = ANY($1)`, [
        [a.id, b.id],
      ]),
    );
  });

  const webhookOf = (userId: string) =>
    withCatalog(async (c) => {
      const { rows } = await c.query<WebhookRow>(
        `SELECT * FROM public.webhooks WHERE "userId" = $1`,
        [userId],
      );
      return rows[0] ?? null;
    });

  /** webhookOf, expecting a row. */
  const webhook = async (userId: string) => {
    const row = await webhookOf(userId);
    if (!row) throw new Error(`No webhook for ${userId}`);
    return row;
  };

  const testsOf = (userId: string) =>
    withCatalog(async (c) => {
      const { rows } = await c.query<TestRow>(
        `SELECT * FROM public.webhook_deliveries
          WHERE "userId" = $1 AND kind = 'test' ORDER BY "createdAt"`,
        [userId],
      );
      return rows;
    });

  /** Moves the user's webhook state, as the engine or time would. */
  const setState = (userId: string, set: string) =>
    withCatalog((c) =>
      c.query(`UPDATE public.webhooks SET ${set} WHERE "userId" = $1`, [
        userId,
      ]),
    );

  const save = (user: TestUser, url: string) =>
    user.client.rpc('webhook_save', { p_url: url });
  const setEnabled = (user: TestUser, enabled: boolean) =>
    user.client.rpc('webhook_set_enabled', { p_enabled: enabled });
  const sendTest = (user: TestUser) => user.client.rpc('webhook_send_test');

  /** save, expecting success. */
  const saved = async (user: TestUser, url: string) => {
    const { error } = await save(user, url);
    expect(error).toBeNull();
    return webhook(user.id);
  };

  it('save creates an enabled webhook with a 43-char secret', async () => {
    const before = Date.now();
    const row = await saved(a, 'https://hook.example.com/a');
    expect(row).toMatchObject({
      userId: a.id,
      url: 'https://hook.example.com/a',
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
    });
    expect(row.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The stack's clock and this process's can differ a little.
    expect(row.enabledSince.getTime()).toBeGreaterThan(before - 10_000);
  });

  it('save rejects http, userinfo, localhost, x.internal, 10.0.0.1, [::1]', async () => {
    const bad = [
      'http://hook.example.com/a',
      'ftp://hook.example.com/a',
      'hook.example.com/a',
      'https://user:pass@hook.example.com/a',
      'https://user@hook.example.com/a',
      'https://localhost/a',
      'https://LOCALHOST:8443/a',
      'https://localhost./a',
      'https://app.localhost/a',
      'https://printer.local/a',
      'https://x.internal/a',
      'https://metadata.google.internal/computeMetadata',
      'https://10.0.0.1/a',
      'https://169.254.169.254/latest',
      'https://127.0.0.1:443/a',
      'https://2130706433/a',
      'https://0x7f.0.0.1/a',
      'https://[::1]/a',
      'https://[fd00::1]:8443/a',
      'https:///a',
      'https://hook.example.com/a b',
      'https://hook.example.com/' + 'x'.repeat(2048),
    ];
    for (const url of bad) {
      const { error } = await save(a, url);
      expect(error?.code, url).toBe(INVALID_URL);
      expect(error?.message, url).toBe('invalid webhook url');
    }
    expect(await webhookOf(a.id)).toBeNull();

    // Ports, queries and IP-looking paths are fine.
    for (const url of [
      'https://hook.example.com:8443/a?x=1#y',
      'https://hooks.example.com/10.0.0.1',
      'HTTPS://Hook.Example.com/a',
    ]) {
      expect((await save(a, url)).error, url).toBeNull();
    }
  });

  it('webhook_url_ok is immutable and judges a URL alone', async () => {
    const rows = await withCatalog(async (c) => {
      const { rows } = await c.query<{ ok: boolean; bad: boolean }>(
        `SELECT public.webhook_url_ok('https://hook.example.com/a') AS ok,
                public.webhook_url_ok('https://10.0.0.1/a') AS bad`,
      );
      return rows;
    });
    expect(rows).toEqual([{ ok: true, bad: false }]);
    const volatility = await withCatalog(async (c) => {
      const { rows } = await c.query<{ provolatile: string }>(
        `SELECT provolatile FROM pg_proc
          WHERE oid = 'public.webhook_url_ok(text)'::regprocedure`,
      );
      return rows[0]?.provolatile;
    });
    expect(volatility).toBe('i');
  });

  it('a URL change resets consecutiveFailures and keeps enabledSince', async () => {
    await saved(a, 'https://hook.example.com/a');
    await setState(
      a.id,
      `"consecutiveFailures" = 3, "enabledSince" = now() - interval '1 day'`,
    );
    const before = await webhook(a.id);

    const same = await saved(a, 'https://hook.example.com/a');
    expect(same.consecutiveFailures).toBe(3);

    const changed = await saved(a, 'https://hook.example.com/b');
    expect(changed).toMatchObject({
      id: before.id,
      url: 'https://hook.example.com/b',
      consecutiveFailures: 0,
      secret: before.secret,
      enabled: true,
    });
    expect(changed.enabledSince).toEqual(before.enabledSince);
  });

  it('turning on moves enabledSince and clears disabledReason', async () => {
    await saved(a, 'https://hook.example.com/a');
    await setState(
      a.id,
      `enabled = false, "disabledReason" = 'failing', "consecutiveFailures" = 5,
       "enabledSince" = now() - interval '1 day'`,
    );
    const before = await webhook(a.id);

    expect((await setEnabled(a, true)).error).toBeNull();
    const after = await webhook(a.id);
    expect(after).toMatchObject({
      enabled: true,
      disabledReason: null,
      consecutiveFailures: 0,
    });
    expect(after.enabledSince.getTime()).toBeGreaterThan(
      before.enabledSince.getTime(),
    );

    // Already on: nothing moves.
    await setState(a.id, `"enabledSince" = now() - interval '1 hour'`);
    const on = await webhook(a.id);
    expect((await setEnabled(a, true)).error).toBeNull();
    expect((await webhook(a.id)).enabledSince).toEqual(on.enabledSince);
  });

  it('turning off records user', async () => {
    await saved(a, 'https://hook.example.com/a');
    expect((await setEnabled(a, false)).error).toBeNull();
    expect(await webhook(a.id)).toMatchObject({
      enabled: false,
      disabledReason: 'user',
    });

    // Already off (the engine turned it off): the engine's reason stays.
    await setState(a.id, `"disabledReason" = 'failing'`);
    expect((await setEnabled(a, false)).error).toBeNull();
    expect((await webhook(a.id)).disabledReason).toBe('failing');
  });

  it('rotate changes the secret', async () => {
    const before = await saved(a, 'https://hook.example.com/a');
    expect((await a.client.rpc('webhook_rotate_secret')).error).toBeNull();
    const after = await webhook(a.id);
    expect(after.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(after.secret).not.toBe(before.secret);
    expect(after.url).toBe(before.url);
  });

  it('delete removes the webhook and its deliveries', async () => {
    await saved(a, 'https://hook.example.com/a');
    expect((await sendTest(a)).error).toBeNull();
    expect((await a.client.rpc('webhook_delete')).error).toBeNull();
    expect(await webhookOf(a.id)).toBeNull();
    expect(await testsOf(a.id)).toEqual([]);
  });

  it('send_test creates one pending test delivery', async () => {
    await saved(a, 'https://hook.example.com/a');
    const { data, error } = await sendTest(a);
    expect(error).toBeNull();
    const rows = await testsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: data,
      kind: 'test',
      status: 'pending',
      profileId: null,
      jobId: null,
      matchId: null,
      trigger: null,
    });
  });

  it('send_test twice within 10 s raises too soon', async () => {
    await saved(a, 'https://hook.example.com/a');
    expect((await sendTest(a)).error).toBeNull();
    const second = await sendTest(a);
    expect(second.error?.code).toBe(RAISED);
    expect(second.error?.message).toBe('too soon');
    expect(await testsOf(a.id)).toHaveLength(1);

    // Ten seconds later it works again.
    await withCatalog((c) =>
      c.query(
        `UPDATE public.webhook_deliveries SET "createdAt" = now() - interval '11 seconds'
          WHERE "userId" = $1`,
        [a.id],
      ),
    );
    expect((await sendTest(a)).error).toBeNull();
    expect(await testsOf(a.id)).toHaveLength(2);
  });

  it('send_test when off raises webhook off', async () => {
    const none = await sendTest(a);
    expect(none.error?.code).toBe(RAISED);
    expect(none.error?.message).toBe('webhook off');

    await saved(a, 'https://hook.example.com/a');
    expect((await setEnabled(a, false)).error).toBeNull();
    const off = await sendTest(a);
    expect(off.error?.code).toBe(RAISED);
    expect(off.error?.message).toBe('webhook off');
    expect(await testsOf(a.id)).toEqual([]);
  });

  it("user A's RPCs never touch user B's row", async () => {
    const bRow = await saved(b, 'https://hook.example.com/b');
    await setState(b.id, `"consecutiveFailures" = 2`);
    const bBefore = await webhook(b.id);

    await saved(a, 'https://hook.example.com/a');
    await setEnabled(a, false);
    await setEnabled(a, true);
    await a.client.rpc('webhook_rotate_secret');
    await sendTest(a);
    await a.client.rpc('webhook_delete');
    // Extra arguments naming B are not part of any signature.
    const named = await a.client.rpc('webhook_save', {
      p_url: 'https://evil.example.com/',
      p_user_id: b.id,
    });
    expect(named.error).not.toBeNull();

    expect(await webhook(b.id)).toEqual(bBefore);
    expect(bBefore.id).toBe(bRow.id);
    expect(await testsOf(b.id)).toEqual([]);
  });

  it('anon can call none of them, and nothing is written', async () => {
    const client = anon();
    for (const [fn, args] of [
      ['webhook_url_ok', { p_url: 'https://hook.example.com/' }],
      ['webhook_save', { p_url: 'https://hook.example.com/' }],
      ['webhook_set_enabled', { p_enabled: true }],
      ['webhook_rotate_secret', undefined],
      ['webhook_delete', undefined],
      ['webhook_send_test', undefined],
    ] as const) {
      const { error } = await client.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
  });

  it('each runs as its owner with a pinned search_path, for authenticated only', async () => {
    const rows = await withCatalog(async (c) => {
      const { rows } = await c.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
        anon: boolean;
        authenticated: boolean;
        public: boolean;
      }>(
        `SELECT proname, prosecdef, proconfig,
                has_function_privilege('anon', oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated,
                coalesce(
                  (SELECT bool_or(x.grantee = 0) FROM aclexplode(proacl) x), true
                ) AS public
           FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('webhook_url_ok', 'webhook_save', 'webhook_set_enabled',
                            'webhook_rotate_secret', 'webhook_delete', 'webhook_send_test')
          ORDER BY proname`,
      );
      return rows;
    });
    expect(rows.map((r) => r.proname)).toEqual([
      'webhook_delete',
      'webhook_rotate_secret',
      'webhook_save',
      'webhook_send_test',
      'webhook_set_enabled',
      'webhook_url_ok',
    ]);
    for (const row of rows) {
      expect(row, row.proname).toMatchObject({
        prosecdef: true,
        proconfig: ['search_path=public'],
        anon: false,
        authenticated: true,
        public: false,
      });
    }
  });

  it('raises when called without a signed-in user', async () => {
    const code = await withCatalog(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`SET LOCAL ROLE authenticated`);
        await c.query(`SELECT set_config('request.jwt.claims', '{}', true)`);
        await c.query(
          `SELECT public.webhook_save('https://hook.example.com/')`,
        );
        return null;
      } catch (error) {
        return (error as { code?: string }).code;
      } finally {
        await c.query('ROLLBACK');
      }
    });
    expect(code).toBe('42501');
  });
});

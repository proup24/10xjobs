import { afterAll, describe, expect, it } from 'vitest';
import { anon } from './support/admin.js';
import { withCatalog } from './support/pg.js';
import { cleanupTestUsers, createTestUser } from './support/test-users.js';

afterAll(cleanupTestUsers);

describe('session limit', () => {
  it('removes a session older than 7 days, so its refresh fails', async () => {
    const old = await createTestUser();
    const fresh = await createTestUser();
    await withCatalog((c) =>
      c.query(
        `update auth.sessions set created_at = now() - interval '7 days 1 minute' where user_id = $1`,
        [old.id],
      ),
    );
    await withCatalog((c) => c.query('select public.end_expired_sessions()'));
    expect((await old.client.auth.refreshSession()).error).not.toBeNull();
    expect((await fresh.client.auth.refreshSession()).error).toBeNull();
  });

  it('is scheduled hourly', async () => {
    const { rows } = await withCatalog((c) =>
      c.query(
        `select schedule, command from cron.job where jobname = 'end-expired-sessions'`,
      ),
    );
    expect(rows).toEqual([
      {
        schedule: '0 * * * *',
        command: 'select public.end_expired_sessions()',
      },
    ]);
  });

  it('cannot be called by a signed-in user or anon', async () => {
    const a = await createTestUser();
    expect((await a.client.rpc('end_expired_sessions')).error?.code).toBe(
      '42501',
    );
    expect((await anon().rpc('end_expired_sessions')).error?.code).toBe(
      '42501',
    );
  });
});

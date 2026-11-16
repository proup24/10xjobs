import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withCatalog } from './support/pg.js';
import {
  addExtraction,
  cleanupDetailedJobs,
  detailedDocument,
  publishProfile,
  seedDetailedJob,
  seedMatchOn,
  seedProfile,
  type SeededJob,
} from './support/fixtures.js';
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

// Postgres' insufficient_privilege.
const DENIED = '42501';

type Delivery = {
  id: string;
  userId: string;
  webhookId: string;
  kind: string;
  profileId: string;
  jobId: string;
  matchId: string;
  trigger: string;
  status: string;
  attempts: number;
  payload: unknown;
};

/**
 * The send rules (spec "What gets sent"): `webhook_enqueue_match` creates one delivery per
 * (profile, job) for a new job while the user's webhook is on, and the review trigger runs
 * the same rules when the user approves a review.
 */
describe('webhooks, webhook_deliveries and webhook_enqueue_match', () => {
  let a: TestUser;
  let b: TestUser;
  let profileA: string;
  let webhookA: string;

  beforeAll(async () => {
    a = await createTestUser();
    b = await createTestUser();
    profileA = await seedProfile(a.id);
    await publishProfile(profileA);
    webhookA = randomUUID();
    await withCatalog((c) =>
      c.query(
        `INSERT INTO public.webhooks (id, "userId", url) VALUES ($1, $2, 'https://hook.example.com/a')`,
        [webhookA, a.id],
      ),
    );
  });

  // Every case starts from: profile published 3 days ago, webhook on since 2 days ago.
  beforeEach(async () => {
    await withCatalog(async (c) => {
      await c.query(
        `UPDATE public.profiles SET "publishedAt" = now() - interval '3 days' WHERE id = $1`,
        [profileA],
      );
      await c.query(
        `UPDATE public.webhooks
            SET enabled = true, "disabledReason" = NULL, "enabledSince" = now() - interval '2 days'
          WHERE id = $1`,
        [webhookA],
      );
    });
  });

  /** Moves a job's first (and last) sighting to `ago` before now. */
  const seenAgo = (jobId: string, ago: string) =>
    withCatalog((c) =>
      c.query(
        `UPDATE public.normalized_jobs
            SET "firstSeenAt" = now() - $2::interval, "lastSeenAt" = now()
          WHERE id = $1`,
        [jobId, ago],
      ),
    );

  /** A job first seen `ago` before now and A's match on it. */
  const matchOn = async (
    ago = '1 hour',
    outcome: 'qualified' | 'review' = 'qualified',
  ): Promise<{ job: SeededJob; matchId: string }> => {
    const job = await seedDetailedJob({ noFacts: true });
    await seenAgo(job.jobId, ago);
    const matchId = await seedMatchOn(a.id, profileA, job, {
      outcome,
      review:
        outcome === 'review'
          ? { rule: 'seniority', field: 'seniority' }
          : undefined,
    });
    return { job, matchId };
  };

  const enqueue = (matchId: string, trigger = 'decision') =>
    withCatalog(async (c) => {
      const { rows } = await c.query<{ id: string | null }>(
        `SELECT public.webhook_enqueue_match($1, $2) AS id`,
        [matchId, trigger],
      );
      return rows[0]?.id ?? null;
    });

  /** enqueue, expecting a new delivery; returns its id. */
  const enqueued = async (matchId: string) => {
    const id = await enqueue(matchId);
    if (!id) throw new Error(`No delivery for match ${matchId}`);
    return id;
  };

  const deliveriesOf = (jobId: string) =>
    withCatalog(async (c) => {
      const { rows } = await c.query<Delivery>(
        `SELECT * FROM public.webhook_deliveries WHERE "jobId" = $1 ORDER BY "createdAt"`,
        [jobId],
      );
      return rows;
    });

  it('creates one pending delivery for a new qualified job', async () => {
    const m = await matchOn();
    const id = await enqueued(m.matchId);
    const rows = await deliveriesOf(m.job.jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      userId: a.id,
      webhookId: webhookA,
      kind: 'match',
      profileId: profileA,
      matchId: m.matchId,
      trigger: 'decision',
      status: 'pending',
      attempts: 0,
      payload: null,
    });
  });

  it('a second call creates nothing', async () => {
    const m = await matchOn();
    expect(await enqueue(m.matchId)).not.toBeNull();
    expect(await enqueue(m.matchId)).toBeNull();
    expect(await enqueue(m.matchId, 'review')).toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toHaveLength(1);
  });

  it('skips a job first seen before the profile was published', async () => {
    await withCatalog((c) =>
      c.query(
        `UPDATE public.profiles SET "publishedAt" = now() - interval '1 hour' WHERE id = $1`,
        [profileA],
      ),
    );
    const m = await matchOn('2 hours');
    expect(await enqueue(m.matchId)).toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toEqual([]);
  });

  it('skips a job first seen before enabledSince', async () => {
    const m = await matchOn('3 days');
    expect(await enqueue(m.matchId)).toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toEqual([]);
  });

  it('re-enabling skips jobs seen while off', async () => {
    const m = await matchOn('1 hour');
    // Turned off, then on again after the job was first seen.
    await withCatalog((c) =>
      c.query(
        `UPDATE public.webhooks SET enabled = true, "enabledSince" = now() WHERE id = $1`,
        [webhookA],
      ),
    );
    expect(await enqueue(m.matchId)).toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toEqual([]);
  });

  it('skips when the webhook is off or missing', async () => {
    const off = await matchOn();
    await withCatalog((c) =>
      c.query(
        `UPDATE public.webhooks SET enabled = false, "disabledReason" = 'user' WHERE id = $1`,
        [webhookA],
      ),
    );
    expect(await enqueue(off.matchId)).toBeNull();
    expect(await deliveriesOf(off.job.jobId)).toEqual([]);

    // B has a published profile and no webhook.
    const profileB = await seedProfile(b.id);
    await publishProfile(profileB);
    await withCatalog((c) =>
      c.query(
        `UPDATE public.profiles SET "publishedAt" = now() - interval '3 days' WHERE id = $1`,
        [profileB],
      ),
    );
    const job = await seedDetailedJob({ noFacts: true });
    await seenAgo(job.jobId, '1 hour');
    const matchB = await seedMatchOn(b.id, profileB, job);
    expect(await enqueue(matchB)).toBeNull();
    expect(await deliveriesOf(job.jobId)).toEqual([]);
  });

  /** A merged into B: A's job and its target B, each with a qualified match of A's profile. */
  const mergedPair = async () => {
    const merged = await seedDetailedJob({ status: 'merged', noFacts: true });
    const target = await withCatalog(async (c) => {
      const { rows } = await c.query<{ mergedIntoId: string }>(
        `SELECT "mergedIntoId" FROM public.normalized_jobs WHERE id = $1`,
        [merged.jobId],
      );
      const target = rows[0]?.mergedIntoId;
      if (!target) throw new Error('The merged job has no target');
      return target;
    });
    const targetJob = await addExtraction(target, detailedDocument(), 'senior');
    await seenAgo(merged.jobId, '1 hour');
    await seenAgo(target, '1 hour');
    return {
      a: await seedMatchOn(a.id, profileA, merged),
      b: await seedMatchOn(a.id, profileA, targetJob),
      aJob: merged.jobId,
      bJob: target,
    };
  };

  it('skips B when A was sent and A merged into B', async () => {
    const p = await mergedPair();
    expect(await enqueue(p.a)).not.toBeNull();
    expect(await enqueue(p.b)).toBeNull();
    expect(await deliveriesOf(p.bJob)).toEqual([]);
  });

  it('skips A when B was sent and A merged into B', async () => {
    const p = await mergedPair();
    expect(await enqueue(p.b)).not.toBeNull();
    expect(await enqueue(p.a)).toBeNull();
    expect(await deliveriesOf(p.aJob)).toEqual([]);
  });

  const review = (
    m: { job: SeededJob; matchId: string },
    choice: 'qualified' | 'rejected',
  ) =>
    a.client.from('match_reviews').insert({
      userId: a.id,
      profileId: profileA,
      matchId: m.matchId,
      jobId: m.job.jobId,
      choice,
      rule: 'seniority',
      field: 'seniority',
    });

  it('an approved review creates a delivery with trigger review', async () => {
    const m = await matchOn('1 hour', 'review');
    expect((await review(m, 'qualified')).error).toBeNull();
    const rows = await deliveriesOf(m.job.jobId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'match',
      matchId: m.matchId,
      trigger: 'review',
      status: 'pending',
      payload: null,
    });
  });

  it('a rejected review creates nothing', async () => {
    const m = await matchOn('1 hour', 'review');
    expect((await review(m, 'rejected')).error).toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toEqual([]);
  });

  it('an authenticated user cannot call webhook_enqueue_match', async () => {
    const m = await matchOn();
    for (const role of ['authenticated', 'anon']) {
      const code = await withCatalog(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`SET LOCAL ROLE ${role}`);
          await c.query(`SELECT public.webhook_enqueue_match($1, 'decision')`, [
            m.matchId,
          ]);
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        } finally {
          await c.query('ROLLBACK');
        }
      });
      expect(code, role).toBe(DENIED);
    }
    const { error } = await a.client.rpc('webhook_enqueue_match', {
      p_match_id: m.matchId,
      p_trigger: 'decision',
    });
    expect(error).not.toBeNull();
    expect(await deliveriesOf(m.job.jobId)).toEqual([]);
  });

  it('runs as its owner with a pinned search_path', async () => {
    const rows = await withCatalog(async (c) => {
      const { rows } = await c.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `SELECT proname, prosecdef, proconfig FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('webhook_enqueue_match', 'match_reviews_webhook')
          ORDER BY proname`,
      );
      return rows;
    });
    expect(rows).toEqual([
      {
        proname: 'match_reviews_webhook',
        prosecdef: true,
        proconfig: ['search_path=public'],
      },
      {
        proname: 'webhook_enqueue_match',
        prosecdef: true,
        proconfig: ['search_path=public'],
      },
    ]);
  });

  it('owners read their webhook and deliveries; others read neither', async () => {
    const m = await matchOn();
    const id = await enqueued(m.matchId);

    const own = await a.client.from('webhooks').select('id, secret');
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    // 32 random bytes, base64url without padding.
    expect(own.data?.[0]?.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ownDelivery = await a.client
      .from('webhook_deliveries')
      .select('id')
      .eq('id', id);
    expect(ownDelivery.data).toHaveLength(1);

    const other = await b.client
      .from('webhooks')
      .select('id')
      .eq('id', webhookA);
    expect(other.data ?? []).toEqual([]);
    const otherDelivery = await b.client
      .from('webhook_deliveries')
      .select('id')
      .eq('id', id);
    expect(otherDelivery.data ?? []).toEqual([]);
  });

  it('owners cannot write their webhook or deliveries directly', async () => {
    const m = await matchOn();
    const id = await enqueued(m.matchId);

    await a.client
      .from('webhooks')
      .update({ enabledSince: new Date(0).toISOString() })
      .eq('id', webhookA);
    await a.client
      .from('webhook_deliveries')
      .update({ status: 'delivered' })
      .eq('id', id);
    await a.client.from('webhook_deliveries').delete().eq('id', id);
    const inserted = await a.client.from('webhooks').insert({
      id: randomUUID(),
      userId: a.id,
      url: 'https://hook.example.com/other',
    });
    expect(inserted.error).not.toBeNull();

    const state = await withCatalog(async (c) => {
      const { rows } = await c.query<{ enabledSince: Date; status: string }>(
        `SELECT w."enabledSince", d.status
           FROM public.webhooks w JOIN public.webhook_deliveries d ON d."webhookId" = w.id
          WHERE d.id = $1`,
        [id],
      );
      return rows;
    });
    expect(state).toEqual([
      { enabledSince: expect.any(Date), status: 'pending' },
    ]);
    expect(state[0]?.enabledSince.getTime()).toBeGreaterThan(0);
  });

  it('refuses a bad url, disabledReason, kind, trigger or status', async () => {
    const refused = (sql: string, params: unknown[]) =>
      withCatalog(async (c) => {
        try {
          await c.query(sql, params);
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        }
      });
    const CHECK = '23514';
    expect(
      await refused(
        `UPDATE public.webhooks SET url = 'https://h.example/' || repeat('x', 2048) WHERE id = $1`,
        [webhookA],
      ),
    ).toBe(CHECK);
    expect(
      await refused(
        `UPDATE public.webhooks SET "disabledReason" = 'other' WHERE id = $1`,
        [webhookA],
      ),
    ).toBe(CHECK);
    const insert = (kind: string, trigger: string | null, status: string) =>
      refused(
        `INSERT INTO public.webhook_deliveries ("userId", "webhookId", kind, trigger, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [a.id, webhookA, kind, trigger, status],
      );
    expect(await insert('other', null, 'pending')).toBe(CHECK);
    expect(await insert('test', 'other', 'pending')).toBe(CHECK);
    expect(await insert('test', null, 'other')).toBe(CHECK);
    // A match row needs its profile, job, match and trigger.
    expect(await insert('match', 'decision', 'pending')).toBe(CHECK);
    expect(await insert('test', null, 'pending')).toBeNull();
  });
});

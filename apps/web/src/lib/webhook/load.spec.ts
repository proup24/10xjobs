import { describe, expect, it, vi } from 'vitest';
import { loadWebhook } from './load';

type Result = { data: unknown; error: unknown };

/** A query builder that records its calls and resolves to `result`. */
function query(result: Result) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'order', 'limit', 'eq']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => {
    calls.push(['maybeSingle']);
    return result;
  };
  builder.then = (resolve: (r: Result) => unknown) => resolve(result);
  return { builder, calls };
}

const P1 = '11111111-1111-4111-8111-111111111111';
const J1 = '22222222-2222-4222-8222-222222222222';
const J2 = '33333333-3333-4333-8333-333333333333';
const M1 = '44444444-4444-4444-8444-444444444444';

const WEBHOOK = {
  id: 'w1',
  url: 'https://hooks.example.com/a',
  secret: 's'.repeat(43),
  enabled: true,
  disabledReason: null,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
};

const delivery = (over: Record<string, unknown>) => ({
  id: 'd',
  kind: 'match',
  profileId: P1,
  jobId: J1,
  matchId: M1,
  status: 'delivered',
  attempts: 1,
  lastStatusCode: 200,
  lastError: null,
  createdAt: '2026-11-16T10:02:00Z',
  payloadTitle: null,
  payloadCompany: null,
  ...over,
});

function client(opts: {
  webhook: Result;
  deliveries?: Result;
  matches?: Result;
  reviews?: Result;
  callbacks?: Result;
}) {
  const webhooks = query(opts.webhook);
  const deliveries = query(opts.deliveries ?? { data: [], error: null });
  const callbacks = query(opts.callbacks ?? { data: null, error: null });
  const rpc = vi.fn(
    async (_name: string, args: { p_outcome: string }) =>
      (args.p_outcome === 'review' ? opts.reviews : opts.matches) ?? {
        data: [],
        error: null,
      },
  );
  const tables: string[] = [];
  const supabase = {
    from: (table: string) => {
      tables.push(table);
      if (table === 'webhook_callbacks') return callbacks.builder;
      return table === 'webhooks' ? webhooks.builder : deliveries.builder;
    },
    rpc,
  } as never;
  return { supabase, webhooks, deliveries, callbacks, rpc, tables };
}

describe('loadWebhook', () => {
  it('lastCallbackAt is the newest callback receivedAt, null with none', async () => {
    const some = client({
      webhook: { data: WEBHOOK, error: null },
      callbacks: {
        data: { receivedAt: '2026-11-25T10:00:00Z' },
        error: null,
      },
    });
    const r = await loadWebhook(some.supabase);
    expect(r.webhook?.lastCallbackAt).toBe('2026-11-25T10:00:00Z');
    expect(some.callbacks.calls).toContainEqual([
      'order',
      'receivedAt',
      { ascending: false },
    ]);
    expect(some.callbacks.calls).toContainEqual(['limit', 1]);
    const none = client({ webhook: { data: WEBHOOK, error: null } });
    expect(
      (await loadWebhook(none.supabase)).webhook?.lastCallbackAt,
    ).toBeNull();
  });

  it('returns null webhook when none', async () => {
    const c = client({ webhook: { data: null, error: null } });
    expect(await loadWebhook(c.supabase)).toEqual({
      webhook: null,
      deliveries: [],
    });
    // Deliveries cascade with the webhook: nothing else to read.
    expect(c.tables).toEqual(['webhooks']);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('orders deliveries newest first, limit 50', async () => {
    const c = client({
      webhook: { data: WEBHOOK, error: null },
      deliveries: { data: [], error: null },
    });
    const r = await loadWebhook(c.supabase);
    expect(r.webhook).toEqual({ ...WEBHOOK, lastCallbackAt: null });
    expect(c.tables).toEqual([
      'webhooks',
      'webhook_deliveries',
      'webhook_callbacks',
    ]);
    expect(c.deliveries.calls).toContainEqual([
      'order',
      'createdAt',
      { ascending: false },
    ]);
    expect(c.deliveries.calls).toContainEqual(['limit', 50]);
    // No match rows: no job read.
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('joins title, company and the profile label to match rows', async () => {
    const c = client({
      webhook: { data: WEBHOOK, error: null },
      deliveries: {
        data: [
          delivery({ id: 'a', createdAt: '2026-11-16T10:02:00Z' }),
          // The match row is gone: found by profile and job instead.
          delivery({
            id: 'b',
            jobId: J2,
            matchId: null,
            createdAt: '2026-11-10T09:00:00Z',
          }),
          // No longer a match: no title.
          delivery({
            id: 'c',
            jobId: '55555555-5555-4555-8555-555555555555',
            matchId: null,
            createdAt: '2026-11-09T09:00:00Z',
          }),
          delivery({
            id: 't',
            kind: 'test',
            profileId: null,
            jobId: null,
            matchId: null,
            createdAt: '2026-11-08T09:00:00Z',
          }),
        ],
        error: null,
      },
      matches: {
        data: [
          {
            matchId: M1,
            profileId: P1,
            jobId: J1,
            title: 'Senior Backend Engineer',
            companyName: 'Acme',
          },
          {
            matchId: 'other',
            profileId: P1,
            jobId: J2,
            title: 'Platform Engineer',
            companyName: null,
          },
        ],
        error: null,
      },
    });
    const r = await loadWebhook(c.supabase, { [P1]: 'Backend engineer' });
    // A matched job was last seen within 30 days before its delivery was created.
    for (const outcome of ['qualified', 'review'])
      expect(c.rpc).toHaveBeenCalledWith('match_details', {
        p_details: false,
        p_outcome: outcome,
        p_since: '2026-10-10T09:00:00.000Z',
      });
    expect(
      r.deliveries.map((d) => [d.id, d.title, d.companyName, d.profileLabel]),
    ).toEqual([
      ['a', 'Senior Backend Engineer', 'Acme', 'Backend engineer'],
      ['b', 'Platform Engineer', null, 'Backend engineer'],
      ['c', null, null, 'Backend engineer'],
      ['t', null, null, null],
    ]);
  });

  it('titles a review delivery whose match is back in review', async () => {
    // An approval no longer applies (the match was re-decided onto another rule): the
    // match reads as 'review', not 'qualified', and still names the sent job.
    const c = client({
      webhook: { data: WEBHOOK, error: null },
      deliveries: { data: [delivery({ id: 'r' })], error: null },
      reviews: {
        data: [
          {
            matchId: M1,
            profileId: P1,
            jobId: J1,
            title: 'Staff Engineer',
            companyName: 'Initech',
          },
        ],
        error: null,
      },
    });
    const r = await loadWebhook(c.supabase);
    expect(r.deliveries[0]).toMatchObject({
      title: 'Staff Engineer',
      companyName: 'Initech',
    });
  });

  it("falls back to the sent payload's title and company", async () => {
    // Sent through a stand-in (job A merged into B): no match on A, but the body names B.
    const c = client({
      webhook: { data: WEBHOOK, error: null },
      deliveries: {
        data: [
          delivery({
            id: 's',
            matchId: null,
            payloadTitle: 'Job B',
            payloadCompany: 'Globex',
          }),
          delivery({
            id: 'n',
            jobId: J2,
            matchId: null,
            payloadTitle: 'Untitled company',
            payloadCompany: null,
          }),
          delivery({ id: 'x', jobId: J2, matchId: null }),
        ],
        error: null,
      },
    });
    const r = await loadWebhook(c.supabase);
    expect(c.deliveries.calls[0][1]).toContain(
      'payloadTitle:payload->job->>title',
    );
    expect(c.deliveries.calls[0][1]).toContain(
      'payloadCompany:payload->job->company->>name',
    );
    expect(r.deliveries.map((d) => [d.id, d.title, d.companyName])).toEqual([
      ['s', 'Job B', 'Globex'],
      ['n', 'Untitled company', null],
      ['x', null, null],
    ]);
  });

  it('throws on a read error', async () => {
    const c = client({ webhook: { data: null, error: { code: '42501' } } });
    await expect(loadWebhook(c.supabase)).rejects.toThrow(/code=42501/);
  });
});

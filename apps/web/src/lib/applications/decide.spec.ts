import { describe, expect, it, vi } from 'vitest';
import { NOT_MATCHED, clearDecision, saveDecision } from './decide';

const JOB = '22222222-2222-4222-8222-222222222222';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '33333333-3333-4333-8333-333333333333';

type Res = { data?: unknown; error?: unknown };

const MATCHES = [
  {
    profileId: P1,
    outcome: 'qualified',
    matcherVersion: 3,
    checks: [{ a: 1 }],
  },
  { profileId: P2, outcome: 'review', matcherVersion: 3, checks: [] },
];

/**
 * A fake client. `existing` answers the job_decisions status read; `writes` answers
 * the insert/update/delete calls in order.
 */
function client(opts: {
  matches?: unknown[];
  existing?:
    | ({ status: string; matchSnapshot?: unknown } | null)[]
    | { status: string; matchSnapshot?: unknown }
    | null;
  writes?: Res[];
}) {
  const calls = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    tables: [] as string[],
    order: [] as string[],
  };
  const writes = [...(opts.writes ?? [])];
  const reads = Array.isArray(opts.existing) ? [...opts.existing] : null;
  const nextWrite = () => writes.shift() ?? { error: null };
  const from = (table: string) => {
    calls.tables.push(table);
    if (table === 'job_matches') {
      const q = {
        select: () => q,
        eq: async (col: string, v: unknown) => {
          calls.eq(table, col, v);
          return { data: opts.matches ?? MATCHES, error: null };
        },
      };
      return q;
    }
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.order.push('read');
            return {
              data: reads ? (reads.shift() ?? null) : (opts.existing ?? null),
              error: null,
            };
          },
        }),
      }),
      insert: async (row: unknown) => {
        calls.order.push('insert');
        calls.insert(row);
        return nextWrite();
      },
      update: (row: unknown) => {
        calls.order.push('update');
        calls.update(row);
        return {
          eq: async (col: string, v: unknown) => {
            calls.eq(table, col, v);
            return nextWrite();
          },
        };
      },
      delete: () => ({
        eq: async (col: string, v: unknown) => {
          calls.delete(col, v);
          return nextWrite();
        },
      }),
    };
  };
  return { supabase: { from } as never, calls };
}

describe('saveDecision', () => {
  it('inserts an applied mark for a matched job', async () => {
    const { supabase, calls } = client({});
    const result = await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'applied',
    });
    expect(result).toEqual({ status: 'saved' });
    expect(calls.insert).toHaveBeenCalledWith({
      userId: 'user-1',
      jobId: JOB,
      status: 'applied',
      reason: null,
      note: null,
      matchSnapshot: null,
    });
  });

  it('inserts an expired mark bare', async () => {
    const { supabase, calls } = client({});
    const result = await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'expired',
    });
    expect(result).toEqual({ status: 'saved' });
    expect(calls.insert).toHaveBeenCalledWith({
      userId: 'user-1',
      jobId: JOB,
      status: 'expired',
      reason: null,
      note: null,
      matchSnapshot: null,
    });
    expect(calls.tables).not.toContain('job_matches');
  });

  it('stores expired bare even when a reason is sent', async () => {
    const { supabase, calls } = client({});
    await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'expired',
      reason: 'role',
    });
    expect(calls.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', reason: null }),
    );
  });

  it('moving a dismissal to expired clears reason, note and snapshot', async () => {
    const { supabase, calls } = client({
      existing: { status: 'dismissed', matchSnapshot: MATCHES } as never,
    });
    await saveDecision(supabase, 'user-1', { jobId: JOB, status: 'expired' });
    expect(calls.update.mock.calls[0][0]).toMatchObject({
      status: 'expired',
      reason: null,
      note: null,
      matchSnapshot: null,
      decidedAt: expect.any(String),
    });
  });

  it('stores a dismissal with reason, trimmed note and a snapshot of every match', async () => {
    const { supabase, calls } = client({});
    await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      reason: 'seniority',
      note: '  too junior  ',
    });
    const row = calls.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      status: 'dismissed',
      reason: 'seniority',
      note: 'too junior',
    });
    expect(row.matchSnapshot).toEqual(MATCHES);
    expect(row.matchSnapshot).toHaveLength(2);
  });

  it('stores a note of only spaces as null', async () => {
    const { supabase, calls } = client({});
    await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      note: '   ',
    });
    expect(calls.insert.mock.calls[0][0].note).toBeNull();
  });

  it('refuses a 501-character note with a field error and writes nothing', async () => {
    const { supabase, calls } = client({});
    const result = await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      note: 'x'.repeat(501),
    });
    expect(result.status).toBe('invalid');
    expect(result).toMatchObject({ errors: { note: expect.any(String) } });
    expect(calls.insert).not.toHaveBeenCalled();
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.tables).toEqual([]);
  });

  it('refuses an unknown reason', async () => {
    const { supabase, calls } = client({});
    const result = await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      reason: 'because',
    });
    expect(result.status).toBe('invalid');
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('updates an existing row and moves decidedAt only when the status changes', async () => {
    const same = client({ existing: { status: 'dismissed' } });
    await saveDecision(same.supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      reason: 'location',
    });
    const kept = same.calls.update.mock.calls[0][0];
    expect(kept).toMatchObject({
      status: 'dismissed',
      reason: 'location',
    });
    expect(kept).not.toHaveProperty('decidedAt');
    expect(kept).not.toHaveProperty('jobId');
    expect(kept).not.toHaveProperty('userId');
    expect(kept.updatedAt).toEqual(expect.any(String));
    expect(same.calls.insert).not.toHaveBeenCalled();

    const changed = client({ existing: { status: 'dismissed' } });
    await saveDecision(changed.supabase, 'user-1', {
      jobId: JOB,
      status: 'applied',
    });
    expect(changed.calls.update.mock.calls[0][0]).toMatchObject({
      status: 'applied',
      reason: null,
      note: null,
      matchSnapshot: null,
      decidedAt: expect.any(String),
    });
  });

  it('retries a unique violation as an update', async () => {
    const { supabase, calls } = client({
      existing: [null, { status: 'dismissed' }],
      writes: [{ error: { code: '23505' } }, { error: null }],
    });
    const result = await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'applied',
    });
    expect(result).toEqual({ status: 'saved' });
    expect(calls.insert).toHaveBeenCalledTimes(1);
    expect(calls.update).toHaveBeenCalledTimes(1);
    expect(calls.update.mock.calls[0][0]).toMatchObject({
      status: 'applied',
      decidedAt: expect.any(String),
    });
    expect(calls.order).toEqual(['read', 'insert', 'read', 'update']);
  });

  it('keeps the earlier snapshot when the matches are gone', async () => {
    const { supabase, calls } = client({
      matches: [],
      existing: { status: 'dismissed', matchSnapshot: MATCHES } as never,
    });
    await saveDecision(supabase, 'user-1', {
      jobId: JOB,
      status: 'dismissed',
      reason: 'role',
    });
    const row = calls.update.mock.calls[0][0];
    expect(row).toMatchObject({ reason: 'role' });
    expect(row).not.toHaveProperty('matchSnapshot');
  });

  it('answers NOT_MATCHED when the insert is refused', async () => {
    const { supabase } = client({ writes: [{ error: { code: '42501' } }] });
    const log = vi.fn();
    const result = await saveDecision(
      supabase,
      'user-1',
      { jobId: JOB, status: 'applied' },
      { log },
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('42501'));
    expect(result).toEqual({
      status: 'invalid',
      errors: { _form: NOT_MATCHED },
    });
  });
});

describe('clearDecision', () => {
  it('clears a decision on a job with no match left', async () => {
    const { supabase, calls } = client({});
    expect(await clearDecision(supabase, JOB)).toEqual({ status: 'saved' });
    expect(calls.delete).toHaveBeenCalledWith('jobId', JOB);
  });

  it('refuses a malformed job id', async () => {
    const { supabase, calls } = client({});
    const result = await clearDecision(supabase, 'nope');
    expect(result.status).not.toBe('saved');
    expect(calls.delete).not.toHaveBeenCalled();
  });
});

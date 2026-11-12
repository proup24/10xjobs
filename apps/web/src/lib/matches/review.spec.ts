import { describe, expect, it, vi } from 'vitest';
import { saveReview } from './review';

const MATCH = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d9b0a11';
const PROFILE = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';

type Read = { data: unknown; error: unknown };

/** A client whose job_matches read returns `read` and whose match_reviews insert returns `insert`. */
function client(read: Read, insert: { error: unknown } = { error: null }) {
  const calls = {
    eq: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    tables: [] as string[],
  };
  const from = (table: string) => {
    calls.tables.push(table);
    if (table === 'job_matches') {
      const q = {
        select: (cols: string) => {
          calls.select(cols);
          return q;
        },
        eq: (col: string, v: unknown) => {
          calls.eq(col, v);
          return q;
        },
        maybeSingle: async () => read,
      };
      return q;
    }
    return {
      insert: async (row: unknown) => {
        calls.insert(row);
        return insert;
      },
    };
  };
  return { supabase: { from } as never, calls };
}

const inReview = {
  id: MATCH,
  profileId: PROFILE,
  jobId: JOB,
  outcome: 'review',
  reviewRule: 'seniority',
  reviewField: 'seniority',
};

describe('saveReview', () => {
  it("saveReview inserts the match's rule and field", async () => {
    const { supabase, calls } = client({ data: inReview, error: null });
    const result = await saveReview(supabase, 'user-1', {
      matchId: MATCH,
      choice: 'qualified',
      note: 'Fine by me',
    });
    expect(result).toEqual({ status: 'saved' });
    expect(calls.eq).toHaveBeenCalledWith('id', MATCH);
    expect(calls.insert).toHaveBeenCalledWith({
      userId: 'user-1',
      matchId: MATCH,
      profileId: PROFILE,
      jobId: JOB,
      rule: 'seniority',
      field: 'seniority',
      choice: 'qualified',
      note: 'Fine by me',
    });
  });

  it('stores no note as null', async () => {
    const { supabase, calls } = client({ data: inReview, error: null });
    await saveReview(supabase, 'user-1', {
      matchId: MATCH,
      choice: 'rejected',
    });
    expect(calls.insert).toHaveBeenCalledWith(
      expect.objectContaining({ choice: 'rejected', note: null }),
    );
  });

  it('saveReview rejects a match that is not in review', async () => {
    const { supabase, calls } = client({
      data: {
        ...inReview,
        outcome: 'qualified',
        reviewRule: null,
        reviewField: null,
      },
      error: null,
    });
    const result = await saveReview(supabase, 'user-1', {
      matchId: MATCH,
      choice: 'qualified',
    });
    expect(result).toEqual({
      status: 'invalid',
      errors: { _form: 'This job is no longer in review.' },
    });
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('fails on a match it cannot read (another user’s, or gone)', async () => {
    const log = vi.fn();
    const { supabase, calls } = client({ data: null, error: null });
    expect(
      await saveReview(
        supabase,
        'user-1',
        { matchId: MATCH, choice: 'rejected' },
        { log },
      ),
    ).toEqual({ status: 'failed' });
    expect(calls.insert).not.toHaveBeenCalled();
  });

  it('refuses bad input before any read', async () => {
    const { supabase, calls } = client({ data: inReview, error: null });
    const bad = await saveReview(supabase, 'user-1', {
      matchId: 'nope',
      choice: 'maybe',
      note: 'x'.repeat(501),
    });
    expect(bad.status).toBe('invalid');
    if (bad.status === 'invalid')
      expect(Object.keys(bad.errors).sort()).toEqual([
        'choice',
        'matchId',
        'note',
      ]);
    expect(calls.tables).toEqual([]);
  });

  it('fails, logging the code only, when the insert is refused by RLS', async () => {
    const log = vi.fn();
    const { supabase } = client(
      { data: inReview, error: null },
      { error: { code: '42501', message: 'row-level security' } },
    );
    expect(
      await saveReview(
        supabase,
        'user-1',
        { matchId: MATCH, choice: 'qualified' },
        { log },
      ),
    ).toEqual({ status: 'failed' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('code=42501'));
  });
});

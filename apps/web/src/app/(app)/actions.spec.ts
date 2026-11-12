// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideReviewAction } from './actions';

const saveReview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/matches/review', () => ({ saveReview }));

const getClaims = vi.fn();
const client = { auth: { getClaims } };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  saveReview.mockResolvedValue({ status: 'saved' });
});

describe('decideReviewAction', () => {
  it('saves the decision as the session user', async () => {
    const input = { matchId: 'm1', choice: 'qualified' };
    expect(await decideReviewAction(input)).toEqual({ status: 'saved' });
    expect(saveReview).toHaveBeenCalledWith(client, 'user-1', input);
  });

  it('fails without a session and saves nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await decideReviewAction({})).toEqual({ status: 'failed' });
    expect(saveReview).not.toHaveBeenCalled();
  });

  it('returns the save’s result', async () => {
    saveReview.mockResolvedValue({ status: 'failed' });
    expect(await decideReviewAction({})).toEqual({ status: 'failed' });
  });
});

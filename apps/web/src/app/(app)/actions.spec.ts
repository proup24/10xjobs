// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJobDecisionAction,
  decideJobAction,
  decideReviewAction,
  reportMismatchAction,
} from './actions';

const saveReview = vi.hoisted(() => vi.fn());
vi.mock('@/lib/matches/review', () => ({ saveReview }));
const saveReport = vi.hoisted(() => vi.fn());
vi.mock('@/lib/matches/report', () => ({ saveReport }));

const saveDecision = vi.hoisted(() => vi.fn());
const clearDecision = vi.hoisted(() => vi.fn());
vi.mock('@/lib/applications/decide', () => ({ saveDecision, clearDecision }));

const getClaims = vi.fn();
const client = { auth: { getClaims } };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  saveReview.mockResolvedValue({ status: 'saved' });
  saveReport.mockResolvedValue({ status: 'saved' });
  saveDecision.mockResolvedValue({ status: 'saved' });
  clearDecision.mockResolvedValue({ status: 'saved' });
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

describe('reportMismatchAction', () => {
  it('reports as the session user', async () => {
    const input = { jobId: 'j', field: 'seniority', proposedValue: 'Mid' };
    expect(await reportMismatchAction(input)).toEqual({ status: 'saved' });
    expect(saveReport).toHaveBeenCalledWith(client, 'user-1', input);
  });

  it('fails without a session and saves nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await reportMismatchAction({})).toEqual({ status: 'failed' });
    expect(saveReport).not.toHaveBeenCalled();
  });
});

describe('decideJobAction', () => {
  it('saves as the session user', async () => {
    const input = { jobId: 'j', status: 'applied' };
    expect(await decideJobAction(input)).toEqual({ status: 'saved' });
    expect(saveDecision).toHaveBeenCalledWith(client, 'user-1', input);
  });

  it('fails without a session and saves nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await decideJobAction({})).toEqual({ status: 'failed' });
    expect(saveDecision).not.toHaveBeenCalled();
  });
});

describe('clearJobDecisionAction', () => {
  it('clears as the session user', async () => {
    expect(await clearJobDecisionAction('j')).toEqual({ status: 'saved' });
    expect(clearDecision).toHaveBeenCalledWith(client, 'j');
  });

  it('fails without a session and clears nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await clearJobDecisionAction('j')).toEqual({ status: 'failed' });
    expect(clearDecision).not.toHaveBeenCalled();
  });
});

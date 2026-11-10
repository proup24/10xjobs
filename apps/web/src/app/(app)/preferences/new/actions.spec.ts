// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardNewProfileAction,
  saveNewProfileJobAction,
  saveNewProfileTermsAction,
  startNewProfileAction,
} from './actions';

const REDIRECT = new Error('NEXT_REDIRECT');
const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

const flow = vi.hoisted(() => ({
  startNewProfile: vi.fn(),
  saveNewProfileJob: vi.fn(),
  saveNewProfileTerms: vi.fn(),
  discardNewProfile: vi.fn(),
}));
vi.mock('@/lib/preferences/new-profile', () => flow);

const getClaims = vi.fn();
const client = { auth: { getClaims } };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

const ID = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d9b0a11';

beforeEach(() => {
  vi.clearAllMocks();
  redirect.mockImplementation(() => {
    throw REDIRECT;
  });
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  flow.startNewProfile.mockResolvedValue('started');
  flow.saveNewProfileJob.mockResolvedValue({ status: 'saved' });
  flow.saveNewProfileTerms.mockResolvedValue({
    status: 'created',
    profileId: ID,
  });
  flow.discardNewProfile.mockResolvedValue('discarded');
});

describe('new-profile actions', () => {
  it('start: as the session user, then on to the job step', async () => {
    await expect(startNewProfileAction({ kind: 'blank' })).rejects.toBe(
      REDIRECT,
    );
    expect(flow.startNewProfile).toHaveBeenCalledWith(client, 'user-1', {
      kind: 'blank',
    });
    expect(redirect).toHaveBeenCalledWith('/preferences/new/job');
    expect(revalidatePath).toHaveBeenCalledWith('/preferences', 'layout');
  });

  it('start: a copy passes the source profile on', async () => {
    await expect(
      startNewProfileAction({ kind: 'copy', profileId: ID }),
    ).rejects.toBe(REDIRECT);
    expect(flow.startNewProfile).toHaveBeenCalledWith(client, 'user-1', {
      kind: 'copy',
      profileId: ID,
    });
  });

  it('start: the limit and failures come back without a redirect', async () => {
    flow.startNewProfile.mockResolvedValue('limit');
    expect(await startNewProfileAction({ kind: 'blank' })).toBe('limit');
    flow.startNewProfile.mockResolvedValue('failed');
    expect(await startNewProfileAction({ kind: 'blank' })).toBe('failed');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('start: a draft in progress goes to the continue-or-start-over choice', async () => {
    flow.startNewProfile.mockResolvedValue('in-progress');
    await expect(startNewProfileAction({ kind: 'blank' })).rejects.toBe(
      REDIRECT,
    );
    expect(redirect).toHaveBeenCalledWith('/preferences/new');
  });

  it('start: a malformed source fails and starts nothing', async () => {
    for (const source of [
      null,
      { kind: 'copy' },
      { kind: 'copy', profileId: 'nope' },
      { kind: 'other' },
    ]) {
      expect(await startNewProfileAction(source)).toBe('failed');
    }
    expect(flow.startNewProfile).not.toHaveBeenCalled();
  });

  it('fail without a session and touch nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await startNewProfileAction({ kind: 'blank' })).toBe('failed');
    expect(await saveNewProfileJobAction({})).toEqual({ status: 'failed' });
    expect(await saveNewProfileTermsAction(ID, {})).toEqual({
      status: 'failed',
    });
    expect(await discardNewProfileAction()).toBe('failed');
    for (const fn of Object.values(flow)) expect(fn).not.toHaveBeenCalled();
  });

  it('job: saves the draft as the session user', async () => {
    expect(await saveNewProfileJobAction({ j: 1 })).toEqual({
      status: 'saved',
    });
    expect(flow.saveNewProfileJob).toHaveBeenCalledWith(
      client,
      'user-1',
      { j: 1 },
      expect.any(Function),
    );
  });

  it('terms: passes the rendered id on and refreshes the nav once created', async () => {
    expect(await saveNewProfileTermsAction(ID, { t: 1 })).toEqual({
      status: 'created',
      profileId: ID,
    });
    expect(flow.saveNewProfileTerms).toHaveBeenCalledWith(
      client,
      'user-1',
      ID,
      { t: 1 },
      expect.any(Function),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/preferences', 'layout');
  });

  it('terms: a result other than created leaves the nav alone', async () => {
    flow.saveNewProfileTerms.mockResolvedValue({ status: 'saved' });
    expect(await saveNewProfileTermsAction(ID, {})).toEqual({
      status: 'saved',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('terms: a malformed id fails before anything runs', async () => {
    expect(await saveNewProfileTermsAction('nope', {})).toEqual({
      status: 'failed',
    });
    expect(getClaims).not.toHaveBeenCalled();
    expect(flow.saveNewProfileTerms).not.toHaveBeenCalled();
  });

  it('discard: deletes the draft as the session user', async () => {
    expect(await discardNewProfileAction()).toBe('discarded');
    expect(flow.discardNewProfile).toHaveBeenCalledWith(client, 'user-1');
    expect(revalidatePath).toHaveBeenCalledWith('/preferences', 'layout');
  });
});

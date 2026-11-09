// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveContactsAction,
  saveEligibilityPrefsAction,
  saveProfileJobAction,
  saveProfileTermsAction,
} from './actions';

const save = vi.hoisted(() => ({
  saveContacts: vi.fn(),
  saveEligibility: vi.fn(),
  saveProfileJob: vi.fn(),
  saveProfileTerms: vi.fn(),
}));
vi.mock('@/lib/setup/save', () => save);

const getClaims = vi.fn();
const client = { auth: { getClaims } };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

const ID = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d9b0a11';
const SAVED = { status: 'saved' };

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  for (const fn of Object.values(save)) fn.mockResolvedValue(SAVED);
});

describe('preferences actions', () => {
  it('run as the session user', async () => {
    expect(await saveContactsAction({ phone: '1' })).toEqual(SAVED);
    expect(save.saveContacts).toHaveBeenCalledWith(client, 'user-1', {
      phone: '1',
    });
    await saveEligibilityPrefsAction({ a: 1 });
    expect(save.saveEligibility).toHaveBeenCalledWith(client, 'user-1', {
      a: 1,
    });
  });

  it('fail without a session and save nothing', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await saveContactsAction({})).toEqual({ status: 'failed' });
    expect(await saveEligibilityPrefsAction({})).toEqual({ status: 'failed' });
    expect(await saveProfileJobAction(ID, {})).toEqual({ status: 'failed' });
    expect(await saveProfileTermsAction(ID, {})).toEqual({ status: 'failed' });
    for (const fn of Object.values(save)) expect(fn).not.toHaveBeenCalled();
  });

  it('profile saves target the given id with the session client (RLS decides)', async () => {
    await saveProfileJobAction(ID, { j: 1 });
    expect(save.saveProfileJob).toHaveBeenCalledWith(
      client,
      ID,
      { j: 1 },
      expect.any(Function),
    );
    await saveProfileTermsAction(ID, { t: 1 });
    expect(save.saveProfileTerms).toHaveBeenCalledWith(client, ID, { t: 1 });
  });

  it('a foreign or deleted id comes back as the save’s failed', async () => {
    save.saveProfileJob.mockResolvedValue({ status: 'failed' });
    expect(await saveProfileJobAction(ID, {})).toEqual({ status: 'failed' });
  });

  it('a profile id that is not a uuid fails without a save', async () => {
    expect(await saveProfileJobAction('nope', {})).toEqual({
      status: 'failed',
    });
    expect(await saveProfileTermsAction(42 as unknown as string, {})).toEqual({
      status: 'failed',
    });
    expect(save.saveProfileJob).not.toHaveBeenCalled();
    expect(save.saveProfileTerms).not.toHaveBeenCalled();
  });
});

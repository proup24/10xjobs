// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveContactsAction,
  saveEligibilityPrefsAction,
  saveProfileJobAction,
  saveProfileTermsAction,
  deleteProfileAction,
  setSearchSwitchAction,
} from './actions';

const save = vi.hoisted(() => ({
  saveContacts: vi.fn(),
  saveEligibility: vi.fn(),
  saveProfileJob: vi.fn(),
  saveProfileTerms: vi.fn(),
}));
vi.mock('@/lib/setup/save', () => save);

const del = vi.hoisted(() => ({
  deleteProfile: vi.fn(),
  hrefAfterDelete: vi.fn(),
}));
vi.mock('@/lib/preferences/delete-profile', () => del);
const loadProfileList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/preferences/profiles', () => ({ loadProfileList }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

const setSearchSwitch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine/server', () => ({
  engineClient: async () => ({ setSearchSwitch }),
}));

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

describe('deleteProfileAction', () => {
  const LIST = [{ id: ID }, { id: 'other' }];

  it('reads the list first, deletes, refreshes the nav and redirects to the next profile', async () => {
    loadProfileList.mockResolvedValue(LIST);
    del.deleteProfile.mockResolvedValue('deleted');
    del.hrefAfterDelete.mockReturnValue('/preferences/profiles/other/job');
    await deleteProfileAction(ID);
    expect(del.deleteProfile).toHaveBeenCalledWith(client, 'user-1', ID, {
      engine: expect.anything(),
    });
    expect(del.hrefAfterDelete).toHaveBeenCalledWith(LIST, ID);
    expect(revalidatePath).toHaveBeenCalledWith('/preferences', 'layout');
    expect(redirect).toHaveBeenCalledWith('/preferences/profiles/other/job');
    expect(loadProfileList.mock.invocationCallOrder[0]).toBeLessThan(
      del.deleteProfile.mock.invocationCallOrder[0],
    );
  });

  it('returns the refusal and does not redirect', async () => {
    loadProfileList.mockResolvedValue(LIST);
    del.deleteProfile.mockResolvedValue('last');
    expect(await deleteProfileAction(ID)).toBe('last');
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('fails on a bad id or no session without deleting', async () => {
    expect(await deleteProfileAction('nope')).toBe('failed');
    getClaims.mockResolvedValue({ data: null });
    expect(await deleteProfileAction(ID)).toBe('failed');
    expect(del.deleteProfile).not.toHaveBeenCalled();
  });
});

describe('setSearchSwitchAction', () => {
  it('maps ok to saved and passes the id, key and flag', async () => {
    setSearchSwitch.mockResolvedValue({
      kind: 'ok',
      data: { key: 'indeed', enabled: true, searches: 1, pausedUntil: null },
    });
    expect(await setSearchSwitchAction(ID, 'indeed', true)).toBe('saved');
    expect(setSearchSwitch).toHaveBeenCalledWith(ID, 'indeed', true);
  });

  it.each([
    { kind: 'not-found' },
    { kind: 'unauthorized' },
    { kind: 'forbidden' },
    { kind: 'unavailable' },
    { kind: 'invalid', message: 'x' },
  ])('maps $kind to failed', async (result) => {
    setSearchSwitch.mockResolvedValue(result);
    expect(await setSearchSwitchAction(ID, 'posts', false)).toBe('failed');
  });

  it('maps a thrown call to failed', async () => {
    setSearchSwitch.mockRejectedValue(new Error('boom'));
    expect(await setSearchSwitchAction(ID, 'posts', true)).toBe('failed');
  });

  it('fails bad input without calling the engine', async () => {
    expect(await setSearchSwitchAction('not-a-uuid', 'posts', true)).toBe(
      'failed',
    );
    expect(
      await setSearchSwitchAction(ID, 'other' as unknown as 'posts', true),
    ).toBe('failed');
    expect(
      await setSearchSwitchAction(ID, 'posts', 'yes' as unknown as boolean),
    ).toBe('failed');
    expect(setSearchSwitch).not.toHaveBeenCalled();
  });
});

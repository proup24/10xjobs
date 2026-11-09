// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import { deleteProfile, hrefAfterDelete } from './delete-profile';
import type { ProfileListItem } from './profiles';

const rows = (
  resumes: (boolean | null)[],
  error: { code: string } | null = null,
) =>
  fakeSupabase({
    reply: () =>
      ({
        data: error
          ? null
          : resumes.map((r, i) => ({
              id: `p${i + 1}`,
              resumeKey: r ? 'u1/x.pdf' : null,
            })),
        error,
      }) as never,
  });

describe('deleteProfile', () => {
  it('refuses the last profile without calling anything else', async () => {
    const f = rows([true]);
    const deleteDraft = vi.fn();
    expect(await deleteProfile(f.supabase, 'u1', 'p1', { deleteDraft })).toBe(
      'last',
    );
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it('delegates to deleteDraftProfile when there are two or more', async () => {
    for (const result of ['deleted', 'not-draft', 'failed'] as const) {
      const f = rows([true, true]);
      const deleteDraft = vi.fn().mockResolvedValue(result);
      expect(await deleteProfile(f.supabase, 'u1', 'p1', { deleteDraft })).toBe(
        result,
      );
      expect(deleteDraft).toHaveBeenCalledWith(f.supabase, 'u1', 'p1');
    }
  });

  it('refuses the only profile with a resume, deleting nothing', async () => {
    const f = rows([true, false]);
    const deleteDraft = vi.fn();
    expect(await deleteProfile(f.supabase, 'u1', 'p1', { deleteDraft })).toBe(
      'only-resume',
    );
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it('deletes a profile without a resume, even when it is the other that has one', async () => {
    const f = rows([true, false]);
    const deleteDraft = vi.fn().mockResolvedValue('deleted');
    expect(await deleteProfile(f.supabase, 'u1', 'p2', { deleteDraft })).toBe(
      'deleted',
    );
    expect(deleteDraft).toHaveBeenCalled();
  });

  it('deletes a resume profile when another one has a resume too', async () => {
    const f = rows([true, true, false]);
    const deleteDraft = vi.fn().mockResolvedValue('deleted');
    expect(await deleteProfile(f.supabase, 'u1', 'p1', { deleteDraft })).toBe(
      'deleted',
    );
  });

  it('fails, logging the code only, when the profiles cannot be read', async () => {
    const f = rows([], { code: 'XX000' });
    const log = vi.fn();
    const deleteDraft = vi.fn();
    expect(
      await deleteProfile(f.supabase, 'u1', 'p1', { log, deleteDraft }),
    ).toBe('failed');
    expect(log).toHaveBeenCalledWith(
      'profile delete: profiles read failed profile=p1 code=XX000',
    );
    expect(deleteDraft).not.toHaveBeenCalled();
  });
});

describe('hrefAfterDelete', () => {
  const item = (id: string, hasResume = true): ProfileListItem => ({
    id,
    position: 'x',
    firstPlace: null,
    hasResume,
  });
  const list = [item('a'), item('b'), item('c', false)];

  it('goes to the profile that followed the deleted one', () => {
    expect(hrefAfterDelete(list, 'a')).toBe('/preferences/profiles/b/job');
    expect(hrefAfterDelete(list, 'b')).toBe('/preferences/profiles/c/resume');
  });

  it('goes to the last remaining one when the deleted was last', () => {
    expect(hrefAfterDelete(list, 'c')).toBe('/preferences/profiles/b/job');
  });

  it('goes to contacts when nothing remains', () => {
    expect(hrefAfterDelete([item('a')], 'a')).toBe('/preferences/contacts');
  });
});

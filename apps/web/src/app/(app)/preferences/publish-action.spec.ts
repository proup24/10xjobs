// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISH_FAILED_MESSAGE } from '@/lib/profiles/publish';
import { publishProfileAction } from './publish-action';

const publishProfile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine/server', () => ({
  engineClient: async () => ({ publishProfile }),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
const getClaims = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims } }),
}));

const ID = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d9b0a11';
const FAILED = { status: 'failed', message: PUBLISH_FAILED_MESSAGE };

beforeEach(() => {
  vi.clearAllMocks();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('publishProfileAction', () => {
  it('fails on an invalid id without calling the engine', async () => {
    expect(await publishProfileAction('nope')).toEqual(FAILED);
    expect(publishProfile).not.toHaveBeenCalled();
  });

  it('fails without claims and without calling the engine', async () => {
    getClaims.mockResolvedValue({ data: null });
    expect(await publishProfileAction(ID)).toEqual(FAILED);
    expect(publishProfile).not.toHaveBeenCalled();
  });

  it('revalidates the layout when published', async () => {
    publishProfile.mockResolvedValue({ kind: 'ok', value: { id: ID } });
    expect(await publishProfileAction(ID)).toEqual({
      status: 'published',
      href: `/?profile=${ID}`,
    });
    expect(publishProfile).toHaveBeenCalledWith(ID);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('does not revalidate when it fails', async () => {
    publishProfile.mockResolvedValue({ kind: 'unavailable' });
    expect(await publishProfileAction(ID)).toEqual(FAILED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('fails when the engine throws', async () => {
    publishProfile.mockRejectedValue(new Error('net'));
    expect(await publishProfileAction(ID)).toEqual(FAILED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

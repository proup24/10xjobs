// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireOwnProfile } from './guard';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
const REDIRECT = new Error('NEXT_REDIRECT');
const notFound = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound, redirect }));

const getClaims = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
const client = { auth: { getClaims }, from };
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => client,
}));

const ID = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d9b0a11';

beforeEach(() => {
  vi.clearAllMocks();
  notFound.mockImplementation(() => {
    throw NOT_FOUND;
  });
  redirect.mockImplementation(() => {
    throw REDIRECT;
  });
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });
  maybeSingle.mockResolvedValue({ data: { id: ID }, error: null });
});

describe('requireOwnProfile', () => {
  it('sends a visitor with no session to /sign-in', async () => {
    getClaims.mockResolvedValue({ data: null });
    await expect(requireOwnProfile(ID)).rejects.toBe(REDIRECT);
    expect(redirect).toHaveBeenCalledWith('/sign-in');
    expect(from).not.toHaveBeenCalled();
  });

  it('a non-uuid id is not found, without a query', async () => {
    await expect(requireOwnProfile('not-a-uuid')).rejects.toBe(NOT_FOUND);
    expect(from).not.toHaveBeenCalled();
  });

  it('a uuid RLS does not return (another user’s, or deleted) is not found', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(requireOwnProfile(ID)).rejects.toBe(NOT_FOUND);
    expect(from).toHaveBeenCalledWith('profiles');
    expect(eq).toHaveBeenCalledWith('id', ID);
  });

  it('a read error throws rather than passing as not found', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '500' } });
    await expect(requireOwnProfile(ID)).rejects.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('your own profile returns the client and ids', async () => {
    const out = await requireOwnProfile(ID);
    expect(out).toEqual({ supabase: client, userId: 'user-1', profileId: ID });
  });
});

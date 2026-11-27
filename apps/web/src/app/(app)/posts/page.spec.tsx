import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect ${to}`);
  }),
);
vi.mock('next/navigation', () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) },
    rpc,
  }),
}));
const profiles = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../preferences/data', () => ({
  preferenceProfiles: async () => ({ items: profiles.items, labels: {} }),
  preferenceLists: async () => ({
    positions: [],
    seniorities: [],
    techs: [],
    countries: [],
    regions: [],
    cities: [],
    languages: [],
    currencies: [],
    contractTypes: [],
  }),
}));
vi.mock('../actions', () => ({
  decideReviewAction: vi.fn(),
  decideJobAction: vi.fn(),
  clearJobDecisionAction: vi.fn(),
  reportMismatchAction: vi.fn(),
}));

const P1 = '11111111-1111-4111-8111-111111111111';
const profile = (postSearch: boolean) => ({
  id: P1,
  position: 'Engineer',
  state: 'published',
  postSearch,
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

const renderPage = async (sp: Record<string, string> = {}) =>
  render(await Page({ searchParams: Promise.resolve(sp) }));

describe('Social posts page', () => {
  it('redirects to the job board when no profile has post search on', async () => {
    profiles.items = [profile(false)];
    await expect(renderPage()).rejects.toThrow('redirect /');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads post roles for its three match lists', async () => {
    profiles.items = [profile(true)];
    await renderPage();
    const reads = rpc.mock.calls.filter(([fn]) => fn === 'match_details');
    expect(reads.map(([, args]) => args.p_outcome).sort()).toEqual([
      'qualified',
      'rejected',
      'review',
    ]);
    for (const [, args] of reads) expect(args.p_kind).toBe('post_role');
    expect(rpc).toHaveBeenCalledWith('post_junk_list', expect.anything());
    expect(rpc).toHaveBeenCalledWith('post_rescue_list');
    expect(screen.getByRole('heading', { name: 'Social posts' })).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Social posts' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });
});

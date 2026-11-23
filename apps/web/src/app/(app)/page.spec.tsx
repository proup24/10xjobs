import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const engine = vi.hoisted(() => ({ searchesState: vi.fn() }));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } } }) },
  }),
}));
vi.mock('@/lib/matches/load', () => ({ loadMatches: async () => [] }));
vi.mock('@/lib/matches/postings', () => ({ loadPostings: async () => [] }));
vi.mock('@/lib/matches/selected', () => ({
  selectedRows: async () => null,
  decidedJobHref: () => null,
}));
vi.mock('./preferences/data', () => ({
  preferenceProfiles: async () => ({
    items: [{ id: 'p1', position: 'Engineer', state: 'published' }],
    labels: {},
  }),
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
vi.mock('./searches-actions', () => ({ resumeSearchesAction: vi.fn() }));
vi.mock('./actions', () => ({
  decideReviewAction: vi.fn(),
  decideJobAction: vi.fn(),
  clearJobDecisionAction: vi.fn(),
  reportMismatchAction: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderPage = async () =>
  render(await Page({ searchParams: Promise.resolve({}) }));

const resumeButton = () =>
  screen.queryByRole('button', { name: 'Resume searches' });

describe('Matches page', () => {
  it('streams in the notice when searches are paused', async () => {
    engine.searchesState.mockResolvedValue({
      kind: 'ok',
      data: { paused: true, lastActiveAt: '2026-11-20T10:00:00.000Z' },
    });
    await renderPage();
    expect(
      await screen.findByRole('button', { name: 'Resume searches' }),
    ).toBeTruthy();
  });

  it('Matches loads without waiting on the engine', async () => {
    // Never settles: an engine that hangs.
    engine.searchesState.mockReturnValue(new Promise(() => undefined));
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Matches' })).toBeTruthy();
    expect(resumeButton()).toBeNull();
  });

  it('Matches loads when the state read fails', async () => {
    engine.searchesState.mockResolvedValue({ kind: 'unauthorized' });
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Matches' })).toBeTruthy();
    await vi.waitFor(() => expect(engine.searchesState).toHaveBeenCalled());
    expect(resumeButton()).toBeNull();
  });

  it('Matches loads when the state read throws', async () => {
    engine.searchesState.mockRejectedValue(new Error('down'));
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Matches' })).toBeTruthy();
    expect(resumeButton()).toBeNull();
  });
});

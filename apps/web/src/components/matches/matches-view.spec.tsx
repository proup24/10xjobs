import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByJob, selectJobs, type MatchRow } from '@/lib/matches/group';
import type { ViewState } from '@/lib/matches/view-state';
import { MatchesView } from './matches-view';
import { NOW, P1, P2, hoursAgo, labels, matchRow } from './test-fixtures';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

type Profile = { id: string; label: string; state: 'draft' | 'published' };
const ONE: Profile[] = [
  { id: P1, label: 'Full-stack engineer', state: 'published' },
];
const TWO: Profile[] = [
  ...ONE,
  { id: P2, label: 'Backend engineer', state: 'published' },
];

const ROWS: MatchRow[] = [
  matchRow({ jobId: 'old', title: 'Old job', postedAt: hoursAgo(50) }),
  matchRow({ jobId: 'fresh', title: 'Fresh job', postedAt: hoursAgo(1) }),
  matchRow({ jobId: 'mid', title: 'Mid job', postedAt: hoursAgo(5) }),
];

function renderView(
  opts: {
    rows?: MatchRow[];
    profiles?: Profile[];
    initial?: Partial<ViewState>;
    selected?: MatchRow[] | null;
  } = {},
) {
  const profiles = opts.profiles ?? ONE;
  render(
    <MatchesView
      jobs={groupByJob(opts.rows ?? ROWS)}
      profiles={profiles}
      labels={labels}
      initial={{
        tab: '24h',
        profile: P1,
        source: 'all',
        job: null,
        ...opts.initial,
      }}
      now={NOW}
      selected={opts.selected ?? null}
    />,
  );
}

const rowLinks = () =>
  within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('link');

async function options(combobox: string) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }));
  const found = await screen.findAllByRole('option');
  return found.map((o) => o.textContent);
}

describe('MatchesView', () => {
  it('lists rows newest posted first', () => {
    renderView({ initial: { tab: '7d' } });
    expect(
      rowLinks().map((l) => within(l).getByRole('heading').textContent),
    ).toEqual(['Fresh job', 'Mid job', 'Old job']);
  });

  it('links a row to its job, keeping tab, profile and source', () => {
    renderView({
      profiles: TWO,
      initial: { tab: '7d', profile: P2, source: 'LINKEDIN_JOB_BOARD' },
      rows: ROWS.map((r) => ({ ...r, profileId: P2 })),
    });
    expect(rowLinks()[0].getAttribute('href')).toBe(
      `/?tab=7d&profile=${P2}&source=LINKEDIN_JOB_BOARD&job=fresh`,
    );
  });

  it('marks the selected row', () => {
    renderView({
      initial: { job: 'mid' },
      selected: ROWS.filter((r) => r.jobId === 'mid'),
    });
    const [fresh, mid] = rowLinks();
    expect(mid.getAttribute('aria-current')).toBe('true');
    expect(fresh.getAttribute('aria-current')).toBeNull();
  });

  it('counts each tab as selectJobs does', () => {
    renderView();
    const jobs = groupByJob(ROWS);
    const f = { profileId: P1, source: 'all', now: new Date(NOW) };
    const n24 = selectJobs(jobs, { ...f, tab: '24h' }).length;
    const n7 = selectJobs(jobs, { ...f, tab: '7d' }).length;
    expect(n24).toBe(2);
    expect(
      screen.getByRole('tab', { name: `Last 24 hours (${n24})` }),
    ).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: `Last 7 days (${n7})` }),
    ).toBeTruthy();
    expect(rowLinks()).toHaveLength(2);
  });

  it('switches tab through the URL', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: /Last 7 days/ }));
    expect(push).toHaveBeenCalledWith('/?tab=7d');
  });

  it('lists only LinkedIn as a source for LinkedIn-only data', async () => {
    renderView();
    expect(await options('Source')).toEqual(['All sources', 'LinkedIn']);
  });

  it('has no profile switcher for a single profile', () => {
    renderView();
    expect(screen.queryByRole('combobox', { name: 'Profile' })).toBeNull();
  });

  it('offers "All profiles" first with two published profiles', async () => {
    renderView({ profiles: TWO, initial: { profile: 'all' } });
    expect(await options('Profile')).toEqual([
      'All profiles',
      'Full-stack engineer',
      'Backend engineer',
    ]);
  });

  it('in "All profiles" shows one row per job with a badge per profile', () => {
    renderView({
      profiles: TWO,
      initial: { profile: 'all' },
      rows: [
        matchRow({ jobId: 'a', profileId: P1 }),
        matchRow({ jobId: 'a', profileId: P2 }),
      ],
    });
    const [row] = rowLinks();
    expect(rowLinks()).toHaveLength(1);
    expect(within(row).getByText('Full-stack engineer')).toBeTruthy();
    expect(within(row).getByText('Backend engineer')).toBeTruthy();
  });
});

describe('MatchesView empty states', () => {
  it('points a user with no profile to setup', () => {
    renderView({ profiles: [], rows: [] });
    expect(screen.getByText('No profile yet')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /set up/i }).getAttribute('href'),
    ).toBe('/setup');
  });

  it('says an only-draft profile is not live yet', () => {
    renderView({
      profiles: [{ id: P1, label: 'Full-stack engineer', state: 'draft' }],
      rows: [],
    });
    expect(screen.getByText("This profile isn't live yet")).toBeTruthy();
    expect(
      screen.getByText("It starts matching once it's published."),
    ).toBeTruthy();
  });

  it('lists a draft beside one published profile, without "All profiles"', async () => {
    renderView({
      profiles: [
        { id: P1, label: 'Full-stack engineer', state: 'published' },
        { id: P2, label: 'Backend engineer', state: 'draft' },
      ],
    });
    expect(await options('Profile')).toEqual([
      'Full-stack engineer',
      'Backend engineer (Draft)',
    ]);
  });

  it('offers "Last 7 days" from an empty 24 hour tab', () => {
    renderView({ rows: [ROWS[0]] });
    expect(screen.getByText('No matches in the last 24 hours')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Last 7 days' }).getAttribute('href'),
    ).toBe('/?tab=7d');
  });

  it('says no matches yet on an empty 7 day tab', () => {
    renderView({ rows: [], initial: { tab: '7d' } });
    expect(screen.getByText('No matches yet')).toBeTruthy();
    expect(
      screen.getByText("New jobs are matched as they're collected."),
    ).toBeTruthy();
  });

  it('offers to clear a filter with no results', () => {
    renderView({ initial: { source: 'ASHBY' } });
    expect(screen.getByText('No matches for this filter')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href'),
    ).toBe('/');
  });

  it('says so when the job is not in the matches', () => {
    renderView({ initial: { job: 'gone' }, selected: [] });
    expect(screen.getByText("This job isn't in your matches")).toBeTruthy();
  });
});

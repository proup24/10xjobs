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
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));
const decideReviewAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/actions', () => ({
  decideReviewAction,
  reportMismatchAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  decideReviewAction.mockReset();
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
    reviewRows?: MatchRow[];
    profiles?: Profile[];
    initial?: Partial<ViewState>;
    selected?: MatchRow[] | null;
  } = {},
) {
  const profiles = opts.profiles ?? ONE;
  render(
    <MatchesView
      jobs={groupByJob(opts.rows ?? ROWS)}
      reviewJobs={groupByJob(opts.reviewRows ?? [])}
      profiles={profiles}
      labels={labels}
      initial={{
        list: 'matches',
        tab: '24h',
        profile: P1,
        source: 'all',
        job: null,
        ...opts.initial,
      }}
      now={NOW}
      userId="u1"
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

const REVIEW: MatchRow[] = [
  matchRow({
    jobId: 'rev',
    matchId: 'm-rev',
    title: 'Review job',
    outcome: 'review',
    reviewRule: 'seniority',
    reviewField: 'seniority',
    postedAt: hoursAgo(2),
  }),
];

describe('MatchesView lists', () => {
  it('counts both lists on the List tabs', () => {
    renderView({ reviewRows: REVIEW });
    const tabs = within(screen.getByRole('tablist', { name: 'List' }));
    expect(tabs.getByRole('tab', { name: 'Matches (3)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Review (1)' })).toBeTruthy();
  });

  it('switches to the review list in the URL, closing the open job', () => {
    renderView({ reviewRows: REVIEW, initial: { job: 'mid' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Review (1)' }));
    expect(push).toHaveBeenCalledWith('/?list=review');
  });

  it('lists the review jobs on the review list', () => {
    renderView({ reviewRows: REVIEW, initial: { list: 'review' } });
    const links = within(
      screen.getByRole('list', { name: 'Review' }),
    ).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(within(links[0]).getByRole('heading').textContent).toBe(
      'Review job',
    );
  });

  it('says there is nothing to review', () => {
    renderView({ initial: { list: 'review', tab: '7d' } });
    expect(screen.getByText('Nothing to review')).toBeTruthy();
  });

  it('records a decision, then closes the job and refreshes', async () => {
    decideReviewAction.mockResolvedValue({ status: 'saved' });
    renderView({
      reviewRows: REVIEW,
      initial: { list: 'review', job: 'rev' },
      selected: REVIEW,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to matches' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(decideReviewAction).toHaveBeenCalledWith({
      matchId: 'm-rev',
      choice: 'qualified',
    });
    expect(push).toHaveBeenCalledWith('/?list=review');
  });

  it('offers no decisions on the matches list', () => {
    renderView({ initial: { job: 'mid' }, selected: [ROWS[2]] });
    expect(
      screen.queryByRole('button', { name: 'Move to matches' }),
    ).toBeNull();
  });
});

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

  // Below `md` the list and heading are hidden while a job is open, so the pane needs its
  // own way back.
  it('links back to the list from a job that is not in the matches', () => {
    renderView({ initial: { job: 'gone', tab: '7d' }, selected: [] });
    expect(
      screen
        .getByRole('link', { name: 'Back to matches' })
        .getAttribute('href'),
    ).toBe('/?tab=7d');
  });
});

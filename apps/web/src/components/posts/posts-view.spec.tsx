import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByJob, type MatchRow } from '@/lib/matches/group';
import type { JunkRow, PostExtras, RescueRow } from '@/lib/posts/load';
import type { PostsViewState } from '@/lib/posts/view-state';
import {
  NOW,
  P1,
  hoursAgo,
  labels,
  matchRow,
} from '@/components/matches/test-fixtures';
import { PostsView } from './posts-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/(app)/actions', () => ({
  decideReviewAction: vi.fn(),
  decideJobAction: vi.fn(),
  clearJobDecisionAction: vi.fn(),
  reportMismatchAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const post = (over: Parameters<typeof matchRow>[0]) =>
  matchRow({
    kind: 'post_role',
    channels: ['LINKEDIN_POSTS'],
    ...over,
  });

const QUALIFIED: MatchRow[] = [
  post({ jobId: 'q1', title: 'Go engineer', postedAt: hoursAgo(2) }),
];
const REVIEW: MatchRow[] = [
  post({
    jobId: 'rv1',
    title: 'Unsure role',
    outcome: 'review',
    reviewRule: 'hiringVerdict',
    postedAt: hoursAgo(3),
  }),
];
const failed = (reason: string) => [
  { rule: 'position', outcome: 'pass', reason: 'ok' },
  { rule: 'seniority', outcome: 'fail', reason },
];
const REJECTED: MatchRow[] = [
  post({
    jobId: 'r1',
    title: 'Rescued role',
    outcome: 'rejected',
    checks: failed('job seniority junior is below yours'),
    postedAt: hoursAgo(4),
    decidedAt: hoursAgo(1),
  }),
  post({
    jobId: 'd1',
    title: 'Junior role',
    outcome: 'rejected',
    checks: failed('job seniority intern is below yours'),
    postedAt: hoursAgo(5),
    decidedAt: hoursAgo(2),
  }),
];
const JUNK = [
  {
    jobId: 'j1',
    profileIds: [P1],
    verdict: 'not_hiring',
    confidence: 'sure',
    reason: 'the author is looking for a job',
    postingUrl: 'https://www.linkedin.com/posts/j1',
    postedAt: hoursAgo(6),
    firstSeenAt: hoursAgo(6),
    authorName: 'Jane Doe',
    authorUrl: null,
    authorKey: 'jane',
    text: 'Open to work',
  },
] as unknown as JunkRow[];
const RESCUES = [
  {
    jobId: 'r1',
    kind: 'post_role',
    origin: 'disqualified',
    profileIds: [P1],
    title: 'Rescued role',
    companyName: 'Acme',
    postingUrl: null,
    postedAt: hoursAgo(4),
    firstSeenAt: hoursAgo(4),
    authorName: 'Ann',
    decisionStatus: null,
  },
] as unknown as RescueRow[];
const EXTRAS: Record<string, PostExtras> = {
  q1: {
    jobId: 'q1',
    emailPending: true,
    applyKinds: ['email'],
    authorName: 'Bob',
    authorUrl: '',
    authorKey: 'bob',
    rescued: false,
  },
  r1: {
    jobId: 'r1',
    emailPending: false,
    applyKinds: ['connect_dm_comment'],
    authorName: 'Ann',
    authorUrl: '',
    authorKey: 'ann',
    rescued: true,
  },
};

function renderView(initial: Partial<PostsViewState> = {}) {
  render(
    <PostsView
      qualified={groupByJob(QUALIFIED)}
      review={groupByJob(REVIEW)}
      rejected={groupByJob(REJECTED)}
      junk={JUNK}
      rescues={RESCUES}
      extras={EXTRAS}
      profiles={[{ id: P1, label: 'Backend', state: 'published' }]}
      labels={labels}
      initial={{
        list: 'matches',
        tab: '24h',
        profile: P1,
        job: null,
        ...initial,
      }}
      now={NOW}
      userId="u1"
      selected={null}
      details={null}
    />,
  );
}

const rowsOf = (name: string) =>
  within(screen.getByRole('list', { name })).getAllByRole('listitem');

describe('PostsView', () => {
  it('shows the four tabs with their counts', () => {
    renderView();
    const tabs = within(screen.getByRole('tablist', { name: 'List' }));
    expect(tabs.getByRole('tab', { name: 'Matches (2)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Review (1)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Disqualified (1)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Junk (1)' })).toBeTruthy();
  });

  it('shows Email pending and Rescued on Matches, with how to apply', () => {
    renderView();
    const [q1, r1] = rowsOf('Matches');
    expect(within(q1).getByText('Go engineer')).toBeTruthy();
    expect(within(q1).getByText('Email pending')).toBeTruthy();
    expect(within(q1).getByText('Email')).toBeTruthy();
    expect(within(r1).getByText('Rescued role')).toBeTruthy();
    expect(within(r1).getByText('Rescued')).toBeTruthy();
    expect(within(r1).getByText('DM the author')).toBeTruthy();
    expect(within(r1).queryByText('Email pending')).toBeNull();
  });

  it('lists a rescued job that is also rejected only in Matches', () => {
    renderView({ list: 'disqualified' });
    const rows = rowsOf('Disqualified');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Junior role')).toBeTruthy();
    expect(
      within(rows[0]).getByText('job seniority intern is below yours'),
    ).toBeTruthy();
    expect(screen.queryByText('Rescued role')).toBeNull();
  });

  it('shows the verdict and its reason on Junk', () => {
    renderView({ list: 'junk' });
    const [row] = rowsOf('Junk');
    expect(within(row).getByText('Not hiring')).toBeTruthy();
    expect(
      within(row).getByText('the author is looking for a job'),
    ).toBeTruthy();
  });

  it('shows the review rows on Review', () => {
    renderView({ list: 'review' });
    const rows = rowsOf('Review');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Unsure role')).toBeTruthy();
  });

  it('shows the Junk empty state for a quiet day', () => {
    renderView({ list: 'junk', profile: 'other' });
    expect(screen.getByText('No junk in the last 24 hours')).toBeTruthy();
  });
});

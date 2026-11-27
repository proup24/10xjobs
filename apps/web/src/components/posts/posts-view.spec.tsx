import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupByJob, type MatchRow } from '@/lib/matches/group';
import type {
  JunkRow,
  PostDetails,
  PostExtras,
  RescueRow,
} from '@/lib/posts/load';
import type { PostsViewState } from '@/lib/posts/view-state';
import {
  NOW,
  P1,
  hoursAgo,
  labels,
  matchRow,
} from '@/components/matches/test-fixtures';
import {
  decideJobAction,
  rescuePostAction,
  undoRescueAction,
} from '@/app/(app)/actions';
import { unblockAuthorAction } from '@/app/(app)/preferences/actions';
import { PostsView } from './posts-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/(app)/actions', () => ({
  decideReviewAction: vi.fn(),
  decideJobAction: vi.fn(),
  clearJobDecisionAction: vi.fn(),
  reportMismatchAction: vi.fn(),
  rescuePostAction: vi.fn(),
  undoRescueAction: vi.fn(),
}));
vi.mock('@/app/(app)/preferences/actions', () => ({
  blockAuthorAction: vi.fn(),
  unblockAuthorAction: vi.fn(),
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
const REJECTED: MatchRow[] = [
  post({
    jobId: 'r1',
    title: 'Rescued role',
    outcome: 'rejected',
    checks: null, // list rows: the page sends failedReasons apart
    postedAt: hoursAgo(4),
    decidedAt: hoursAgo(1),
  }),
  post({
    jobId: 'd1',
    title: 'Junior role',
    outcome: 'rejected',
    checks: null, // list rows: the page sends failedReasons apart
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

function renderView(
  initial: Partial<PostsViewState> = {},
  open: {
    selected?: MatchRow[] | null;
    details?: PostDetails | null;
    rescues?: RescueRow[];
    junk?: JunkRow[];
  } = {},
) {
  render(
    <PostsView
      qualified={groupByJob(QUALIFIED)}
      review={groupByJob(REVIEW)}
      rejected={groupByJob(REJECTED)}
      junk={open.junk ?? JUNK}
      rescues={open.rescues ?? RESCUES}
      extras={EXTRAS}
      failedReasons={{
        r1: { [P1]: 'job seniority junior is below yours' },
        d1: { [P1]: 'job seniority intern is below yours' },
      }}
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
      selected={open.selected ?? null}
      details={open.details ?? null}
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

  it('shows a known reason code as words and an unsure verdict as Not sure on Junk', () => {
    renderView(
      { list: 'junk' },
      {
        junk: [
          {
            ...JUNK[0],
            verdict: 'junk',
            reason: 'many_roles_across_companies',
            confidence: 'unsure',
          },
        ],
      },
    );
    const [row] = rowsOf('Junk');
    expect(within(row).getByText('Junk')).toBeTruthy();
    expect(within(row).getByText('Many roles across companies')).toBeTruthy();
    expect(within(row).getByText('Not sure')).toBeTruthy();
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

  const detailsOf = (over: Partial<PostDetails>): PostDetails =>
    ({
      jobId: 'q1',
      kind: 'post_role',
      postJobId: 'p1',
      postingUrl: 'https://www.linkedin.com/posts/q1',
      postedAt: hoursAgo(50),
      verdict: { value: 'hiring', reason: 'hiring' },
      howToApply: { kinds: ['connect_dm_comment'], email: null, links: [] },
      authorRelation: 'employer',
      sources: [
        {
          author: {
            name: 'Bob',
            profileUrl: 'https://www.linkedin.com/in/bob',
          },
          text: 'We are hiring a Go engineer',
          original: null,
        },
      ],
      emailPending: false,
      rescue: null,
      linked: [],
      ...over,
    }) as PostDetails;

  it("shows the post's section in a matched post's detail", () => {
    renderView({ job: 'q1' }, { selected: QUALIFIED, details: detailsOf({}) });
    const article = within(screen.getByRole('article'));
    expect(article.getByText(/Why it matched/)).toBeTruthy();
    expect(
      article.getByText('DM, comment or connect with the author'),
    ).toBeTruthy();
    expect(article.getByText('We are hiring a Go engineer')).toBeTruthy();
  });

  it('shows a Junk post with its verdict instead of "not in your matches"', () => {
    renderView(
      { list: 'junk', job: 'j1' },
      {
        details: detailsOf({
          jobId: 'j1',
          kind: 'post',
          verdict: {
            value: 'not_hiring',
            reason: 'the author is looking for a job',
          },
          howToApply: null,
        }),
      },
    );
    const article = within(screen.getByRole('article'));
    expect(
      article.getByText('Not hiring · the author is looking for a job'),
    ).toBeTruthy();
    expect(screen.queryByText("This job isn't in your matches")).toBeNull();
    expect(screen.queryByText(/Why it matched/)).toBeNull();
  });

  describe('rescue', () => {
    it('rescues a Junk post with an optional note', async () => {
      vi.mocked(rescuePostAction).mockResolvedValue({ status: 'saved' });
      renderView(
        { list: 'junk', job: 'j1' },
        {
          details: detailsOf({
            jobId: 'j1',
            kind: 'post',
            verdict: { value: 'not_hiring', reason: 'r' },
            howToApply: null,
          }),
        },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Rescue' }));
      fireEvent.change(
        screen.getByLabelText('Why this one is for you (optional)'),
        { target: { value: 'good fit' } },
      );
      const dialog = within(screen.getByRole('dialog'));
      fireEvent.click(dialog.getByRole('button', { name: 'Rescue' }));
      await waitFor(() =>
        expect(rescuePostAction).toHaveBeenCalledWith({
          jobId: 'j1',
          note: 'good fit',
        }),
      );
    });

    const disq = (over: Parameters<typeof post>[0]) => [
      post({
        jobId: 'd1',
        title: 'Junior role',
        outcome: 'rejected',
        ...over,
      }),
    ];

    it('offers Rescue on a Disqualified role', () => {
      renderView(
        { list: 'disqualified', job: 'd1' },
        { selected: disq({}), details: detailsOf({ jobId: 'd1' }) },
      );
      expect(screen.getByRole('button', { name: 'Rescue' })).toBeTruthy();
    });

    it('offers no second Rescue on a role a Junk rescue of its post covers', () => {
      const rescues = [
        {
          ...RESCUES[0],
          jobId: 'post1',
          kind: 'post',
          origin: 'junk',
          coveredJobIds: ['d1'],
        },
      ] as unknown as RescueRow[];
      renderView(
        { list: 'disqualified', job: 'd1' },
        { selected: disq({}), details: detailsOf({ jobId: 'd1' }), rescues },
      );
      expect(screen.queryByRole('button', { name: 'Rescue' })).toBeNull();
      // Listed: r1 (not rescued here), not the covered d1.
      expect(
        rowsOf('Disqualified').map((r) => within(r).queryByText('Junior role')),
      ).toEqual([null]);
    });

    it('offers no Rescue on a role rejected for a blocked author', () => {
      renderView(
        { list: 'disqualified', job: 'd1' },
        {
          selected: disq({
            checks: [
              {
                rule: 'blockedAuthor',
                outcome: 'fail',
                reason: 'you blocked Bob',
              },
            ],
          }),
          details: detailsOf({ jobId: 'd1' }),
        },
      );
      expect(screen.queryByRole('button', { name: 'Rescue' })).toBeNull();
    });

    it('offers Unblock on a blockedAuthor row and calls the action', async () => {
      vi.mocked(unblockAuthorAction).mockResolvedValue({ status: 'saved' });
      renderView(
        { list: 'disqualified', job: 'd1' },
        {
          selected: disq({
            checks: [
              {
                rule: 'blockedAuthor',
                outcome: 'fail',
                jobValue: ['profile:jane'],
                reason: 'you blocked Jane Doe',
              },
            ],
          }),
          details: detailsOf({ jobId: 'd1' }),
        },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Unblock Jane Doe' }));
      await waitFor(() =>
        expect(unblockAuthorAction).toHaveBeenCalledWith('profile:jane'),
      );
    });

    it('offers no Rescue on a role the user moved out of Review', () => {
      renderView(
        { list: 'disqualified', job: 'd1' },
        {
          selected: disq({ reviewChoice: 'rejected' }),
          details: detailsOf({ jobId: 'd1' }),
        },
      );
      expect(screen.queryByRole('button', { name: 'Rescue' })).toBeNull();
    });

    it('decides a Junk rescue, which has no match row, like any match', async () => {
      vi.mocked(decideJobAction).mockResolvedValue({ status: 'saved' });
      const rescues = [
        ...RESCUES,
        {
          jobId: 'jr1',
          kind: 'post',
          origin: 'junk',
          profileIds: [P1],
          title: null,
          companyName: null,
          postingUrl: 'https://www.linkedin.com/posts/jr1',
          postedAt: hoursAgo(3),
          firstSeenAt: hoursAgo(3),
          authorName: 'Jane Doe',
          decisionStatus: null,
        },
      ] as unknown as RescueRow[];
      renderView(
        { list: 'matches', job: 'jr1' },
        {
          selected: [],
          rescues,
          details: detailsOf({
            jobId: 'jr1',
            kind: 'post',
            postJobId: 'jr1',
            howToApply: null,
            rescue: {
              origin: 'junk',
              createdAt: hoursAgo(1),
              note: null,
              verdict: { value: 'junk', reason: 'funnel', confidence: 'sure' },
            },
          }),
        },
      );
      const article = within(screen.getByRole('article'));
      expect(article.getByText('Junk · Sells to job seekers')).toBeTruthy();
      expect(article.getByRole('button', { name: 'Undo rescue' })).toBeTruthy();
      expect(article.getByRole('button', { name: 'Not for me' })).toBeTruthy();
      expect(article.getByRole('button', { name: 'Expired' })).toBeTruthy();
      fireEvent.click(article.getByRole('button', { name: 'Applied' }));
      await waitFor(() =>
        expect(decideJobAction).toHaveBeenCalledWith({
          jobId: 'jr1',
          status: 'applied',
        }),
      );
    });

    it('shows Undo rescue on a rescued post without a decision', async () => {
      vi.mocked(undoRescueAction).mockResolvedValue({ status: 'saved' });
      renderView(
        { list: 'matches', job: 'r1' },
        {
          selected: [
            post({ jobId: 'r1', title: 'Rescued role', outcome: 'rejected' }),
          ],
          details: detailsOf({
            jobId: 'r1',
            rescue: { origin: 'disqualified' },
          }),
        },
      );
      expect(screen.queryByRole('button', { name: 'Rescue' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Undo rescue' }));
      await waitFor(() => expect(undoRescueAction).toHaveBeenCalledWith('r1'));
    });
  });
});

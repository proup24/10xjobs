import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppView } from '@/lib/applications/view-state';
import type { JobPosting } from '@/lib/matches/postings';
import type { DecisionRow } from '@/lib/applications/load';
import type { MatchRow } from '@/lib/matches/group';
import {
  NOW,
  P1,
  hoursAgo,
  labels,
  matchRow,
} from '@/components/matches/test-fixtures';
import { ApplicationsView } from './applications-view';

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));
const decideJobAction = vi.hoisted(() => vi.fn());
const clearJobDecisionAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/actions', () => ({
  decideJobAction,
  clearJobDecisionAction,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  decideJobAction.mockReset();
  clearJobDecisionAction.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

// The generated row type says non-null; the columns are nullable in Postgres.
type Over = { [K in keyof DecisionRow]?: DecisionRow[K] | null };

const decision = (over: Over = {}): DecisionRow =>
  ({
    jobId: 'J',
    status: 'applied',
    reason: null,
    note: null,
    decidedAt: hoursAgo(48),
    kind: 'job',
    title: 'Senior Full-stack Engineer',
    companyName: 'Acme',
    location: 'Paris, France',
    publishedAt: null,
    postedAt: hoursAgo(100),
    closed: false,
    postingUrl: 'https://www.linkedin.com/jobs/view/1',
    applyUrl: null,
    channels: ['LINKEDIN_JOB_BOARD'],
    hasMatch: true,
    ...over,
  }) as DecisionRow;

const DECISIONS: DecisionRow[] = [
  decision({ jobId: 'a1', title: 'Applied one', decidedAt: hoursAgo(5) }),
  decision({
    jobId: 'a2',
    title: 'Applied two',
    companyName: 'Globex',
    location: 'Berlin, Germany',
    decidedAt: hoursAgo(48),
  }),
  decision({
    jobId: 'd1',
    title: 'Dismissed one',
    status: 'dismissed',
    reason: 'seniority',
    note: 'Wants a lead',
    decidedAt: hoursAgo(72),
  }),
  decision({
    jobId: 'x1',
    title: 'Expired one',
    status: 'expired',
    decidedAt: hoursAgo(48),
  }),
];

function renderView(
  opts: {
    decisions?: DecisionRow[];
    initial?: Partial<AppView>;
    selected?: MatchRow[] | null;
    postings?: JobPosting[];
  } = {},
) {
  render(
    <ApplicationsView
      decisions={opts.decisions ?? DECISIONS}
      initial={{ status: 'applied', job: null, ...opts.initial }}
      now={NOW}
      userId="u1"
      labels={labels}
      profileLabels={{ [P1]: 'Full-stack engineer' }}
      selected={opts.selected ?? null}
      postings={opts.postings ?? []}
    />,
  );
}

const list = (name: string) => screen.getByRole('list', { name });

describe('ApplicationsView list', () => {
  it('lists applied jobs by default with counts on the three switches', () => {
    renderView();
    const tabs = within(screen.getByRole('tablist', { name: 'Status' }));
    expect(tabs.getByRole('tab', { name: 'Applied (2)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Not for me (1)' })).toBeTruthy();
    expect(tabs.getByRole('tab', { name: 'Expired (1)' })).toBeTruthy();
    const links = within(list('Applied')).getAllByRole('link');
    expect(links.map((l) => l.querySelector('h3')?.textContent)).toEqual([
      'Applied one',
      'Applied two',
    ]);
    expect(links[0].textContent).toContain('Acme · Paris, France');
    expect(links[0].textContent).toContain('LinkedIn');
    expect(links[0].textContent).toContain('Applied 5 h ago');
    expect(links[1].textContent).toContain('Applied 2 days ago');
    expect(links[0].getAttribute('href')).toBe('/applications?job=a1');
  });

  it('switches to Not for me in the URL, closing the open job', () => {
    renderView({ initial: { job: 'a1' }, selected: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Not for me (1)' }));
    expect(push).toHaveBeenCalledWith('/applications?status=dismissed');
  });

  it('switches to Expired in the URL, closing the open job', () => {
    renderView({ initial: { job: 'a1' }, selected: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Expired (1)' }));
    expect(push).toHaveBeenCalledWith('/applications?status=expired');
  });

  it('shows "Marked expired" on an expired row', () => {
    renderView({ initial: { status: 'expired' } });
    const [row] = within(list('Expired')).getAllByRole('link');
    expect(row.textContent).toContain('Expired one');
    expect(row.textContent).toContain('Marked expired 2 days ago');
    expect(row.getAttribute('href')).toBe(
      '/applications?status=expired&job=x1',
    );
  });

  it('opens a job under its own status when the link names the other', () => {
    renderView({ initial: { status: 'applied', job: 'd1' }, selected: [] });
    expect(
      screen
        .getByRole('tab', { name: 'Not for me (1)' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(within(list('Not for me')).getByText('Dismissed one')).toBeTruthy();
    expect(screen.getByText('Wants a lead')).toBeTruthy();
  });

  it('shows the reason on a not-for-me row', () => {
    renderView({ initial: { status: 'dismissed' } });
    const [row] = within(list('Not for me')).getAllByRole('link');
    expect(row.textContent).toContain('Dismissed one');
    expect(row.textContent).toContain(
      'Not for me · Wrong seniority · 3 days ago',
    );
    expect(row.getAttribute('href')).toBe(
      '/applications?status=dismissed&job=d1',
    );
  });

  it('marks a post role as a social post', () => {
    renderView({
      decisions: [
        decision({ jobId: 'p1', title: 'Post role', kind: 'post_role' }),
        decision({ jobId: 'l1', title: 'Listing' }),
      ],
    });
    const [post, listing] = within(list('Applied')).getAllByRole('link');
    expect(within(post).getByText('Social post')).toBeTruthy();
    expect(within(listing).queryByText('Social post')).toBeNull();
  });

  it('shows Closed on a closed job', () => {
    renderView({
      decisions: [
        decision({ jobId: 'c1', title: 'Closed one', closed: true }),
        decision({ jobId: 'o1', title: 'Open one' }),
      ],
    });
    const [closed, open] = within(list('Applied')).getAllByRole('link');
    expect(within(closed).getByText('Closed')).toBeTruthy();
    expect(within(open).queryByText('Closed')).toBeNull();
  });

  it('shows the empty state for each status', () => {
    renderView({ decisions: [] });
    expect(screen.getByText('Jobs you mark applied show here')).toBeTruthy();
    cleanup();
    renderView({ decisions: [], initial: { status: 'dismissed' } });
    expect(screen.getByText('Jobs you mark not for me show here')).toBeTruthy();
    cleanup();
    renderView({ decisions: [], initial: { status: 'expired' } });
    expect(screen.getByText('Jobs you mark expired show here')).toBeTruthy();
  });
});

describe('ApplicationsView detail', () => {
  it('shows why it matched when the match is still there', () => {
    renderView({
      initial: { job: 'a1' },
      selected: [matchRow({ jobId: 'a1', title: 'Applied one' })],
    });
    expect(screen.getByRole('heading', { name: 'Applied one', level: 2 }));
    expect(screen.getByText(/Why it matched/)).toBeTruthy();
    // The matches page's own actions are not offered here.
    expect(screen.queryByRole('button', { name: 'Applied' })).toBeNull();
  });

  it('puts the actions under the post links, before the description', () => {
    renderView({
      initial: { job: 'a1' },
      selected: [
        matchRow({
          jobId: 'a1',
          title: 'Applied one',
          descriptionText: 'The job description',
        }),
      ],
    });
    const open = screen.getByRole('link', { name: 'Open post' });
    const move = screen.getByRole('button', { name: 'Move to Not for me' });
    const description = screen.getByText('The job description');
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(open, move)).toBe(true);
    expect(follows(move, description)).toBe(true);
  });

  it('shows the job without Why it matched when its match is gone', () => {
    renderView({ initial: { job: 'a1' }, selected: [] });
    expect(
      screen.getByRole('heading', { name: 'Applied one', level: 2 }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('article')).getByText(/Acme/, { selector: 'p' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open post' }).getAttribute('href'),
    ).toBe('https://www.linkedin.com/jobs/view/1');
    expect(screen.queryByText(/Why it matched/)).toBeNull();
    // The actions sit right under the links, inside the job's article.
    const move = within(screen.getByRole('article')).getByRole('button', {
      name: 'Move to Not for me',
    });
    expect(
      screen
        .getByRole('link', { name: 'Open post' })
        .compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the merged postings of a decided job whose match is gone', () => {
    const posting = (rawItemId: string, title: string, shown: boolean) => ({
      rawItemId,
      channel: 'linkedin-job-board',
      title,
      location: 'Berlin',
      postedAt: '2026-11-17T09:00:00Z',
      postingUrl: `https://www.linkedin.com/jobs/view/${rawItemId}`,
      shown,
      titleDiffers: !shown,
      placeDiffers: false,
      descriptionDiffers: false,
    });
    renderView({
      initial: { job: 'a1' },
      selected: [],
      postings: [
        posting('1', 'Applied one', true),
        posting('2', 'Other', false),
      ],
    });
    const article = screen.getByRole('article');
    expect(within(article).getByText('Merged · 2 postings')).toBeTruthy();
    expect(
      within(article).getByText('2 postings share this apply link'),
    ).toBeTruthy();
  });

  it('shows no merged postings for a decided job with one posting', () => {
    renderView({ initial: { job: 'a1' }, selected: [] });
    expect(screen.queryByText(/Merged ·/)).toBeNull();
    expect(screen.queryByText(/share this apply link/)).toBeNull();
  });

  it('shows a closed job that still has its match', () => {
    renderView({
      decisions: [
        decision({ jobId: 'a1', title: 'Applied one', closed: true }),
      ],
      initial: { job: 'a1' },
      selected: [matchRow({ jobId: 'a1', title: 'Applied one', closed: true })],
    });
    expect(
      screen.getByRole('heading', { name: 'Applied one', level: 2 }),
    ).toBeTruthy();
    expect(screen.getByText(/Why it matched/)).toBeTruthy();
  });

  it('says so when the job is not in Applications', () => {
    renderView({ initial: { job: 'gone' }, selected: [] });
    expect(
      screen.getByText("This job isn't in your applications"),
    ).toBeTruthy();
  });

  it('Move back to Matches asks first, then clears', async () => {
    clearJobDecisionAction.mockResolvedValue({ status: 'saved' });
    renderView({ initial: { job: 'a1' }, selected: [] });
    fireEvent.click(
      screen.getByRole('button', { name: 'Move back to Matches' }),
    );
    expect(
      await screen.findByText(
        'Move back to Matches? It shows there again only if it still matches and was seen in the last 7 days.',
      ),
    ).toBeTruthy();
    expect(clearJobDecisionAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move back' }));
    await waitFor(() =>
      expect(clearJobDecisionAction).toHaveBeenCalledWith('a1'),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/applications'));
    expect(refresh).toHaveBeenCalled();
  });

  it('Move to Not for me saves a dismissal and follows the job', async () => {
    decideJobAction.mockResolvedValue({ status: 'saved' });
    renderView({ initial: { job: 'a1' }, selected: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Not for me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not for me' }));
    await waitFor(() =>
      expect(decideJobAction).toHaveBeenCalledWith({
        jobId: 'a1',
        status: 'dismissed',
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/applications?status=dismissed&job=a1',
      ),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the reason and note, and Mark applied moves it to Applied', async () => {
    decideJobAction.mockResolvedValue({ status: 'saved' });
    renderView({
      initial: { status: 'dismissed', job: 'd1' },
      selected: [],
    });
    expect(screen.getByText('Wrong seniority')).toBeTruthy();
    expect(screen.getByText('Wants a lead')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
    await waitFor(() =>
      expect(decideJobAction).toHaveBeenCalledWith({
        jobId: 'd1',
        status: 'applied',
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/applications?job=d1'),
    );
  });

  it('Edit reason saves the new reason', async () => {
    decideJobAction.mockResolvedValue({ status: 'saved' });
    renderView({
      initial: { status: 'dismissed', job: 'd1' },
      selected: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit reason' }));
    const select = await screen.findByRole('combobox');
    expect(select.textContent).toContain('Wrong seniority');
    expect((screen.getByLabelText(/note/i) as HTMLTextAreaElement).value).toBe(
      'Wants a lead',
    );
    fireEvent.click(select);
    const option = await screen.findByRole('option', { name: 'Salary' });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(decideJobAction).toHaveBeenCalledWith({
        jobId: 'd1',
        status: 'dismissed',
        reason: 'salary',
        note: 'Wants a lead',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('an expired job offers Mark applied, Move to Not for me and Move back', () => {
    renderView({ initial: { status: 'expired', job: 'x1' }, selected: [] });
    expect(
      screen.getByRole('heading', { name: 'Marked expired 2 days ago' }),
    ).toBeTruthy();
    expect(screen.queryByText('Reason')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark applied' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Move to Not for me' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Move back to Matches' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit reason' })).toBeNull();
  });

  it('Mark applied on an expired job moves it to Applied', async () => {
    decideJobAction.mockResolvedValue({ status: 'saved' });
    renderView({ initial: { status: 'expired', job: 'x1' }, selected: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
    await waitFor(() =>
      expect(decideJobAction).toHaveBeenCalledWith({
        jobId: 'x1',
        status: 'applied',
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/applications?job=x1'),
    );
    expect(toast.success).toHaveBeenCalledWith('Moved to Applied');
  });

  it('Move to Not for me on an expired job saves a dismissal', async () => {
    decideJobAction.mockResolvedValue({ status: 'saved' });
    renderView({ initial: { status: 'expired', job: 'x1' }, selected: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Not for me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not for me' }));
    await waitFor(() =>
      expect(decideJobAction).toHaveBeenCalledWith({
        jobId: 'x1',
        status: 'dismissed',
      }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/applications?status=dismissed&job=x1',
      ),
    );
  });

  it('reports a refused save with a toast', async () => {
    decideJobAction.mockResolvedValue({ status: 'failed' });
    renderView({
      initial: { status: 'dismissed', job: 'd1' },
      selected: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark applied' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
    expect(push).not.toHaveBeenCalled();
  });
});

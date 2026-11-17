import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notCheckedText } from '@/lib/matches/checks';
import { groupByJob } from '@/lib/matches/group';
import { MatchDetail } from './match-detail';
import type { MatchRow } from '@/lib/matches/group';
import { MatchRowLink } from './match-row';
import {
  NOW,
  P1,
  P2,
  checks,
  hoursAgo,
  facts,
  labels,
  matchRow,
} from './test-fixtures';

const refresh = vi.hoisted(() => vi.fn());
const markViewed = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({}),
}));
vi.mock('@/lib/matches/mark-viewed', () => ({ markViewed }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  refresh.mockReset();
  markViewed.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const PROFILE_LABELS = {
  [P1]: 'Full-stack engineer',
  [P2]: 'Backend engineer',
};

const renderDetail = (
  rows = [matchRow()],
  onDecide?: (d: {
    matchId: string;
    choice: 'qualified' | 'rejected';
  }) => Promise<{ status: 'saved' } | { status: 'failed' }>,
) =>
  render(
    <MatchDetail
      rows={rows}
      labels={labels}
      profileLabels={PROFILE_LABELS}
      now={new Date(NOW)}
      userId="u1"
      backHref="/"
      onDecide={onDecide}
    />,
  );

/** A row the matcher sent to review: seniority failed on an unsure value. */
const reviewRow = () =>
  matchRow({
    matchId: 'm-review',
    outcome: 'review',
    reviewRule: 'seniority',
    reviewField: 'seniority',
    unverified: false,
    checks: [
      ...checks,
      {
        rule: 'seniority',
        outcome: 'fail',
        jobValue: 'staff',
        profileValue: ['senior'],
        reason: 'job seniority staff is not in your seniorities [senior]',
        unsure: true,
        unsureField: 'seniority',
      },
    ],
    facts: {
      ...facts,
      seniority: {
        code: 'staff',
        label: 'Staff',
        source: 'description',
        quote: 'You will lead as a staff-level engineer',
      },
    },
    conflicts: [{ field: 'seniority', listingValue: 'Mid-Senior level' }],
  });

const renderWithJobDecision = (
  row: MatchRow,
  onDecideJob = vi.fn().mockResolvedValue(true),
) => {
  render(
    <MatchDetail
      rows={[row]}
      labels={labels}
      profileLabels={PROFILE_LABELS}
      now={new Date(NOW)}
      userId="u1"
      backHref="/"
      onDecideJob={onDecideJob}
    />,
  );
  return onDecideJob;
};

describe('MatchDetail job decisions', () => {
  it('shows Applied and Not for me on a match', () => {
    renderWithJobDecision(matchRow());
    expect(screen.getByRole('button', { name: 'Applied' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Not for me' })).toBeTruthy();
  });

  it('hides them on a review row', () => {
    renderWithJobDecision(reviewRow());
    expect(screen.queryByRole('button', { name: 'Applied' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Not for me' })).toBeNull();
  });

  it("Applied calls onDecide('applied')", async () => {
    const onDecideJob = renderWithJobDecision(matchRow());
    fireEvent.click(screen.getByRole('button', { name: 'Applied' }));
    await vi.waitFor(() => expect(onDecideJob).toHaveBeenCalledWith('applied'));
  });

  it('Not for me opens the dialog', async () => {
    const onDecideJob = renderWithJobDecision(matchRow());
    fireEvent.click(screen.getByRole('button', { name: 'Not for me' }));
    const dialog = await screen.findByRole('dialog');
    expect(onDecideJob).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not for me' }));
    await vi.waitFor(() =>
      expect(onDecideJob).toHaveBeenCalledWith('dismissed', {}),
    );
  });
});

describe('MatchDetail', () => {
  it('offers one "Report a mismatch" under the facts only with a report handler', () => {
    const { unmount } = renderDetail();
    expect(
      screen.queryByRole('button', { name: /report a mismatch/i }),
    ).toBeNull();
    unmount();
    render(
      <MatchDetail
        rows={[matchRow()]}
        labels={labels}
        profileLabels={PROFILE_LABELS}
        now={new Date(NOW)}
        userId="u1"
        backHref="/"
        onReport={vi.fn()}
      />,
    );
    const links = screen.getAllByRole('button', {
      name: /report a mismatch/i,
    });
    expect(links).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Report a mismatch' })).toBe(
      links[0],
    );
  });

  it('reports a fact from the single link', async () => {
    const onReport = vi.fn().mockResolvedValue({ status: 'saved' });
    render(
      <MatchDetail
        rows={[matchRow()]}
        labels={labels}
        profileLabels={PROFILE_LABELS}
        now={new Date(NOW)}
        userId="u1"
        backHref="/"
        onReport={onReport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report a mismatch' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
    const item = await screen.findByRole('option', { name: 'Salary' });
    fireEvent.pointerDown(item, { pointerType: 'mouse' });
    fireEvent.click(item);
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: '€80k' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith({
        jobId: matchRow().jobId,
        field: 'salary',
        proposedValue: '€80k',
      }),
    );
  });

  it('marks the job viewed, then refreshes, when "Open post" or "Apply" is clicked', async () => {
    markViewed.mockResolvedValue(undefined);
    renderDetail([
      matchRow({ jobId: 'j9', applyUrl: 'https://acme.test/apply' }),
    ]);
    fireEvent.click(screen.getByRole('link', { name: 'Open post' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(markViewed).toHaveBeenCalledTimes(1);
    expect(markViewed).toHaveBeenLastCalledWith(expect.anything(), 'u1', 'j9');
    fireEvent.click(screen.getByRole('link', { name: 'Apply' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(markViewed).toHaveBeenCalledTimes(2);
    expect(markViewed).toHaveBeenLastCalledWith(expect.anything(), 'u1', 'j9');
  });

  it('opens the post in a new tab', () => {
    renderDetail();
    const open = screen.getByRole('link', { name: 'Open post' });
    expect(open.getAttribute('href')).toBe(
      'https://www.linkedin.com/jobs/view/1',
    );
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('has no "Apply" without an apply URL, and one with it', () => {
    renderDetail();
    expect(screen.queryByRole('link', { name: 'Apply' })).toBeNull();
    cleanup();
    renderDetail([matchRow({ applyUrl: 'https://acme.test/apply' })]);
    const apply = screen.getByRole('link', { name: 'Apply' });
    expect(apply.getAttribute('href')).toBe('https://acme.test/apply');
    expect(apply.getAttribute('target')).toBe('_blank');
  });

  it('reads the title, company, place and posted time', () => {
    renderDetail([matchRow({ companyUrl: 'https://acme.test' })]);
    expect(
      screen.getByRole('heading', { name: 'Senior Full-stack Engineer' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Acme' }).getAttribute('href'),
    ).toBe('https://acme.test');
    expect(screen.getByText('posted ~3 hours ago on LinkedIn')).toBeTruthy();
  });

  it('words a date-only post by its date', () => {
    renderDetail([matchRow({ postedAt: null, publishedAt: '2026-11-09' })]);
    expect(screen.getByText('posted Nov 9 on LinkedIn')).toBeTruthy();
  });

  it('lists the facts, with "Not stated" for what the job does not say', () => {
    renderDetail();
    expect(screen.getByText('Full-stack engineer')).toBeTruthy();
    expect(screen.getByText('Senior · 5+ years')).toBeTruthy();
    expect(screen.getByText('Remote')).toBeTruthy();
    expect(screen.getByText('Europe (CET)')).toBeTruthy();
    const salary = screen.getByText('Salary').nextElementSibling;
    expect(salary?.textContent).toBe('Not stated');
    const contract = screen.getByText('Contract type').nextElementSibling;
    expect(contract?.textContent).toBe('Not stated');
  });

  it('shows "From LinkedIn" next to a LinkedIn fact only', () => {
    renderDetail([
      matchRow({
        facts: {
          ...facts,
          arrangement: { ...facts.arrangement, source: 'linkedin' },
        },
      }),
    ]);
    expect(screen.getAllByText('From LinkedIn')).toHaveLength(1);
    const arrangement = screen.getByText('Arrangement').parentElement;
    expect(arrangement?.textContent).toContain('From LinkedIn');
    const role = screen.getByText('Role').parentElement;
    expect(role?.textContent).not.toContain('From LinkedIn');
  });

  it('shows "From LinkedIn" on places only when only the places came from LinkedIn', () => {
    renderDetail([
      matchRow({
        facts: {
          ...facts,
          openings: facts.openings.map((o) => ({
            ...o,
            placesSource: 'linkedin',
          })),
        },
      }),
    ]);
    expect(screen.getAllByText('From LinkedIn')).toHaveLength(1);
    const places = screen.getByText('Europe (CET)').parentElement;
    expect(places?.textContent).toContain('From LinkedIn');
    const arrangement = screen.getByText('Arrangement').parentElement;
    expect(arrangement?.textContent).not.toContain('From LinkedIn');
  });

  it('lists a conflict under its fact', () => {
    renderDetail([
      matchRow({
        conflicts: [
          {
            field: 'arrangement',
            listingValue: 'onsite',
            descriptionValue: ['remote'],
            winner: 'description',
          },
        ],
      }),
    ]);
    const arrangement = screen.getByText('Arrangement').parentElement;
    expect(arrangement?.textContent).toContain('LinkedIn says onsite');
    expect(screen.getAllByText('LinkedIn says onsite')).toHaveLength(1);
  });

  it('renders a row without job facts', () => {
    renderDetail([matchRow({ facts: null, conflicts: null })]);
    expect(screen.getByText('Role').nextElementSibling?.textContent).toBe(
      'Not stated',
    );
    expect(screen.queryByText('From LinkedIn')).toBeNull();
  });

  it('shows the stated salary', () => {
    renderDetail([matchRow({ salaryText: '€70k–90k a year' })]);
    expect(screen.getByText('Salary').nextElementSibling?.textContent).toBe(
      '€70k–90k a year',
    );
  });

  it('shows the stack coverage with labels', () => {
    renderDetail();
    expect(screen.getByText('Coverage 71%')).toBeTruthy();
    expect(screen.getByText('TypeScript')).toBeTruthy();
    expect(screen.getByText('Go')).toBeTruthy();
    expect(screen.getByText('Kubernetes')).toBeTruthy();
  });

  it('says why it matched and what was not checked', () => {
    renderDetail();
    expect(
      screen.getByText('Why it matched · Full-stack engineer'),
    ).toBeTruthy();
    expect(
      screen.getByText('Job role Full-stack engineer matches your position'),
    ).toBeTruthy();
    expect(screen.getByText(notCheckedText())).toBeTruthy();
    expect(
      screen.getByText('Not checked yet: engagement. Check it in the post.'),
    ).toBeTruthy();
  });

  it('lists the newer rules under why it matched, with their labels', () => {
    renderDetail([
      matchRow({
        checks: [
          ...checks,
          {
            rule: 'salary',
            outcome: 'pass',
            reason:
              'job pays about 95000, at or above your minimum 90000 USD per year',
          },
          {
            rule: 'workAuthorization',
            outcome: 'pass',
            reason: 'job states no work authorization requirement',
          },
        ],
      }),
    ]);
    const why = screen
      .getByText('Why it matched · Full-stack engineer')
      .closest('section');
    if (!why) throw new Error('no section');
    expect(within(why).getByText('Work authorization')).toBeTruthy();
    expect(
      within(why).getByText(
        'Job pays about 95000, at or above your minimum 90000 USD per year',
      ),
    ).toBeTruthy();
    expect(
      within(why).getByText('Job states no work authorization requirement'),
    ).toBeTruthy();
  });

  it('shows profile tabs only when several profiles matched', () => {
    renderDetail();
    expect(screen.queryByRole('tablist')).toBeNull();
    cleanup();
    renderDetail([
      matchRow({ profileId: P1 }),
      matchRow({
        profileId: P2,
        stackScore: 0.5,
        checks: [
          {
            ...checks[0],
            reason: 'job role fullstack_engineer is close to your position',
          },
        ],
      }),
    ]);
    expect(screen.getByRole('tablist')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Backend engineer' }));
    expect(screen.getByText('Why it matched · Backend engineer')).toBeTruthy();
    expect(
      screen.getByText(
        'Job role Full-stack engineer is close to your position',
      ),
    ).toBeTruthy();
  });

  it('keeps the description line breaks', () => {
    renderDetail();
    const desc = screen.getByText(/Line one/);
    expect(desc.className).toContain('whitespace-pre-line');
    expect(desc.textContent).toBe('Line one\nLine two');
  });

  it('has a back link to the list', () => {
    renderDetail([matchRow({ postedAt: hoursAgo(1) })]);
    expect(
      screen
        .getByRole('link', { name: 'Back to matches' })
        .getAttribute('href'),
    ).toBe('/');
  });
  it("MatchDetail on a review row shows the rule, the unsure fact's quote and the LinkedIn value", () => {
    renderDetail([reviewRow()], vi.fn());
    const why = screen.getByText("Why it's in review").closest('section');
    if (!why) throw new Error('no section');
    const w = within(why);
    expect(w.getByText('Would be rejected by')).toBeTruthy();
    expect(w.getAllByText('Seniority').length).toBeGreaterThan(0);
    expect(w.getByText('Unsure about')).toBeTruthy();
    expect(
      w.getByText('“You will lead as a staff-level engineer”'),
    ).toBeTruthy();
    expect(w.getByText('LinkedIn says Mid-Senior level')).toBeTruthy();
    // A review row did not match: its checks are not "why it matched".
    expect(screen.queryByText(/Why it matched/)).toBeNull();
    expect(screen.getByText('Checks · Full-stack engineer')).toBeTruthy();
  });

  it('names the location fact and its LinkedIn places on an openings review', () => {
    const row = reviewRow();
    renderDetail(
      [
        {
          ...row,
          reviewRule: 'location',
          reviewField: 'openings',
          facts: {
            ...facts,
            openings: [{ ...facts.openings[0], quote: 'Remote in Europe' }],
          },
          conflicts: [
            {
              field: 'places',
              listingValue: [{ kind: 'country', label: 'France' }],
            },
          ],
        },
      ],
      vi.fn(),
    );
    const why = screen.getByText("Why it's in review").closest('section');
    if (!why) throw new Error('no section');
    expect(within(why).getByText('Location')).toBeTruthy();
    expect(within(why).getByText('Where and how you work')).toBeTruthy();
    expect(within(why).getByText('“Remote in Europe”')).toBeTruthy();
    expect(within(why).getByText('LinkedIn says France')).toBeTruthy();
  });

  it('shows no decision buttons on a qualified row', () => {
    renderDetail([matchRow()], vi.fn());
    expect(
      screen.queryByRole('button', { name: 'Move to matches' }),
    ).toBeNull();
    expect(screen.queryByText("Why it's in review")).toBeNull();
  });

  it('clicking Move to matches calls onDecide with qualified', async () => {
    const onDecide = vi.fn().mockResolvedValue({ status: 'saved' });
    renderDetail([reviewRow()], onDecide);
    fireEvent.click(screen.getByRole('button', { name: 'Move to matches' }));
    await vi.waitFor(() =>
      expect(onDecide).toHaveBeenCalledWith({
        matchId: 'm-review',
        choice: 'qualified',
      }),
    );
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Moved to matches'),
    );
  });

  it('Reject calls onDecide with rejected and shows a toast', async () => {
    const onDecide = vi.fn().mockResolvedValue({ status: 'saved' });
    renderDetail([reviewRow()], onDecide);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'Reject this job? It will leave your review list.',
      ),
    ).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await vi.waitFor(() =>
      expect(onDecide).toHaveBeenCalledWith({
        matchId: 'm-review',
        choice: 'rejected',
      }),
    );
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Rejected'),
    );
  });

  it('reports a failed decision with an error toast', async () => {
    const onDecide = vi.fn().mockResolvedValue({ status: 'failed' });
    renderDetail([reviewRow()], onDecide);
    fireEvent.click(screen.getByRole('button', { name: 'Move to matches' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('marks a check that passes on an unsure value, so the Unverified badge has its reason', () => {
    renderDetail([
      matchRow({
        unverified: true,
        checks: [
          {
            rule: 'seniority',
            outcome: 'pass',
            reason: 'job seniority senior is in your seniorities [senior]',
            unsure: true,
            unsureField: 'seniority',
          },
        ],
      }),
    ]);
    const why = screen
      .getByText('Why it matched · Full-stack engineer')
      .closest('section');
    if (!why) throw new Error('no section');
    expect(within(why).getByText('(unsure)')).toBeTruthy();
  });
  it('shows a job the user moved from review as a match, with the review check muted', () => {
    renderDetail([{ ...reviewRow(), reviewChoice: 'qualified' }], vi.fn());
    expect(screen.queryByText("Why it's in review")).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Move to matches' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    const why = screen
      .getByText('Why it matched · Full-stack engineer')
      .closest('section');
    if (!why) throw new Error('no section');
    expect(within(why).getByText('You moved this from review.')).toBeTruthy();
    expect(within(why).queryByLabelText('Fail')).toBeNull();
    const mark = within(why).getByLabelText('Sent to review');
    expect(mark.getAttribute('class')).toContain('text-muted-foreground');
    expect(mark.getAttribute('class')).not.toContain('text-destructive');
  });

  it('says nothing about review on a plain match', () => {
    renderDetail([matchRow({ reviewChoice: null })]);
    expect(screen.queryByText('You moved this from review.')).toBeNull();
  });
  // R67a: the fact a review rests on can be reported where it matters, including the ones
  // the fact list does not show (tech stack, languages, work authorization).
  const renderReview = (
    row: ReturnType<typeof reviewRow>,
    onReport = vi.fn().mockResolvedValue({ status: 'saved' }),
  ) => {
    render(
      <MatchDetail
        rows={[row]}
        labels={labels}
        profileLabels={PROFILE_LABELS}
        now={new Date(NOW)}
        userId="u1"
        backHref="/"
        onDecide={vi.fn()}
        onReport={onReport}
      />,
    );
    const why = screen.getByText("Why it's in review").closest('section');
    if (!why) throw new Error('no section');
    return { why: within(why), onReport };
  };

  it('a review row has the facts link and the review link', () => {
    renderReview({
      ...reviewRow(),
      reviewRule: 'rule',
      reviewField: 'seniority',
    });
    const names = screen
      .getAllByRole('button', { name: /report a mismatch/i })
      .map((b) => b.textContent);
    expect(names).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Report a mismatch' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Report a mismatch on Seniority' }),
    ).toBeTruthy();
  });

  it.each([
    ['techStack', 'Tech stack', 'techStack'],
    ['requiredLanguages', 'Required languages', 'requiredLanguages'],
    ['workAuthorization', 'Work authorization', 'workAuthorization'],
    ['seniority', 'Seniority', 'seniority'],
    ['yearsRequired', 'Years of experience required', 'yearsRequired'],
    ['openings', 'Where and how you work', 'places'],
  ])(
    'offers "Report a mismatch" on the %s fact a review rests on',
    async (reviewField, label, field) => {
      const { why, onReport } = renderReview({
        ...reviewRow(),
        reviewRule: 'rule',
        reviewField,
      });
      fireEvent.click(
        why.getByRole('button', { name: `Report a mismatch on ${label}` }),
      );
      fireEvent.change(screen.getByLabelText(/what it should say/i), {
        target: { value: 'Not required' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
      await waitFor(() =>
        expect(onReport).toHaveBeenCalledWith({
          jobId: reviewRow().jobId,
          field,
          proposedValue: 'Not required',
        }),
      );
    },
  );

  it('offers no review report without a report handler', () => {
    renderDetail([reviewRow()], vi.fn());
    const why = screen.getByText("Why it's in review").closest('section');
    if (!why) throw new Error('no section');
    expect(
      within(why).queryByRole('button', { name: /report a mismatch/i }),
    ).toBeNull();
  });

  // R65: match_details returns unverified = true for a review row the user moved to Matches.
  it('keeps the detail line for a job moved from review, with no Unverified badge on its row', () => {
    const accepted = {
      ...reviewRow(),
      reviewChoice: 'qualified',
      unverified: true,
    };
    render(
      <MatchRowLink
        job={groupByJob([accepted])[0]}
        href="/"
        now={new Date(NOW)}
        profileLabels={PROFILE_LABELS}
        selected={false}
        showProfiles={false}
      />,
    );
    expect(screen.queryByText('Unverified')).toBeNull();
    cleanup();
    renderDetail([accepted], vi.fn());
    expect(screen.getByText('You moved this from review.')).toBeTruthy();
  });
});

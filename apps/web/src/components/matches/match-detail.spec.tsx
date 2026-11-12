import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notCheckedText } from '@/lib/matches/checks';
import { MatchDetail } from './match-detail';
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

afterEach(() => {
  cleanup();
  refresh.mockReset();
  markViewed.mockReset();
});

const PROFILE_LABELS = {
  [P1]: 'Full-stack engineer',
  [P2]: 'Backend engineer',
};

const renderDetail = (rows = [matchRow()]) =>
  render(
    <MatchDetail
      rows={rows}
      labels={labels}
      profileLabels={PROFILE_LABELS}
      now={new Date(NOW)}
      userId="u1"
      backHref="/"
    />,
  );

describe('MatchDetail', () => {
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
});

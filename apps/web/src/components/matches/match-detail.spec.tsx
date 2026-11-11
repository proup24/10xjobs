import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { notCheckedText } from '@/lib/matches/checks';
import { MatchDetail } from './match-detail';
import {
  NOW,
  P1,
  P2,
  checks,
  hoursAgo,
  labels,
  matchRow,
} from './test-fixtures';

afterEach(cleanup);

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
      backHref="/"
    />,
  );

describe('MatchDetail', () => {
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

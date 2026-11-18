import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groupByJob } from '@/lib/matches/group';
import { MatchRowLink } from './match-row';
import { NOW, P1, P2, hoursAgo, matchRow } from './test-fixtures';

afterEach(cleanup);

const PROFILE_LABELS = {
  [P1]: 'Full-stack engineer',
  [P2]: 'Backend engineer',
};

function renderRow(rows = [matchRow()], opts: { showProfiles?: boolean } = {}) {
  const [job] = groupByJob(rows);
  render(
    <MatchRowLink
      job={job}
      href="/?job=J"
      selected={false}
      now={new Date(NOW)}
      showProfiles={opts.showProfiles ?? false}
      profileLabels={PROFILE_LABELS}
    />,
  );
  return screen.getByRole('link');
}

describe('MatchRowLink', () => {
  it('shows "New" for a fresh exact job, with company, place, arrangement and age', () => {
    const link = renderRow();
    expect(within(link).getByText('New')).toBeTruthy();
    expect(within(link).queryByText('Viewed')).toBeNull();
    expect(
      within(link).getByText('Acme · Paris, France · Remote'),
    ).toBeTruthy();
    expect(within(link).getByText('LinkedIn · harvestapi')).toBeTruthy();
    expect(within(link).getByText('Stack 71%')).toBeTruthy();
    expect(within(link).getByText('3 h ago')).toBeTruthy();
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it('shows "Viewed" and no "New" once viewed', () => {
    const link = renderRow([matchRow({ viewedAt: hoursAgo(1) })]);
    expect(within(link).getByText('Viewed')).toBeTruthy();
    expect(within(link).queryByText('New')).toBeNull();
  });

  it('shows neither marker for an older job', () => {
    const link = renderRow([matchRow({ postedAt: hoursAgo(13) })]);
    expect(within(link).queryByText('New')).toBeNull();
    expect(within(link).queryByText('Viewed')).toBeNull();
  });

  it('shows a badge per matching profile in "All profiles"', () => {
    const link = renderRow(
      [matchRow({ profileId: P1 }), matchRow({ profileId: P2 })],
      { showProfiles: true },
    );
    expect(within(link).getByText('Full-stack engineer')).toBeTruthy();
    expect(within(link).getByText('Backend engineer')).toBeTruthy();
  });

  it('shows no profile badge for a single profile', () => {
    const link = renderRow();
    expect(within(link).queryByText('Full-stack engineer')).toBeNull();
  });

  it('shows "Stack n/a" for a null score', () => {
    const link = renderRow([matchRow({ stackScore: null })]);
    expect(within(link).getByText('Stack n/a')).toBeTruthy();
  });

  it('does not show "Unverified"', () => {
    const link = renderRow([matchRow({ unverified: true })]);
    expect(within(link).queryByText('Unverified')).toBeNull();
  });

  it('shows the date for a date-only job', () => {
    const link = renderRow([
      matchRow({ postedAt: null, publishedAt: '2026-11-09' }),
    ]);
    expect(within(link).getByText('Nov 9')).toBeTruthy();
  });
});

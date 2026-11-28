import type { PostsBudgetView } from '@xjobs/engine-client';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostsBudgetReport } from './posts-budget-report';

const dayOf = (n: number, spentUsd = 1, reachedAt: string | null = null) => ({
  dayStart: `2026-11-${String(20 + n).padStart(2, '0')}T23:00:00.000Z`,
  spentUsd,
  reachedAt,
});

const view = (over: Partial<PostsBudgetView> = {}): PostsBudgetView => ({
  limitUsd: 3,
  today: dayOf(7, 2.4),
  days: [6, 5, 4, 3, 2, 1, 0].map((n) => dayOf(n)),
  searches: [
    {
      key: 'search-old',
      profiles: 2,
      oldestCoveredUntil: '2026-11-25T10:00:00.000Z',
      overDay: true,
    },
    {
      key: 'search-never',
      profiles: 1,
      oldestCoveredUntil: null,
      overDay: false,
    },
  ],
  pausedBuilders: 4,
  fullRuns: [
    { key: 'search-full', runs: 3, lastAt: '2026-11-27T10:00:00.000Z' },
  ],
  ...over,
});

vi.mock('@/app/(app)/admin/prepare/actions', () => ({
  silenceAuthorAction: vi.fn(),
  unsilenceAuthorAction: vi.fn(),
}));

afterEach(cleanup);

describe('PostsBudgetReport', () => {
  it('shows today spend against the limit, not reached', () => {
    render(<PostsBudgetReport view={view()} />);
    expect(screen.getByText('$2.40 of $3.00')).toBeTruthy();
    expect(screen.getAllByText('not reached').length).toBeGreaterThan(0);
  });

  it('says when the limit was reached', () => {
    render(
      <PostsBudgetReport
        view={view({ today: dayOf(7, 3, '2026-11-27T14:05:00.000Z') })}
      />,
    );
    expect(screen.getByText('2026-11-27 14:05 UTC')).toBeTruthy();
  });

  it('shows seven day rows', () => {
    render(<PostsBudgetReport view={view()} />);
    const table = screen.getByRole('table', { name: 'Previous days' });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
  });

  it('flags searches over a day behind and never searched', () => {
    render(<PostsBudgetReport view={view()} />);
    expect(screen.getByText('over 24 hours behind')).toBeTruthy();
    expect(screen.getByText('never searched')).toBeTruthy();
  });

  it('shows paused builders and full runs, or none', () => {
    render(<PostsBudgetReport view={view()} />);
    expect(screen.getByText(/4 paused builders/)).toBeTruthy();
    const full = screen.getByText('search-full').closest('tr') as HTMLElement;
    expect(within(full).getByText('3')).toBeTruthy();
    cleanup();
    render(<PostsBudgetReport view={view({ fullRuns: [] })} />);
    expect(screen.getByText('none')).toBeTruthy();
  });
});

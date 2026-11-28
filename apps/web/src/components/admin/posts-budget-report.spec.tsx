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

  it('heads the day table with the Morocco day, spend and when the limit was reached', () => {
    render(<PostsBudgetReport view={view()} />);
    const table = screen.getByRole('table', { name: 'Previous days' });
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(['Morocco day', 'Spent', 'Reached']);
    // 2026-11-26T23:00Z is 00:00 on 27 November in Morocco.
    const [, first] = within(table).getAllByRole('row');
    expect(within(first as HTMLElement).getByText('2026-11-27')).toBeTruthy();
  });

  it('tells apart the parts of one search and keys rows by hash', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const part = (hash: string) => ({
      key: 'search-split',
      hash,
      profiles: 1,
      oldestCoveredUntil: null,
      overDay: false,
    });
    render(
      <PostsBudgetReport
        view={view({
          searches: [part('aaaaaaaa1111'), part('bbbbbbbb2222')],
        })}
      />,
    );
    expect(screen.getByText('part 1 (aaaaaaaa)')).toBeTruthy();
    expect(screen.getByText('part 2 (bbbbbbbb)')).toBeTruthy();
    expect(
      error.mock.calls.some((c) => String(c[0]).includes('same key')),
    ).toBe(false);
    error.mockRestore();
  });

  it('keys rows by position when an older engine sends no hash', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const part = {
      key: 'search-split',
      profiles: 1,
      oldestCoveredUntil: null,
      overDay: false,
    };
    render(<PostsBudgetReport view={view({ searches: [part, part] })} />);
    expect(screen.getByText('part 1')).toBeTruthy();
    expect(screen.getByText('part 2')).toBeTruthy();
    expect(
      error.mock.calls.some((c) => String(c[0]).includes('same key')),
    ).toBe(false);
    error.mockRestore();
  });

  it('shows no part label for a search alone under its key', () => {
    render(<PostsBudgetReport view={view()} />);
    expect(screen.queryByText(/^part /)).toBeNull();
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

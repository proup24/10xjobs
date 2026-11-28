import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
const notFound = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound }));

const engine = vi.hoisted(() => ({
  adminMe: vi.fn(),
  adminPostsBudget: vi.fn(),
}));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));

const day = {
  dayStart: '2026-11-26T23:00:00.000Z',
  spentUsd: 2.4,
  reachedAt: null,
};
const budget = {
  limitUsd: 3,
  today: day,
  days: [{ ...day, spentUsd: 1.1 }],
  searches: [],
  pausedBuilders: 0,
  fullRuns: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  notFound.mockImplementation(() => {
    throw NOT_FOUND;
  });
  engine.adminMe.mockResolvedValue({ kind: 'ok', data: { admin: true } });
  engine.adminPostsBudget.mockResolvedValue({ kind: 'ok', data: budget });
});

afterEach(cleanup);

describe('Posts budget admin page', () => {
  it.each([
    [{ kind: 'ok', data: { admin: false } }],
    [{ kind: 'forbidden' }],
    [{ kind: 'unauthorized' }],
  ])('is not found unless the engine says admin (%j)', async (me) => {
    engine.adminMe.mockResolvedValue(me);
    await expect(Page()).rejects.toBe(NOT_FOUND);
    expect(engine.adminPostsBudget).not.toHaveBeenCalled();
  });

  it('says the engine is unreachable when adminMe is unavailable', async () => {
    engine.adminMe.mockResolvedValue({ kind: 'unavailable' });
    render(await Page());
    expect(
      screen.getByText("Couldn't reach the engine; try again."),
    ).toBeTruthy();
    expect(engine.adminPostsBudget).not.toHaveBeenCalled();
  });

  it('shows the report to an admin', async () => {
    render(await Page());
    expect(screen.getByText('$2.40 of $3.00')).toBeTruthy();
    expect(screen.getByText('$1.10 of $3.00')).toBeTruthy();
  });

  it('says so when the report could not load', async () => {
    engine.adminPostsBudget.mockResolvedValue({ kind: 'unavailable' });
    render(await Page());
    expect(screen.getByText("Couldn't load the posts budget.")).toBeTruthy();
  });
});

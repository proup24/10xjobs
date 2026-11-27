import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
const notFound = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound }));

const engine = vi.hoisted(() => ({
  adminMe: vi.fn(),
  adminRescues: vi.fn(),
}));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));

const job = {
  id: 'j1',
  kind: 'post',
  title: 'Hiring a backend engineer',
  postingUrl: 'https://www.linkedin.com/posts/1',
};

const disqualified = {
  id: 'r1',
  createdAt: '2026-11-27T10:00:00.000Z',
  undoneAt: null,
  origin: 'disqualified',
  note: 'This is <b>actually</b> a fit',
  snapshot: {
    profiles: [
      {
        profileId: 'p1',
        matchId: 'm1',
        matcherVersion: 3,
        failed: [
          {
            rule: 'seniority',
            outcome: 'fail',
            reason: 'Seniority too junior',
          },
        ],
      },
    ],
    extractionId: 'e1',
  },
  job,
  user: { id: 'u1' },
};

const junk = {
  id: 'r2',
  createdAt: '2026-11-26T10:00:00.000Z',
  undoneAt: '2026-11-26T12:00:00.000Z',
  origin: 'junk',
  note: null,
  snapshot: {
    verdict: { value: 'junk', confidence: 'sure', reason: 'funnel' },
    extractionId: 'e2',
  },
  job,
  user: { id: 'u2' },
};

beforeEach(() => {
  vi.clearAllMocks();
  notFound.mockImplementation(() => {
    throw NOT_FOUND;
  });
  engine.adminMe.mockResolvedValue({ kind: 'ok', data: { admin: true } });
  engine.adminRescues.mockResolvedValue({
    kind: 'ok',
    data: { items: [disqualified, junk] },
  });
});

afterEach(cleanup);

describe('Rescues admin page', () => {
  it.each([
    [{ kind: 'ok', data: { admin: false } }],
    [{ kind: 'forbidden' }],
    [{ kind: 'unauthorized' }],
  ])('is not found unless the engine says admin (%j)', async (me) => {
    engine.adminMe.mockResolvedValue(me);
    await expect(Page()).rejects.toBe(NOT_FOUND);
    expect(engine.adminRescues).not.toHaveBeenCalled();
  });

  it('says the engine is unreachable when adminMe is unavailable', async () => {
    engine.adminMe.mockResolvedValue({ kind: 'unavailable' });
    render(await Page());
    expect(
      screen.getByText("Couldn't reach the engine; try again."),
    ).toBeTruthy();
    expect(engine.adminRescues).not.toHaveBeenCalled();
  });

  it('shows the failed reasons of a disqualified snapshot, the note as text and the post link', async () => {
    render(await Page());
    expect(screen.getByText(/Seniority too junior/)).toBeTruthy();
    expect(screen.getByText('This is <b>actually</b> a fit')).toBeTruthy();
    const link = screen.getAllByRole('link', {
      name: /open post/i,
    })[0] as HTMLElement;
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/posts/1');
  });

  it('shows the verdict and reason of a junk snapshot, and marks an undone rescue', async () => {
    render(await Page());
    expect(screen.getAllByText('junk')).toHaveLength(2);
    expect(screen.getByText(/funnel/)).toBeTruthy();
    expect(screen.getAllByText('Undone')).toHaveLength(1);
  });

  it('says so when the list could not load or is empty', async () => {
    engine.adminRescues.mockResolvedValue({ kind: 'unavailable' });
    render(await Page());
    expect(screen.getByText("Couldn't load rescues.")).toBeTruthy();
    cleanup();
    engine.adminRescues.mockResolvedValue({ kind: 'ok', data: { items: [] } });
    render(await Page());
    expect(screen.getByText('No rescues yet.')).toBeTruthy();
  });
});

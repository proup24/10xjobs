import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
const notFound = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound }));

const engine = vi.hoisted(() => ({
  adminMe: vi.fn(),
  prepareDrops: vi.fn(),
  silencedPosts: vi.fn(),
  silencedAuthors: vi.fn(),
}));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));
vi.mock('./actions', () => ({
  silenceAuthorAction: vi.fn(),
  unsilenceAuthorAction: vi.fn(),
}));

const author = {
  key: 'profile:jane',
  name: 'Jane Doe',
  headline: 'CTO at Acme',
  profileUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  notFound.mockImplementation(() => {
    throw NOT_FOUND;
  });
  engine.adminMe.mockResolvedValue({ kind: 'ok', data: { admin: true } });
  engine.prepareDrops.mockResolvedValue({
    kind: 'ok',
    data: {
      items: [
        {
          rawItemId: 'r1',
          reason: 'prepare: hashtag-spam: "#hiring"',
          rule: 'hashtag-spam',
          match: '#hiring',
          postedAt: '2026-11-20T10:00:00.000Z',
          url: 'https://www.linkedin.com/posts/1',
          author,
        },
      ],
      next: 'cursor-2',
    },
  });
  engine.silencedPosts.mockResolvedValue({
    kind: 'ok',
    data: { items: [], next: null },
  });
  engine.silencedAuthors.mockResolvedValue({ kind: 'ok', data: [] });
});

afterEach(cleanup);

const params = (sp: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(sp),
});

describe('Prepare review page', () => {
  it.each([
    [{ kind: 'ok', data: { admin: false } }],
    [{ kind: 'forbidden' }],
    [{ kind: 'unavailable' }],
  ])('is not found unless the engine says admin (%j)', async (me) => {
    engine.adminMe.mockResolvedValue(me);
    await expect(Page(params())).rejects.toBe(NOT_FOUND);
    expect(engine.prepareDrops).not.toHaveBeenCalled();
    expect(engine.silencedAuthors).not.toHaveBeenCalled();
  });

  it('renders the three sections and the rule filter for an admin', async () => {
    render(await Page(params()));
    expect(screen.getByRole('heading', { name: 'Dropped posts' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Held posts' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Silenced authors' }),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Rule' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /open post/i });
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('passes the rule and the cursors to the engine', async () => {
    render(
      await Page(params({ rule: ' hashtag-spam ', before: 'c1', held: 'h1' })),
    );
    expect(engine.prepareDrops).toHaveBeenCalledWith({
      rule: 'hashtag-spam',
      before: 'c1',
    });
    expect(engine.silencedPosts).toHaveBeenCalledWith({ before: 'h1' });
    expect(
      (screen.getByRole('textbox', { name: 'Rule' }) as HTMLInputElement).value,
    ).toBe('hashtag-spam');
    expect(
      screen.getByRole('link', { name: 'Next drops' }).getAttribute('href'),
    ).toBe('/admin/prepare?rule=hashtag-spam&before=cursor-2');
  });

  it('shows a section the engine could not load as unavailable', async () => {
    engine.prepareDrops.mockResolvedValue({
      kind: 'invalid',
      message: 'bad cursor',
    });
    render(await Page(params({ before: 'garbage' })));
    expect(screen.getByText("Couldn't load dropped posts.")).toBeTruthy();
  });
});

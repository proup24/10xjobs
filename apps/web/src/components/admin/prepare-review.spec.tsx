import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DropView,
  HeldPostView,
  SilencedAuthorView,
} from '@xjobs/engine-client';
import { PrepareReview } from './prepare-review';

const silenceAuthorAction = vi.hoisted(() => vi.fn());
const unsilenceAuthorAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/admin/prepare/actions', () => ({
  silenceAuthorAction,
  unsilenceAuthorAction,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const jane = {
  key: 'profile:jane',
  name: 'Jane Doe',
  headline: 'CTO at Acme',
  profileUrl: 'https://www.linkedin.com/in/jane',
};
const drop = (over: Partial<DropView> = {}): DropView => ({
  rawItemId: 'r1',
  reason: 'prepare: hashtag-spam: "#hiring #hiring"',
  rule: 'hashtag-spam',
  match: '#hiring #hiring',
  postedAt: '2026-11-20T10:00:00.000Z',
  url: 'https://www.linkedin.com/posts/1',
  author: jane,
  ...over,
});
const held: HeldPostView = {
  jobId: 'j1',
  url: 'https://www.linkedin.com/posts/2',
  author: { ...jane, key: 'company:acme', name: 'Acme', headline: null },
  postedAt: '2026-11-19T08:00:00.000Z',
};
const manual: SilencedAuthorView = {
  id: 's1',
  authorKey: 'company:acme',
  name: 'Acme',
  reason: 'Recruiting agency spam',
  origin: 'manual',
  evidence: null,
  createdBy: 'u1',
  createdAt: '2026-11-18T09:00:00.000Z',
};
const automatic: SilencedAuthorView = {
  ...manual,
  id: 's2',
  authorKey: 'profile:bot',
  name: 'Bot',
  reason: 'Many drops',
  origin: 'automatic',
  evidence: { drops: 12 },
  createdBy: null,
};

type Props = Parameters<typeof PrepareReview>[0];
const setup = (over: Partial<Props> = {}) =>
  render(
    <PrepareReview
      rule={null}
      drops={{ items: [drop()], next: null }}
      held={{ items: [held], next: null }}
      authors={[manual, automatic]}
      nextDropsHref={null}
      nextHeldHref={null}
      {...over}
    />,
  );

const section = (name: string) =>
  screen.getByRole('region', { name }) as HTMLElement;

beforeEach(() => {
  silenceAuthorAction.mockResolvedValue('saved');
  unsilenceAuthorAction.mockResolvedValue('saved');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PrepareReview', () => {
  it('lists a drop with its rule, matched text, author, date and a new-tab link', () => {
    setup();
    const drops = within(section('Dropped posts'));
    expect(drops.getByText('hashtag-spam')).toBeTruthy();
    expect(drops.getByText('#hiring #hiring')).toBeTruthy();
    expect(drops.getByText('Jane Doe')).toBeTruthy();
    expect(drops.getByText('CTO at Acme')).toBeTruthy();
    expect(drops.getByText('2026-11-20')).toBeTruthy();
    const link = drops.getByRole('link', { name: 'Open post' });
    expect(link.getAttribute('href')).toBe('https://www.linkedin.com/posts/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows the stored reason for a drop that is not a prepare rule', () => {
    setup({
      drops: {
        items: [drop({ reason: 'not a post', rule: null, match: null })],
        next: null,
      },
    });
    expect(
      within(section('Dropped posts')).getByText('not a post'),
    ).toBeTruthy();
  });

  it('has a rule filter that submits the rule as a search param', () => {
    setup({ rule: 'no-text' });
    const input = screen.getByRole('textbox', { name: 'Rule' });
    expect((input as HTMLInputElement).value).toBe('no-text');
    expect(input.getAttribute('name')).toBe('rule');
    const form = input.closest('form');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe('/admin/prepare');
    expect(screen.getByRole('link', { name: 'Clear filter' })).toBeTruthy();
  });

  it('lists held posts and silenced authors with origin and evidence', () => {
    setup();
    const heldPosts = within(section('Held posts'));
    expect(heldPosts.getByText('Acme')).toBeTruthy();
    expect(
      heldPosts.getByRole('link', { name: 'Open post' }).getAttribute('target'),
    ).toBe('_blank');
    const authors = within(section('Silenced authors'));
    expect(authors.getByText('Recruiting agency spam')).toBeTruthy();
    expect(authors.getByText('manual')).toBeTruthy();
    expect(authors.getByText('automatic')).toBeTruthy();
    expect(authors.getByText('{"drops":12}')).toBeTruthy();
  });

  it('shows next links when there is another page', () => {
    setup({
      nextDropsHref: '/admin/prepare?before=c2',
      nextHeldHref: '/admin/prepare?held=h2',
    });
    expect(
      screen.getByRole('link', { name: 'Next drops' }).getAttribute('href'),
    ).toBe('/admin/prepare?before=c2');
    expect(
      screen
        .getByRole('link', { name: 'Next held posts' })
        .getAttribute('href'),
    ).toBe('/admin/prepare?held=h2');
  });

  it('shows empty and unavailable sections', () => {
    setup({ drops: null, held: { items: [], next: null }, authors: [] });
    expect(screen.getByText("Couldn't load dropped posts.")).toBeTruthy();
    expect(screen.getByText('No held posts.')).toBeTruthy();
    expect(screen.getByText('No silenced authors.')).toBeTruthy();
  });

  it('offers no Silence for a drop without an author key, and marks a silenced one', () => {
    setup({
      drops: {
        items: [
          drop({ rawItemId: 'a', author: { ...jane, key: null } }),
          drop({
            rawItemId: 'b',
            author: { ...jane, key: 'company:acme', name: 'Acme' },
          }),
        ],
        next: null,
      },
    });
    const drops = within(section('Dropped posts'));
    expect(drops.queryByRole('button', { name: /silence/i })).toBeNull();
    expect(drops.getByText('Silenced')).toBeTruthy();
  });

  it('Silence asks for a reason, then calls the action', async () => {
    setup();
    fireEvent.click(
      within(section('Dropped posts')).getByRole('button', { name: 'Silence' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Silence' }));
    expect(await within(dialog).findByText('Give a reason.')).toBeTruthy();
    expect(silenceAuthorAction).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: /reason/i }), {
      target: { value: 'Agency spam' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Silence' }));
    await waitFor(() =>
      expect(silenceAuthorAction).toHaveBeenCalledWith({
        authorKey: 'profile:jane',
        name: 'Jane Doe',
        reason: 'Agency spam',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('Silence toasts and stays open when the action fails', async () => {
    silenceAuthorAction.mockResolvedValue('failed');
    setup();
    fireEvent.click(
      within(section('Dropped posts')).getByRole('button', { name: 'Silence' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /reason/i }), {
      target: { value: 'Agency spam' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Silence' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Un-silence calls the other action', async () => {
    setup();
    fireEvent.click(
      within(section('Silenced authors')).getByRole('button', {
        name: 'Un-silence Acme',
      }),
    );
    await waitFor(() =>
      expect(unsilenceAuthorAction).toHaveBeenCalledWith('company:acme'),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('Un-silence toasts when the action fails', async () => {
    unsilenceAuthorAction.mockResolvedValue('failed');
    setup();
    fireEvent.click(
      within(section('Silenced authors')).getByRole('button', {
        name: 'Un-silence Acme',
      }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

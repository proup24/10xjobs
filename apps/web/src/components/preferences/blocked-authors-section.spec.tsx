import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockedAuthorsSection } from './blocked-authors-section';

const actions = vi.hoisted(() => ({
  blockAuthorAction: vi.fn(),
  unblockAuthorAction: vi.fn(),
}));
vi.mock('@/app/(app)/preferences/actions', () => actions);
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const AUTHORS = [
  {
    authorKey: 'profile:jane',
    name: 'Jane <b>Doe</b>',
    profileUrl: 'https://www.linkedin.com/in/jane/',
    createdAt: '2026-11-20T10:00:00Z',
  },
  {
    authorKey: 'company:acme',
    name: null,
    profileUrl: 'javascript:alert(1)',
    createdAt: '2026-11-21T10:00:00Z',
  },
];

beforeEach(() => {
  actions.blockAuthorAction.mockResolvedValue({ status: 'saved' });
  actions.unblockAuthorAction.mockResolvedValue({ status: 'saved' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BlockedAuthorsSection', () => {
  it('lists names as text, falls back to the key, links only safe urls', () => {
    render(<BlockedAuthorsSection authors={AUTHORS} />);
    expect(screen.getByText('Jane <b>Doe</b>')).toBeTruthy();
    expect(screen.getByText('company:acme')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      'https://www.linkedin.com/in/jane/',
    );
    expect(screen.getAllByRole('button', { name: /Unblock/ })).toHaveLength(2);
  });

  it('shows an empty state', () => {
    render(<BlockedAuthorsSection authors={[]} />);
    expect(screen.queryByRole('button', { name: /Unblock/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Block' })).toBeTruthy();
  });

  it('Unblock calls the action with the key and refreshes', async () => {
    render(<BlockedAuthorsSection authors={AUTHORS} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Unblock/ })[0]);
    await waitFor(() =>
      expect(actions.unblockAuthorAction).toHaveBeenCalledWith('profile:jane'),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('Block sends the pasted link and clears the field', async () => {
    render(<BlockedAuthorsSection authors={[]} />);
    const input = screen.getByLabelText('LinkedIn link') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'linkedin.com/in/jane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() =>
      expect(actions.blockAuthorAction).toHaveBeenCalledWith({
        link: 'linkedin.com/in/jane',
      }),
    );
    await waitFor(() => expect(input.value).toBe(''));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the invalid-link message', async () => {
    actions.blockAuthorAction.mockResolvedValue({
      status: 'invalid',
      errors: { _form: 'Paste a LinkedIn profile or company link.' },
    });
    render(<BlockedAuthorsSection authors={[]} />);
    fireEvent.change(screen.getByLabelText('LinkedIn link'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(
      await screen.findByText('Paste a LinkedIn profile or company link.'),
    ).toBeTruthy();
  });
});

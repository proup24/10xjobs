import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PausedNotice } from './paused-notice';

const resumeSearchesAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/searches-actions', () => ({ resumeSearchesAction }));

afterEach(() => {
  cleanup();
  resumeSearchesAction.mockReset();
});

const LAST = new Date('2026-11-20T10:00:00Z');

describe('PausedNotice', () => {
  it('renders title, date and button when paused', () => {
    render(<PausedNotice lastActiveAt={LAST} />);
    expect(screen.getByText('Searches only you need are paused')).toBeTruthy();
    expect(
      screen.getByText('No activity since Nov 20. Mark a job, or resume now.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Resume searches' }),
    ).toBeTruthy();
  });

  it('hides after a successful resume', async () => {
    resumeSearchesAction.mockResolvedValue({ ok: true });
    render(<PausedNotice lastActiveAt={LAST} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume searches' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Searches only you need are paused'),
      ).toBeNull(),
    );
    expect(resumeSearchesAction).toHaveBeenCalledTimes(1);
  });

  it('shows the failure copy when resume fails', async () => {
    resumeSearchesAction.mockResolvedValue({ ok: false });
    render(<PausedNotice lastActiveAt={LAST} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume searches' }));
    expect(
      await screen.findByText("Couldn't resume your searches. Try again."),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Resume searches' }),
    ).toBeTruthy();
  });

  it('shows the failure copy when the action throws', async () => {
    resumeSearchesAction.mockRejectedValue(new Error('down'));
    render(<PausedNotice lastActiveAt={LAST} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume searches' }));
    expect(
      await screen.findByText("Couldn't resume your searches. Try again."),
    ).toBeTruthy();
  });
});

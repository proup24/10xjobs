import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';

afterEach(cleanup);

function setup(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      trigger={<Button>Delete profile</Button>}
      title="Delete this profile?"
      description="This cannot be undone."
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
}

describe('ConfirmDialog', () => {
  it('confirming calls onConfirm once and closes the dialog', async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await screen.findByRole('alertdialog');
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel does not call onConfirm', async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the confirm button as busy while onConfirm is pending', async () => {
    setup(() => new Promise<void>(() => undefined));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Delete' })
          .getAttribute('aria-busy'),
      ).toBe('true'),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('stays open when onConfirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
    setup(onConfirm);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Delete' })
          .getAttribute('aria-busy'),
      ).not.toBe('true'),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

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

function setup(
  onConfirm: () => void | Promise<void>,
  onError: (error: unknown) => void = () => undefined,
) {
  render(
    <ConfirmDialog
      trigger={<Button>Delete profile</Button>}
      title="Delete this profile?"
      description="This cannot be undone."
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
      onError={onError}
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

  it('reports a rejection through onError and re-enables confirm', async () => {
    const error = new Error('nope');
    const onError = vi.fn();
    setup(vi.fn().mockRejectedValue(error), onError);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('reports a synchronous throw through onError', async () => {
    const error = new Error('sync');
    const onError = vi.fn();
    setup(() => {
      throw error;
    }, onError);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('falls back to console.error without onError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('boom');
    render(
      <ConfirmDialog
        trigger={<Button>Open</Button>}
        title="t"
        description="d"
        confirmLabel="Go"
        onConfirm={() => Promise.reject(error)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(error));
    spy.mockRestore();
  });

  it('ignores a second click while onConfirm is in flight', async () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => undefined));
    setup(onConfirm);
    await screen.findByRole('alertdialog');
    const confirm = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

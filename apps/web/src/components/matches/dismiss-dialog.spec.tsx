import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DismissDialog } from './dismiss-dialog';

afterEach(cleanup);

const setup = (onConfirm = vi.fn().mockResolvedValue(true)) => {
  const onOpenChange = vi.fn();
  render(
    <DismissDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />,
  );
  return { onConfirm, onOpenChange };
};

const confirm = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Not for me' }));

describe('DismissDialog', () => {
  it('confirms with no reason', async () => {
    const { onConfirm, onOpenChange } = setup();
    expect(screen.getByRole('combobox').textContent).toContain('No reason');
    confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({}));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('confirms with a reason and a note', async () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Salary' });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    fireEvent.change(screen.getByLabelText(/note/i), {
      target: { value: ' Too low ' },
    });
    confirm();
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        reason: 'salary',
        note: 'Too low',
      }),
    );
  });

  it('stays open when saving fails', async () => {
    const { onConfirm, onOpenChange } = setup(vi.fn().mockResolvedValue(false));
    confirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

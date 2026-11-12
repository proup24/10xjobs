import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportDialog } from './report-dialog';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  toast.success.mockReset();
  toast.error.mockReset();
});

const open = (onReport = vi.fn().mockResolvedValue({ status: 'saved' })) => {
  render(
    <ReportDialog
      jobId="J"
      field="seniority"
      label="Seniority"
      onReport={onReport}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /report a mismatch/i }));
  return onReport;
};

describe('ReportDialog', () => {
  it('the dialog submits field, proposed value and note', async () => {
    const onReport = open();
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: 'Mid-level' },
    });
    fireEvent.change(screen.getByLabelText(/note/i), {
      target: { value: 'See the post' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith({
        jobId: 'J',
        field: 'seniority',
        proposedValue: 'Mid-level',
        note: 'See the post',
      }),
    );
  });

  it('a report shows a "Thanks, reported" toast', async () => {
    open();
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: 'Mid-level' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Thanks, reported'),
    );
  });

  it('asks for a proposed value and sends nothing without one', async () => {
    const onReport = open();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Enter what it should say.')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says why when the save fails', async () => {
    open(vi.fn().mockResolvedValue({ status: 'failed' }));
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText(/what it should say/i)).toBeTruthy();
  });
});

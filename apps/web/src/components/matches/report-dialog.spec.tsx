import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportField } from '@/lib/matches/report';
import { ReportDialog, type Report } from './report-dialog';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  toast.success.mockReset();
  toast.error.mockReset();
});

// Base UI commits a mouse pick only when the press started on the item.
async function choose(option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
  const item = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
}

const open = ({
  field,
  label,
  onReport = vi.fn().mockResolvedValue({ status: 'saved' }),
}: {
  field?: ReportField;
  label?: string;
  onReport?: Report;
} = {}) => {
  render(
    <ReportDialog jobId="J" field={field} label={label} onReport={onReport} />,
  );
  fireEvent.click(screen.getByRole('button', { name: /report a mismatch/i }));
  return onReport as ReturnType<typeof vi.fn>;
};

const SENIORITY = { field: 'seniority', label: 'Seniority' } as const;

const fillValue = (value: string) =>
  fireEvent.change(screen.getByLabelText(/what it should say/i), {
    target: { value },
  });
const send = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

describe('ReportDialog', () => {
  it('the dialog submits field, proposed value and note', async () => {
    const onReport = open(SENIORITY);
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
    open(SENIORITY);
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: 'Mid-level' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Thanks, reported'),
    );
  });

  it('asks for a proposed value and sends nothing without one', async () => {
    const onReport = open(SENIORITY);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Enter what it should say.')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says why when the save fails', async () => {
    open({
      ...SENIORITY,
      onReport: vi.fn().mockResolvedValue({ status: 'failed' }),
    });
    fireEvent.change(screen.getByLabelText(/what it should say/i), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByLabelText(/what it should say/i)).toBeTruthy();
  });

  it('without a field, asks which field and sends nothing until one is chosen', async () => {
    const onReport = open();
    fillValue('Mid-level');
    send();
    expect(await screen.findByText('Choose a field.')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('combobox', { name: 'Field' })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('shows both errors when field and value are missing', async () => {
    const onReport = open();
    send();
    expect(await screen.findByText('Choose a field.')).toBeTruthy();
    expect(screen.getByText('Enter what it should say.')).toBeTruthy();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('sends the chosen field', async () => {
    const onReport = open();
    await choose('Tech stack');
    fillValue('Go');
    send();
    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith({
        jobId: 'J',
        field: 'techStack',
        proposedValue: 'Go',
      }),
    );
  });

  it('offers the eleven fields in order', () => {
    open();
    fireEvent.click(screen.getByRole('combobox', { name: 'Field' }));
    return screen.findAllByRole('option').then((options) => {
      expect(options.map((o) => o.textContent)).toEqual([
        'Role',
        'Seniority',
        'Arrangement',
        'Places',
        'Contract type',
        'Engagement',
        'Salary',
        'Years required',
        'Tech stack',
        'Required languages',
        'Work authorization',
      ]);
    });
  });

  it('starts on the given field and sends a changed one', async () => {
    const onReport = open(SENIORITY);
    expect(
      screen.getByRole('combobox', { name: 'Field' }).textContent,
    ).toContain('Seniority');
    await choose('Salary');
    fillValue('90k');
    send();
    await waitFor(() =>
      expect(onReport).toHaveBeenCalledWith(
        expect.objectContaining({ field: 'salary' }),
      ),
    );
  });

  it('resets after a send', async () => {
    open();
    await choose('Role');
    fillValue('Engineer');
    send();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /report a mismatch/i }));
    expect(
      screen.getByRole('combobox', { name: 'Field' }).textContent,
    ).toContain('Choose a field');
    expect(
      (screen.getByLabelText(/what it should say/i) as HTMLInputElement).value,
    ).toBe('');
    cleanup();

    open(SENIORITY);
    await choose('Salary');
    fillValue('90k');
    send();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /report a mismatch/i }));
    expect(
      screen.getByRole('combobox', { name: 'Field' }).textContent,
    ).toContain('Seniority');
  });

  it('names the trigger after the field only when one is given', () => {
    render(<ReportDialog jobId="J" onReport={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Report a mismatch' }),
    ).toBeTruthy();
    cleanup();
    render(<ReportDialog jobId="J" {...SENIORITY} onReport={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Report a mismatch on Seniority' }),
    ).toBeTruthy();
  });

  it('shows a server field error on the select', async () => {
    open({
      onReport: vi
        .fn()
        .mockResolvedValue({
          status: 'invalid',
          errors: { field: 'Bad field' },
        }),
    });
    await choose('Role');
    fillValue('x');
    send();
    expect(await screen.findByText('Bad field')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('the title is "Report a mismatch"', () => {
    open(SENIORITY);
    expect(
      screen.getByRole('heading', { name: 'Report a mismatch' }),
    ).toBeTruthy();
  });
});

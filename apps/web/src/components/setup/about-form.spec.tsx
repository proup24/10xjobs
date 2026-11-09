import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AboutAnswers } from '@/lib/setup/answers';
import { AboutForm } from './about-form';

const push = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const EMPTY: AboutAnswers = {
  name: '',
  phone: null,
  linkedin: null,
  links: [],
};

const onStatusChange = vi.fn();

const onDirtyChange = vi.fn();

function setup(
  initial: AboutAnswers = EMPTY,
  onSave = vi.fn().mockResolvedValue({ status: 'saved' }),
  withName = true,
) {
  const onSaved = vi.fn();
  const { container } = render(
    <AboutForm
      formId="f"
      onStatusChange={onStatusChange}
      onDirtyChange={onDirtyChange}
      withName={withName}
      email="ada@example.com"
      initial={initial}
      onSave={onSave}
      onSaved={onSaved}
    />,
  );
  return { onSave, onSaved, container };
}

const submit = () =>
  fireEvent.submit(document.querySelector('form#f') as HTMLFormElement);

describe('AboutForm', () => {
  it('continue with only a name saves', async () => {
    const { onSave, onSaved } = setup();
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: 'Ada Lovelace' },
    });
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      phone: null,
      linkedin: null,
      links: [],
    });
  });

  it('empty name shows "Enter your name"', async () => {
    const { onSave } = setup();
    submit();
    expect(await screen.findByText('Enter your name')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('invalid link shows its FieldError', async () => {
    const { onSave } = setup({ ...EMPTY, name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link address'), {
      target: { value: 'github.com/ada' },
    });
    submit();
    expect(
      await screen.findByText('Enter a link starting with http:// or https://'),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the email read-only', () => {
    setup();
    const email = screen.getByLabelText(/Email/) as HTMLInputElement;
    expect(email.value).toBe('ada@example.com');
    expect(email.readOnly).toBe(true);
  });

  it('removes a link row', () => {
    setup({
      ...EMPTY,
      name: 'Ada',
      links: [{ kind: 'github', value: 'https://github.com/ada' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(screen.queryByLabelText('Link address')).toBeNull();
  });

  it('a failed save toasts and stays; an invalid one shows the field error', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({
        status: 'invalid',
        errors: { name: 'Name is taken', _form: 'Fix the errors' },
      });
    const { onSaved } = setup({ ...EMPTY, name: 'Ada' }, onSave);
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    submit();
    expect(await screen.findByText('Name is taken')).toBeTruthy();
    // The status reaches the frame from an effect, after the field error renders.
    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({
        pending: false,
        formError: 'Fix the errors',
      }),
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('withName={false} renders no Name field and saves without a name', async () => {
    const { onSave, onSaved } = setup(EMPTY, undefined, false);
    expect(screen.queryByRole('textbox', { name: /Name/ })).toBeNull();
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe(
      'ada@example.com',
    );
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({
      phone: null,
      linkedin: null,
      links: [],
    });
  });

  it('reports unsaved edits and clears after a save', async () => {
    setup({ ...EMPTY, name: 'Ada' });
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    fireEvent.change(screen.getByLabelText(/Phone/), {
      target: { value: '+33 1 23' },
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    submit();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});

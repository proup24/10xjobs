import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TermsAnswers } from '@/lib/setup/answers';
import { TermsForm } from './terms-form';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const LISTS = {
  regions: [{ value: 'WEU', label: 'Western Europe' }],
  countries: [
    { value: 'FR', label: 'France' },
    { value: 'DE', label: 'Germany' },
  ],
  cities: [
    { value: '0b8f5c1e-1d2a-4c3b-9e4f-5a6b7c8d9e0f', label: 'Paris, France' },
  ],
  contractTypes: [
    { value: 'contract', label: 'Contract' },
    { value: 'full_time', label: 'Full Time' },
  ],
  engagements: [
    { value: 'contractor', label: 'Contractor' },
    { value: 'employee', label: 'Employee' },
  ],
  currencies: [
    { value: 'EUR', label: 'Euro' },
    { value: 'USD', label: 'US Dollar' },
  ],
};

const SAVED: TermsAnswers = {
  places: [
    {
      place: { kind: 'country', code: 'FR' },
      remote: true,
      hybrid: true,
      onsite: false,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 240,
  contractTypes: ['full_time'],
  engagements: ['employee'],
  noticePeriodDays: 30,
  salary: null,
  acceptsAnyCurrency: true,
  acceptedCurrencies: [],
};

function setup(
  initial: TermsAnswers | null = SAVED,
  onSave = vi.fn().mockResolvedValue({ status: 'saved' }),
  hasProfile = false,
) {
  const onSaved = vi.fn();
  const onStatusChange = vi.fn();
  const onDirtyChange = vi.fn();
  render(
    <TermsForm
      formId="f"
      initial={initial}
      lists={LISTS}
      onSave={onSave}
      onSaved={onSaved}
      onStatusChange={onStatusChange}
      onDirtyChange={onDirtyChange}
      hasProfile={hasProfile}
    />,
  );
  return { onSave, onSaved, onStatusChange, onDirtyChange };
}

/** The text of every element the control's aria-describedby points at. */
function describedBy(el: HTMLElement): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

/** True when the fieldset's legend carries the required marker. */
function legendRequired(name: string): boolean {
  const group = screen.getByRole('group', { name });
  return Boolean(
    group.querySelector(':scope > legend [data-slot="field-required"]'),
  );
}

function type(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: 'insertText' });
}

async function pick(name: string, text: string, label: RegExp | string) {
  type(screen.getByRole('combobox', { name }), text);
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

const submit = () =>
  fireEvent.submit(document.querySelector('form#f') as HTMLFormElement);

const checked = (name: string) =>
  screen.getByRole('checkbox', { name }).getAttribute('aria-checked');

describe('TermsForm', () => {
  it('a saved answer goes through unchanged', async () => {
    const { onSave, onSaved } = setup();
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(SAVED);
  });

  it('a place under worldwide remote shows the hint and still saves', async () => {
    const { onSave } = setup({
      ...SAVED,
      places: [{ ...SAVED.places[0], hybrid: false }],
    });
    await pick('Add a place', 'world', /^Worldwide/);
    expect(
      screen.getByText('Worldwide remote already covers remote here.'),
    ).toBeTruthy();
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].places).toEqual([
      {
        place: { kind: 'country', code: 'FR' },
        remote: true,
        hybrid: false,
        onsite: false,
      },
      {
        place: { kind: 'worldwide' },
        remote: true,
        hybrid: false,
        onsite: false,
      },
    ]);
  });

  it('a row with no arrangement is refused', async () => {
    const { onSave } = setup({ ...SAVED, places: [] });
    await pick('Add a place', 'germ', /^Germany/);
    submit();
    expect(
      await screen.findByText('Pick remote, hybrid or on-site'),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('time zone fields prefill from the browser offset', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60);
    setup(null);
    const text = (name: string) =>
      screen.getByRole('combobox', { name }).textContent;
    expect(text('Your UTC offset')).toContain('UTC+1');
    expect(text('From')).toContain('UTC−2');
    expect(text('To')).toContain('UTC+4');
  });

  it('a saved time zone is not replaced by the browser offset', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-600);
    setup();
    expect(
      screen.getByRole('combobox', { name: 'Your UTC offset' }).textContent,
    ).toContain('UTC+1');
  });

  it('contract types start empty and "Select all" ticks all', () => {
    setup(null);
    expect(screen.getByRole('group', { name: 'Contract types' })).toBeTruthy();
    expect(checked('Contract')).toBe('false');
    expect(checked('Full Time')).toBe('false');
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all contract types' }),
    );
    expect(checked('Contract')).toBe('true');
    expect(checked('Full Time')).toBe('true');
    expect(checked('Employee')).toBe('false');
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all engagements' }),
    );
    expect(checked('Employee')).toBe('true');
    expect(checked('Contractor')).toBe('true');
  });

  it('each engagement has a one-line hint', () => {
    setup(null);
    expect(screen.getByText('You invoice the company directly.')).toBeTruthy();
  });

  it('an empty form asks for each required answer', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
    const { onSave } = setup(null);
    submit();
    expect(await screen.findByText('Add at least one place')).toBeTruthy();
    expect(screen.getByText('Pick at least one contract type')).toBeTruthy();
    expect(screen.getByText('Pick at least one way to be hired')).toBeTruthy();
    expect(screen.getByText('Pick a notice period')).toBeTruthy();
    for (const [box, message] of [
      ['Full Time', 'Pick at least one contract type'],
      ['Employee', 'Pick at least one way to be hired'],
    ]) {
      const checkbox = screen.getByRole('checkbox', { name: box });
      expect(checkbox.getAttribute('aria-invalid')).toBe('true');
      expect(checkbox.getAttribute('aria-required')).toBe('true');
      expect(describedBy(checkbox)).toContain(message);
    }
    expect(
      describedBy(screen.getByRole('checkbox', { name: 'Employee' })),
    ).toContain('On the company');
    expect(legendRequired('Contract types')).toBe(true);
    expect(legendRequired('Hired as')).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('salary stays collapsed and is omitted until opened', async () => {
    const { onSave } = setup();
    expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull();
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].salary).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Add a minimum salary' }),
    );
    expect(screen.getByRole('spinbutton', { name: 'Amount' })).toBeTruthy();
    submit();
    expect(await screen.findByText('Enter an amount')).toBeTruthy();
    expect(screen.getByText('Pick a currency')).toBeTruthy();
    expect(screen.getByText('Pick a period')).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove minimum salary' }),
    );
    expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull();
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].salary).toBeNull();
  });

  it('a filled salary is saved as a whole amount', async () => {
    const { onSave } = setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add a minimum salary' }),
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), {
      target: { value: '90000' },
    });
    await pick('Salary currency', 'eur', 'Euro');
    fireEvent.click(screen.getByRole('combobox', { name: 'Per' }));
    const year = await screen.findByRole('option', { name: 'Year' });
    fireEvent.pointerDown(year, { pointerType: 'mouse' });
    fireEvent.click(year);
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].salary).toEqual({
      min: 90000,
      currency: 'EUR',
      period: 'year',
    });
  });

  it('turning off "Any currency" needs one currency', async () => {
    const { onSave } = setup();
    const any = screen.getByRole('switch', { name: 'Any currency' });
    expect(any.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(any);
    submit();
    expect(await screen.findByText('Pick at least one currency')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await pick('Accepted currencies', 'us', 'US Dollar');
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      acceptsAnyCurrency: false,
      acceptedCurrencies: ['USD'],
    });
  });

  it('a refused save of an existing profile reads "could not save" with the database message', async () => {
    const { onStatusChange } = setup(
      SAVED,
      vi.fn().mockResolvedValue({
        status: 'invalid',
        errors: { _form: 'city not approved' },
      }),
      true,
    );
    submit();
    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({
        pending: false,
        formError:
          "We couldn't save these answers. Check them and try again.\ncity not approved",
      }),
    );
  });

  it('a creation error becomes the form error with the database message', async () => {
    const { onSaved, onStatusChange } = setup(
      SAVED,
      vi.fn().mockResolvedValue({
        status: 'invalid',
        errors: { _form: 'city not approved' },
      }),
    );
    submit();
    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({
        pending: false,
        formError:
          "We couldn't create your profile from these answers. Check them and try again.\ncity not approved",
      }),
    );
    expect(onSaved).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'France arrangements' });
    expect(
      within(group)
        .getByRole('button', { name: 'Hybrid' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('a failure toasts', async () => {
    const { onSaved } = setup(
      SAVED,
      vi.fn().mockResolvedValue({ status: 'failed' }),
    );
    submit();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports unsaved edits and clears after a save', async () => {
    const { onDirtyChange } = setup();
    fireEvent.click(screen.getByRole('combobox', { name: 'Notice period' }));
    const option = await screen.findByRole('option', { name: '2 months' });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    fireEvent.submit(document.querySelector('form#f') as HTMLFormElement);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});

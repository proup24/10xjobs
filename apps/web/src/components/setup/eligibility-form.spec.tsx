import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EligibilityAnswers } from '@/lib/setup/answers';
import { EligibilityForm } from './eligibility-form';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LISTS = {
  countries: [
    { value: 'MA', label: 'Morocco' },
    { value: 'DE', label: 'Germany' },
  ],
  regions: [{ value: 'EU', label: 'Europe' }],
};

function setup(
  initial: EligibilityAnswers | null = null,
  onSave = vi.fn().mockResolvedValue({ status: 'saved' }),
) {
  const onSaved = vi.fn();
  const { container } = render(
    <EligibilityForm
      formId="f"
      initial={initial}
      lists={LISTS}
      onSave={onSave}
      onSaved={onSaved}
    />,
  );
  return { onSave, onSaved, container };
}

// Base UI opens the list only for typed input, so send what a keyboard sends.
async function pickResidence(text: string, label: string) {
  const input = screen.getAllByRole('combobox')[0];
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: 'insertText' });
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

const submit = () =>
  fireEvent.submit(document.querySelector('form#f') as HTMLFormElement);

const SUGGESTION = 'Add residency in Morocco?';

describe('EligibilityForm', () => {
  it('picking residence offers "Add residency in Morocco?" and clicking it adds the row', async () => {
    setup();
    expect(screen.queryByRole('button', { name: SUGGESTION })).toBeNull();
    await pickResidence('moroc', 'Morocco');
    fireEvent.click(await screen.findByRole('button', { name: SUGGESTION }));
    expect(
      screen.getByRole('button', { name: 'Remove authorization' }),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Place' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: SUGGESTION })).toBeNull();
  });

  it('nothing is added without the click', async () => {
    setup();
    await pickResidence('moroc', 'Morocco');
    await screen.findByRole('button', { name: SUGGESTION });
    expect(
      screen.queryByRole('button', { name: 'Remove authorization' }),
    ).toBeNull();
  });

  it('continue with no rows and no tick shows the error', async () => {
    const { onSave } = setup({
      residenceCountry: 'MA',
      acceptsSponsorship: true,
      authorizations: [],
      noneConfirmed: false,
    });
    submit();
    expect(
      await screen.findByText(
        'Add a work authorization, or tick that you hold none',
      ),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ticking the none box lets a saved answer through', async () => {
    const { onSave, onSaved } = setup({
      residenceCountry: 'MA',
      acceptsSponsorship: false,
      authorizations: [],
      noneConfirmed: false,
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: "I don't hold any work authorization",
      }),
    );
    submit();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({
      residenceCountry: 'MA',
      acceptsSponsorship: false,
      authorizations: [],
      noneConfirmed: true,
    });
  });

  it('sponsorship starts unselected and is required', async () => {
    const { onSave } = setup();
    const legend = screen.getByText(
      'Would you take a job that sponsors your visa?',
    );
    expect(
      legend.querySelector('[data-slot="field-required"]')?.textContent,
    ).toBe('*');
    const yes = screen.getByRole('radio', { name: 'Yes' });
    const no = screen.getByRole('radio', { name: 'No' });
    expect(yes.getAttribute('aria-checked')).toBe('false');
    expect(no.getAttribute('aria-checked')).toBe('false');
    await pickResidence('moroc', 'Morocco');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: "I don't hold any work authorization",
      }),
    );
    submit();
    expect(await screen.findByText('Choose yes or no')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(yes);
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].acceptsSponsorship).toBe(true);
  });

  it('a duplicate kind+place row is refused', async () => {
    const { onSave } = setup({
      residenceCountry: 'MA',
      acceptsSponsorship: true,
      authorizations: [
        { kind: 'citizenship', place: 'MA' },
        { kind: 'citizenship', place: 'MA' },
      ],
      noneConfirmed: false,
    });
    submit();
    expect(
      await screen.findByText('This authorization is already listed'),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a new row without a place asks for one', async () => {
    const { onSave } = setup({
      residenceCountry: 'MA',
      acceptsSponsorship: true,
      authorizations: [],
      noneConfirmed: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add authorization' }));
    submit();
    expect(await screen.findByText('Pick a place')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

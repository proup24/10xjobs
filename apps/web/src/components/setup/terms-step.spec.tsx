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
import { TermsStep } from './terms-step';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LISTS = {
  regions: [],
  countries: [{ value: 'FR', label: 'France' }],
  cities: [],
  contractTypes: [{ value: 'full_time', label: 'Full Time' }],
  engagements: [{ value: 'employee', label: 'Employee' }],
  currencies: [{ value: 'EUR', label: 'Euro' }],
};

const initial: TermsAnswers = {
  places: [
    {
      place: { kind: 'country', code: 'FR' },
      remote: true,
      hybrid: false,
      onsite: true,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 240,
  contractTypes: ['full_time'],
  engagements: ['employee'],
  noticePeriodDays: 14,
  salary: null,
  acceptsAnyCurrency: true,
  acceptedCurrencies: [],
};

describe('TermsStep', () => {
  it('shows the step title', () => {
    render(<TermsStep initial={initial} lists={LISTS} onSave={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Location and terms',
    );
  });

  it('Continue submits the form and moves to the resume step', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(<TermsStep initial={initial} lists={LISTS} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/setup/resume'));
    expect(onSave).toHaveBeenCalledWith(initial);
  });

  it('a creation error from the server shows above the footer and keeps the answers', async () => {
    const onSave = vi.fn().mockResolvedValue({
      status: 'invalid',
      errors: { _form: 'city 123 is not an approved city' },
    });
    render(<TermsStep initial={initial} lists={LISTS} onSave={onSave} />);
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(continueButton);
    const alert = await screen.findByText(/We couldn't create your profile/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe(
      "We couldn't create your profile from these answers. Check them and try again.\ncity 123 is not an approved city",
    );
    expect(
      alert.compareDocumentPosition(continueButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    const group = screen.getByRole('group', { name: 'France arrangements' });
    expect(
      within(group)
        .getByRole('button', { name: 'On-site' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('combobox', { name: 'Notice period' }).textContent,
    ).toContain('2 weeks');
  });
});

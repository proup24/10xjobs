import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsavedChangesProvider } from '@/components/layout/unsaved-changes';
import type { CreateResult } from '@/lib/preferences/new-profile';
import type { TermsAnswers } from '@/lib/setup/answers';
import {
  NewProfileResumeStep,
  NewProfileTermsStep,
  toSaveResult,
} from './new-profile-steps';

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
const publishProfileAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/publish-action', () => ({
  publishProfileAction,
}));
vi.mock('@/lib/resume/actions', () => ({ confirmResumeAction: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({}),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const P = '22222222-2222-4222-8222-222222222222';
const U = '11111111-1111-4111-8111-111111111111';

const LISTS = {
  regions: [],
  countries: [{ value: 'FR', label: 'France' }],
  cities: [],
  contractTypes: [{ value: 'full_time', label: 'Full Time' }],
  engagements: [{ value: 'employee', label: 'Employee' }],
  currencies: [{ value: 'EUR', label: 'Euro' }],
};

const TERMS: TermsAnswers = {
  places: [
    {
      place: { kind: 'country', code: 'FR' },
      remote: true,
      hybrid: false,
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

describe('toSaveResult', () => {
  it('maps created to saved and keeps the rest', () => {
    expect(toSaveResult({ status: 'created', profileId: P })).toEqual({
      status: 'saved',
    });
    expect(toSaveResult({ status: 'failed' })).toEqual({ status: 'failed' });
    const invalid = { status: 'invalid' as const, errors: { _form: 'x' } };
    expect(toSaveResult(invalid)).toBe(invalid);
  });
});

describe('NewProfileTermsStep', () => {
  function setup(onSave: (input: unknown) => Promise<CreateResult>) {
    render(
      <UnsavedChangesProvider>
        <NewProfileTermsStep initial={TERMS} lists={LISTS} onSave={onSave} />
      </UnsavedChangesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('once created, goes to the new profile’s resume step', async () => {
    const onSave = vi.fn().mockResolvedValue({
      status: 'created',
      profileId: P,
    });
    setup(onSave);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/preferences/new/${P}/resume`),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('saved without a profile (no job yet) goes back to the job step', async () => {
    setup(vi.fn().mockResolvedValue({ status: 'saved' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/preferences/new/job'),
    );
  });

  it('a failure toasts and stays', async () => {
    setup(vi.fn().mockResolvedValue({ status: 'failed' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});

describe('NewProfileResumeStep', () => {
  const finish = () =>
    screen.getByRole('button', { name: 'Finish' }) as HTMLButtonElement;

  it('blank: Finish is disabled until a resume exists', () => {
    render(<NewProfileResumeStep profileId={P} userId={U} current={null} />);
    expect(finish().disabled).toBe(true);
  });

  it('a copied resume shows with Replace, and Finish publishes and opens the matches view', async () => {
    publishProfileAction.mockResolvedValue({
      status: 'published',
      href: `/?profile=${P}`,
    });
    render(
      <NewProfileResumeStep
        profileId={P}
        userId={U}
        current={{ filename: 'cv.pdf', sizeBytes: 2048 }}
      />,
    );
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    await waitFor(() => expect(finish().disabled).toBe(false));
    fireEvent.click(finish());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/?profile=${P}`));
    expect(publishProfileAction).toHaveBeenCalledWith(P);
  });

  it('a failed publish shows the message and Finish works again', async () => {
    publishProfileAction.mockResolvedValueOnce({
      status: 'failed',
      message: 'Nope.',
    });
    render(
      <NewProfileResumeStep
        profileId={P}
        userId={U}
        current={{ filename: 'cv.pdf', sizeBytes: 2048 }}
      />,
    );
    await waitFor(() => expect(finish().disabled).toBe(false));
    fireEvent.click(finish());
    expect((await screen.findByRole('alert')).textContent).toBe('Nope.');
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(finish().disabled).toBe(false));
  });

  it('a rejected publish request shows the failure message and Finish works again', async () => {
    publishProfileAction.mockRejectedValue(new Error('network'));
    render(
      <NewProfileResumeStep
        profileId={P}
        userId={U}
        current={{ filename: 'cv.pdf', sizeBytes: 2048 }}
      />,
    );
    await waitFor(() => expect(finish().disabled).toBe(false));
    fireEvent.click(finish());
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't publish the profile. It's saved; try Finish again.",
    );
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(finish().disabled).toBe(false));
  });

  it('Back opens the new profile’s terms', () => {
    render(<NewProfileResumeStep profileId={P} userId={U} current={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledWith(`/preferences/profiles/${P}/terms`);
  });
});

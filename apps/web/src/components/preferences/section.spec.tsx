import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';
import { JobForm } from '@/components/setup/job-form';
import { TermsForm } from '@/components/setup/terms-form';
import type { JobAnswers, TermsAnswers } from '@/lib/setup/answers';
import { Section } from './section';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Asks to leave: navigates at once when the guard is clean, else opens the dialog. */
function LeaveProbe({ go }: { go: () => void }) {
  const { confirmLeave } = useUnsavedChanges();
  return (
    <button type="button" onClick={() => confirmLeave(go)}>
      leave
    </button>
  );
}

/** A stand-in form: buttons drive the callbacks Section hands to its child. */
function renderFake() {
  const go = vi.fn();
  const utils = render(
    <UnsavedChangesProvider>
      <Section title="Contacts" lead="How recruiters reach you." formId="f">
        {({ formId, onStatusChange, onDirtyChange, onSaved }) => (
          <form id={formId} onSubmit={(e) => e.preventDefault()}>
            <button type="button" onClick={() => onDirtyChange(true)}>
              edit
            </button>
            <button
              type="button"
              onClick={() =>
                onStatusChange({ pending: false, formError: 'Refused.' })
              }
            >
              refuse
            </button>
            <button
              type="button"
              onClick={() => onStatusChange({ pending: true })}
            >
              start
            </button>
            <button type="button" onClick={onSaved}>
              save
            </button>
          </form>
        )}
      </Section>
      <LeaveProbe go={go} />
    </UnsavedChangesProvider>,
  );
  return { go, ...utils };
}

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

describe('Section', () => {
  it('shows the title, lead and a Save changes button for the form', () => {
    renderFake();
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeTruthy();
    expect(screen.getByText('How recruiters reach you.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.getAttribute('type')).toBe('submit');
    expect(save.getAttribute('form')).toBe('f');
  });

  it('a saved result toasts "Saved" and refreshes the page data', () => {
    renderFake();
    click('save');
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the _form error as an alert', () => {
    renderFake();
    expect(screen.queryByRole('alert')).toBeNull();
    click('refuse');
    expect(screen.getByRole('alert').textContent).toBe('Refused.');
  });

  it('the button shows loading while the save runs', () => {
    renderFake();
    click('start');
    const save = screen.getByRole('button', { name: /Save changes/ });
    expect(save.getAttribute('aria-busy')).toBe('true');
  });

  it('a dirty child sets the guard dirty; saved sets it clean', () => {
    const { go } = renderFake();
    click('leave');
    expect(go).toHaveBeenCalledTimes(1);
    click('edit');
    click('leave');
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    expect(go).toHaveBeenCalledTimes(1);
    click('Keep editing');
    click('save');
    click('leave');
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('clears the guard when it unmounts', () => {
    const go = vi.fn();
    function Host() {
      const [shown, setShown] = useState(true);
      return (
        <UnsavedChangesProvider>
          {shown && (
            <Section title="Contacts" formId="f">
              {({ onDirtyChange }) => (
                <button type="button" onClick={() => onDirtyChange(true)}>
                  edit
                </button>
              )}
            </Section>
          )}
          <button type="button" onClick={() => setShown(false)}>
            hide
          </button>
          <LeaveProbe go={go} />
        </UnsavedChangesProvider>
      );
    }
    render(<Host />);
    click('edit');
    click('hide');
    click('leave');
    expect(go).toHaveBeenCalledTimes(1);
  });
});

const JOB_LISTS = {
  positions: [
    { value: 'backend_engineer', label: 'Backend engineer' },
    { value: 'frontend_engineer', label: 'Frontend engineer' },
  ],
  seniorities: [
    { value: 'mid', label: 'Mid-level' },
    { value: 'senior', label: 'Senior' },
  ],
  techs: [
    { value: 'postgresql', label: 'PostgreSQL', searchable: true },
    { value: 'react', label: 'React', searchable: true },
    { value: 'typescript', label: 'TypeScript', searchable: true },
    { value: 'saas', label: 'SaaS', searchable: false },
  ],
  languages: [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'French' },
  ],
};

const JOB: JobAnswers = {
  position: 'backend_engineer',
  yearsOfExperience: 6,
  seniorities: ['mid', 'senior'],
  techs: [
    { code: 'postgresql', rating: 4 },
    { code: 'typescript', rating: 5 },
    { code: 'react', rating: 2 },
    { code: 'saas', rating: 3 },
  ],
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'fr', level: 'native' },
  ],
};

const CITY = '0b8f5c1e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const TERMS_LISTS = {
  regions: [{ value: 'WEU', label: 'Western Europe' }],
  countries: [
    { value: 'FR', label: 'France' },
    { value: 'DE', label: 'Germany' },
  ],
  cities: [{ value: CITY, label: 'Paris, France' }],
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

const TERMS: TermsAnswers = {
  places: [
    {
      place: { kind: 'region', code: 'WEU' },
      remote: true,
      hybrid: false,
      onsite: false,
    },
    {
      place: { kind: 'city', id: CITY },
      remote: false,
      hybrid: true,
      onsite: true,
    },
  ],
  // Not the test machine's offset, so a prefill would show as a change.
  timezoneCurrent: 330,
  timezoneMin: -120,
  timezoneMax: 540,
  contractTypes: ['contract', 'full_time'],
  engagements: ['contractor', 'employee'],
  noticePeriodDays: 30,
  salary: { min: 85000, currency: 'EUR', period: 'year' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR', 'USD'],
};

describe('Section with the real profile forms', () => {
  it('mounting JobForm and TermsForm with saved answers leaves the guard clean', async () => {
    const go = vi.fn();
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(
      <UnsavedChangesProvider>
        <Section title="The job you want" formId="job">
          {(props) => (
            <JobForm
              {...props}
              initial={JOB}
              lists={JOB_LISTS}
              onSave={onSave}
            />
          )}
        </Section>
        <Section title="Location and terms" formId="terms">
          {(props) => (
            <TermsForm
              {...props}
              initial={TERMS}
              lists={TERMS_LISTS}
              hasProfile
              onSave={onSave}
            />
          )}
        </Section>
        <LeaveProbe go={go} />
      </UnsavedChangesProvider>,
    );
    // Let every mount effect (status, dirty, time zone prefill) settle.
    await act(() => Promise.resolve());
    click('leave');
    expect(screen.queryByText('Discard changes?')).toBeNull();
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('an edit in the real JobForm makes the guard ask, and saving clears it', async () => {
    const go = vi.fn();
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(
      <UnsavedChangesProvider>
        <Section title="The job you want" formId="job">
          {(props) => (
            <JobForm
              {...props}
              initial={JOB}
              lists={JOB_LISTS}
              onSave={onSave}
            />
          )}
        </Section>
        <LeaveProbe go={go} />
      </UnsavedChangesProvider>,
    );
    fireEvent.change(
      screen.getByRole('spinbutton', { name: /Years of experience/ }),
      { target: { value: '7' } },
    );
    click('leave');
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    click('Keep editing');
    click('Save changes');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved'));
    expect(onSave).toHaveBeenCalled();
    click('leave');
    expect(go).toHaveBeenCalledTimes(1);
  });
});

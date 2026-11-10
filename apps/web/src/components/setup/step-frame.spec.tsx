import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEW_PROFILE_STEPS } from '@/lib/preferences/new-profile-steps';
import { StepFrame, notifySaveFailed } from './step-frame';

const push = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StepFrame', () => {
  it('hides Back on the first step and marks it current', () => {
    render(
      <StepFrame step="about" title="About you" pending={false} formId="f" />,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    const current = screen
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('About you');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'About you',
    );
  });

  it('goes back to the previous step by default', () => {
    render(<StepFrame step="job" title="Job" pending={false} formId="f" />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledWith('/setup/eligibility');
  });

  it('targets the form from the submit button and shows loading', () => {
    render(
      <StepFrame
        step="job"
        title="Job"
        pending
        formId="job-form"
        submitLabel="Save"
      />,
    );
    const submit = screen.getByRole('button', { name: /Save/ });
    expect(submit.getAttribute('form')).toBe('job-form');
    expect(submit.getAttribute('type')).toBe('submit');
    expect(submit.getAttribute('aria-busy')).toBe('true');
  });

  it('shows a form error as an alert', () => {
    render(
      <StepFrame
        step="terms"
        title="T"
        pending={false}
        formId="f"
        formError="Bad city"
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Bad city');
  });

  it('submitDisabled disables the submit button', () => {
    render(
      <StepFrame
        step="resume"
        title="Resume"
        pending={false}
        formId="f"
        submitDisabled
      />,
    );
    const submit = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('submitHref renders the primary action as a link and keeps Back', () => {
    render(
      <StepFrame
        step="review"
        title="Review"
        pending={false}
        submitLabel="Finish"
        submitHref="/"
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Finish' }).getAttribute('href'),
    ).toBe('/');
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledWith('/setup/resume');
  });

  it('a custom flow drives progress and Back', () => {
    const flow = {
      steps: NEW_PROFILE_STEPS,
      pathFor: (id: string) => `/preferences/new/${id}`,
    };
    render(
      <StepFrame
        flow={flow}
        step="terms"
        title="Terms"
        pending={false}
        formId="f"
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const current = screen
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current[0].textContent).toContain('Location and terms');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(push).toHaveBeenCalledWith('/preferences/new/job');
  });

  it('notifySaveFailed toasts the failure copy', () => {
    notifySaveFailed();
    expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.");
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EligibilityStep } from './eligibility-step';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lists = { countries: [{ value: 'MA', label: 'Morocco' }], regions: [] };
const initial = {
  residenceCountry: 'MA',
  acceptsSponsorship: true,
  authorizations: [],
  noneConfirmed: true,
};

describe('EligibilityStep', () => {
  it('Continue submits the form and moves to the next step', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(<EligibilityStep initial={initial} lists={lists} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/setup/job'));
  });

  it('shows a _form error as the alert', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ status: 'invalid', errors: { _form: 'Fix this' } });
    render(<EligibilityStep initial={initial} lists={lists} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByText('Fix this');
    expect(alert.getAttribute('role')).toBe('alert');
  });
});

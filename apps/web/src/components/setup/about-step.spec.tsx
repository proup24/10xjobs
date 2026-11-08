import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutStep } from './about-step';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const initial = { name: 'Ada', phone: null, linkedin: null, links: [] };

describe('AboutStep', () => {
  it('Continue submits the form and moves to the next step', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(<AboutStep email="a@b.c" initial={initial} onSave={onSave} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'About you',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/setup/eligibility'),
    );
    expect(onSave).toHaveBeenCalled();
  });

  it('shows a _form error as the alert', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ status: 'invalid', errors: { _form: 'Fix this' } });
    render(<AboutStep email="a@b.c" initial={initial} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByText('Fix this');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(push).not.toHaveBeenCalled();
  });
});

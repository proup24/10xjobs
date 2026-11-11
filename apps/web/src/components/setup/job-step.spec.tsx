import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStep } from './job-step';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LISTS = {
  positions: [{ value: 'backend_engineer', label: 'Backend engineer' }],
  seniorities: [{ value: 'senior', label: 'Senior' }],
  techs: [{ value: 'postgresql', label: 'PostgreSQL', searchable: true }],
  languages: [{ value: 'en', label: 'English' }],
};

const initial = {
  position: 'backend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior'],
  techs: [{ code: 'postgresql', rating: 4 as const }],
  languages: [{ lang: 'en', level: 'native' as const }],
};

describe('JobStep', () => {
  it('shows the title and the exact lead', () => {
    render(<JobStep initial={null} lists={LISTS} onSave={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'The job you want',
    );
    expect(
      screen.getByText('We only show you jobs that match every answer here.'),
    ).toBeTruthy();
  });

  it('Continue submits the form and moves to the terms step', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'saved' });
    render(<JobStep initial={initial} lists={LISTS} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/setup/terms'));
    expect(onSave).toHaveBeenCalled();
  });
});

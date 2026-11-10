import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResumeStep } from './resume-step';

const push = vi.hoisted(() => vi.fn());
const uploadResume = vi.hoisted(() => vi.fn());
const confirmResumeAction = vi.hoisted(() => vi.fn());
const browserClient = vi.hoisted(() => ({ browser: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/resume/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/browser')>()),
  uploadResume,
}));
vi.mock('@/lib/resume/actions', () => ({ confirmResumeAction }));
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => browserClient,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const P = '22222222-2222-4222-8222-222222222222';
const U = '11111111-1111-4111-8111-111111111111';

const file = (name: string, type: string) =>
  new File([new Uint8Array(1)], name, { type });

function setup(current: { filename: string; sizeBytes: number } | null = null) {
  const onSaved = vi.fn();
  const utils = render(
    <ResumeStep profileId={P} userId={U} current={current} onSaved={onSaved} />,
  );
  const pick = (files: File[]) =>
    fireEvent.change(
      utils.container.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files } },
    );
  const submit = () =>
    screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  return { ...utils, onSaved, pick, submit };
}

describe('ResumeStep', () => {
  it('shows the step title', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Resume',
    );
  });

  it('Continue is disabled until a resume exists', async () => {
    uploadResume.mockResolvedValue({
      status: 'saved',
      resume: { filename: 'cv.pdf', sizeBytes: 10, uploadedAt: 't' },
    });
    const { pick, submit, onSaved } = setup();
    expect(submit().disabled).toBe(true);
    pick([file('cv.pdf', 'application/pdf')]);
    await waitFor(() => expect(submit().disabled).toBe(false));
    fireEvent.click(submit());
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('Continue goes on to the review by default', () => {
    render(
      <ResumeStep
        profileId={P}
        userId={U}
        current={{ filename: 'cv.pdf', sizeBytes: 10 }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(push).toHaveBeenCalledWith('/setup/review');
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_RESUME_BYTES } from '@/lib/resume/key';
import { ResumeStep } from './resume-step';

const push = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const uploadResume = vi.hoisted(() => vi.fn());
const confirmResumeAction = vi.hoisted(() => vi.fn());
const browserClient = vi.hoisted(() => ({ browser: true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
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

const file = (name: string, type: string, size = 1) =>
  new File([new Uint8Array(size)], name, { type });

function setup(current: { filename: string; sizeBytes: number } | null = null) {
  const onSaved = vi.fn();
  const utils = render(
    <ResumeStep profileId={P} userId={U} current={current} onSaved={onSaved} />,
  );
  const zone = () =>
    screen.getByRole('button', { name: /choose a file|\.pdf/i });
  const pick = (files: File[]) =>
    fireEvent.change(
      utils.container.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files } },
    );
  const submit = () =>
    screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  return { ...utils, onSaved, zone, pick, submit };
}

describe('ResumeStep', () => {
  it('shows the step title', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Resume',
    );
  });

  it('reject reasons map to messages', () => {
    const { zone } = setup();
    fireEvent.drop(zone(), {
      dataTransfer: { files: [file('a.txt', 'text/plain')] },
    });
    expect(screen.getByRole('alert').textContent).toBe('Upload a PDF');

    const big = file('cv.pdf', 'application/pdf');
    Object.defineProperty(big, 'size', { value: MAX_RESUME_BYTES + 1 });
    fireEvent.drop(zone(), { dataTransfer: { files: [big] } });
    expect(screen.getByRole('alert').textContent).toBe('PDFs up to 5 MB');

    fireEvent.drop(zone(), {
      dataTransfer: {
        files: [
          file('a.pdf', 'application/pdf'),
          file('b.pdf', 'application/pdf'),
        ],
      },
    });
    expect(screen.getByRole('alert').textContent).toBe('Upload one file');
    expect(uploadResume).not.toHaveBeenCalled();
  });

  it('confirm result invalid not-pdf shows "This file isn\'t a PDF"', async () => {
    uploadResume.mockResolvedValue({ status: 'invalid', reason: 'not-pdf' });
    const { pick } = setup();
    pick([file('cv.pdf', 'application/pdf')]);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "This file isn't a PDF",
      ),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('uploads to the profile with the confirm action', async () => {
    uploadResume.mockResolvedValue({
      status: 'saved',
      resume: { filename: 'cv.pdf', sizeBytes: 10, uploadedAt: 't' },
    });
    const { pick } = setup();
    const f = file('cv.pdf', 'application/pdf');
    pick([f]);
    await waitFor(() =>
      expect(uploadResume).toHaveBeenCalledWith(
        browserClient,
        U,
        P,
        f,
        confirmResumeAction,
      ),
    );
  });

  it('after upload the name and size show with Replace', async () => {
    uploadResume.mockResolvedValue({
      status: 'saved',
      resume: { filename: 'cv.pdf', sizeBytes: 123_456, uploadedAt: 't' },
    });
    const { pick } = setup();
    pick([file('cv.pdf', 'application/pdf')]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy(),
    );
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    expect(screen.getByText('121 KB')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByRole('button', { name: /choose a file/i })).toBeTruthy();
  });

  it('shows the current resume with Replace', () => {
    setup({ filename: 'old.pdf', sizeBytes: 2_097_152 });
    expect(screen.getByText('old.pdf')).toBeTruthy();
    expect(screen.getByText('2.0 MB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
  });

  it('an empty-type cv.pdf uploads and is saved', async () => {
    const real = await vi.importActual<typeof import('@/lib/resume/browser')>(
      '@/lib/resume/browser',
    );
    const upload = vi.fn(async () => ({ data: null, error: null }));
    const client = { storage: { from: () => ({ upload }) } };
    confirmResumeAction.mockResolvedValue({
      status: 'saved',
      resume: { filename: 'cv.pdf', sizeBytes: 8, uploadedAt: 't' },
    });
    uploadResume.mockImplementation(
      (_c: unknown, u: string, p: string, f: File, confirm: never) =>
        real.uploadResume(client as never, u, p, f, confirm),
    );
    const { pick } = setup();
    pick([file('cv.pdf', '')]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy(),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('a failed upload toasts and keeps Continue disabled', async () => {
    uploadResume.mockResolvedValue({ status: 'failed' });
    const { pick, submit } = setup();
    pick([file('cv.pdf', 'application/pdf')]);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
    expect(submit().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a thrown upload toasts the failure', async () => {
    uploadResume.mockRejectedValue(new Error('network'));
    const { pick } = setup();
    pick([file('cv.pdf', 'application/pdf')]);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
  });
});

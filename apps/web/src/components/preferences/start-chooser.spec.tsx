import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartChooser } from './start-chooser';

const startNewProfileAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/new/actions', () => ({
  startNewProfileAction,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PROFILES = [
  { id: A, label: 'Backend engineer' },
  { id: B, label: 'Frontend engineer' },
];

/** Stands in for Next's redirect boundary. */
class Boundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  override state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error ? <p>redirected</p> : this.props.children;
  }
}

const continueButton = () =>
  screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;

async function pickProfile(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Profile to copy' }));
  const option = await screen.findByRole('option', { name });
  fireEvent.pointerDown(option, { pointerType: 'mouse' });
  fireEvent.click(option);
}

describe('StartChooser', () => {
  it('has nothing preselected and Continue disabled', () => {
    render(<StartChooser profiles={PROFILES} />);
    expect(screen.getByRole('radiogroup', { name: 'Start from' })).toBeTruthy();
    for (const name of ['Blank', 'Copy from an existing profile']) {
      expect(
        screen.getByRole('radio', { name }).getAttribute('aria-checked'),
      ).toBe('false');
    }
    expect(continueButton().disabled).toBe(true);
    expect(
      screen.queryByRole('combobox', { name: 'Profile to copy' }),
    ).toBeNull();
  });

  it('blank enables Continue and starts a blank profile', async () => {
    render(<StartChooser profiles={PROFILES} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Blank' }));
    expect(continueButton().disabled).toBe(false);
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect(startNewProfileAction).toHaveBeenCalledWith({ kind: 'blank' }),
    );
  });

  it('copy needs a profile picked, then starts a copy of it', async () => {
    render(<StartChooser profiles={PROFILES} />);
    fireEvent.click(
      screen.getByRole('radio', { name: 'Copy from an existing profile' }),
    );
    expect(continueButton().disabled).toBe(true);
    await pickProfile('Frontend engineer');
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect(startNewProfileAction).toHaveBeenCalledWith({
        kind: 'copy',
        profileId: B,
      }),
    );
  });

  it('switching back to blank drops the picked profile', async () => {
    render(<StartChooser profiles={PROFILES} />);
    fireEvent.click(
      screen.getByRole('radio', { name: 'Copy from an existing profile' }),
    );
    await pickProfile('Backend engineer');
    fireEvent.click(screen.getByRole('radio', { name: 'Blank' }));
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect(startNewProfileAction).toHaveBeenCalledWith({ kind: 'blank' }),
    );
  });

  it('at the limit shows the hint and stays', async () => {
    startNewProfileAction.mockResolvedValue('limit');
    render(<StartChooser profiles={PROFILES} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Blank' }));
    fireEvent.click(continueButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'You can have up to 5 profiles',
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('the redirect to the job step is left to Next, not toasted', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;push;/preferences/new/job;303;',
    });
    startNewProfileAction.mockRejectedValue(redirect);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Boundary>
        <StartChooser profiles={PROFILES} />
      </Boundary>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Blank' }));
    fireEvent.click(continueButton());
    expect(await screen.findByText('redirected')).toBeTruthy();
    spy.mockRestore();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a failure toasts', async () => {
    startNewProfileAction.mockResolvedValue('failed');
    render(<StartChooser profiles={PROFILES} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Blank' }));
    fireEvent.click(continueButton());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

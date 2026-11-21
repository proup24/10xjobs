import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteProfileButton } from './delete-profile-button';

const deleteProfileAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/actions', () => ({ deleteProfileAction }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-1111-4111-8111-111111111111';

class Boundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  override state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error ? <p>redirected</p> : this.props.children;
  }
}

const trigger = () =>
  screen.getByRole('button', { name: 'Delete profile' }) as HTMLButtonElement;

async function confirm() {
  fireEvent.click(trigger());
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(
    Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete profile',
    ) as HTMLButtonElement,
  );
}

describe('DeleteProfileButton', () => {
  it('is disabled with the hint when it is the last profile', () => {
    render(
      <DeleteProfileButton
        profileId={ID}
        label="Backend"
        blockedReason="last"
      />,
    );
    expect(trigger().disabled).toBe(true);
    const hint = screen.getByText('You need at least one profile');
    expect(trigger().getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('is disabled with its own hint when it holds the only resume', () => {
    render(
      <DeleteProfileButton
        profileId={ID}
        label="Backend"
        blockedReason="only-resume"
      />,
    );
    expect(trigger().disabled).toBe(true);
    const hint = screen.getByText('Add a resume to another profile first');
    expect(trigger().getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('a stale refusal for the only resume toasts that hint', async () => {
    deleteProfileAction.mockResolvedValue('only-resume');
    render(
      <DeleteProfileButton
        profileId={ID}
        label="Backend"
        blockedReason={null}
      />,
    );
    await confirm();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Add a resume to another profile first',
      ),
    );
  });

  it('asks first, then deletes', async () => {
    deleteProfileAction.mockResolvedValue('failed');
    render(
      <DeleteProfileButton
        profileId={ID}
        label="Backend"
        blockedReason={null}
      />,
    );
    expect(screen.queryByText('You need at least one profile')).toBeNull();
    fireEvent.click(trigger());
    expect(await screen.findByText('Delete Backend?')).toBeTruthy();
    expect(
      screen.getByText(
        "This removes the profile and its resume. It can't be undone.",
      ),
    ).toBeTruthy();
    expect(deleteProfileAction).not.toHaveBeenCalled();
    await confirm();
    await waitFor(() => expect(deleteProfileAction).toHaveBeenCalledWith(ID));
  });

  it('a failure toasts', async () => {
    deleteProfileAction.mockResolvedValue('failed');
    render(
      <DeleteProfileButton
        profileId={ID}
        label="Backend"
        blockedReason={null}
      />,
    );
    await confirm();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
  });

  it('the redirect after a delete is left to Next, not toasted', async () => {
    deleteProfileAction.mockRejectedValue(
      Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;push;/preferences/contacts;303;',
      }),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Boundary>
        <DeleteProfileButton
          profileId={ID}
          label="Backend"
          blockedReason={null}
        />
      </Boundary>,
    );
    await confirm();
    expect(await screen.findByText('redirected')).toBeTruthy();
    spy.mockRestore();
    expect(toastError).not.toHaveBeenCalled();
  });
});

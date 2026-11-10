import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '@/components/layout/unsaved-changes';
import { NewProfileAction } from './new-profile-action';

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
const discardNewProfileAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/new/actions', () => ({
  discardNewProfileAction,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function MakeDirty() {
  const { setDirty } = useUnsavedChanges();
  return (
    <button type="button" onClick={() => setDirty(true)}>
      make dirty
    </button>
  );
}

function renderAction(props: { count: number; draftInProgress: boolean }) {
  return render(
    <UnsavedChangesProvider>
      <NewProfileAction {...props} />
      <MakeDirty />
    </UnsavedChangesProvider>,
  );
}

describe('NewProfileAction', () => {
  it('under the limit with no draft links to the chooser', () => {
    renderAction({ count: 2, draftInProgress: false });
    const link = screen.getByRole('link', { name: 'New profile' });
    expect(link.getAttribute('href')).toBe('/preferences/new');
    fireEvent.click(link);
    expect(push).toHaveBeenCalledWith('/preferences/new');
  });

  it('asks before leaving unsaved edits', () => {
    renderAction({ count: 2, draftInProgress: false });
    fireEvent.click(screen.getByRole('button', { name: 'make dirty' }));
    fireEvent.click(screen.getByRole('link', { name: 'New profile' }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(push).toHaveBeenCalledWith('/preferences/new');
  });

  it('at 5 profiles is disabled with the hint', () => {
    renderAction({ count: 5, draftInProgress: true });
    const button = screen.getByRole('button', {
      name: 'New profile',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const hint = screen.getByText('You can have up to 5 profiles');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    expect(screen.queryByRole('link', { name: 'New profile' })).toBeNull();
  });

  it('mounted twice has no duplicate ids', () => {
    render(
      <UnsavedChangesProvider>
        <NewProfileAction count={5} draftInProgress={false} />
        <NewProfileAction count={5} draftInProgress={false} />
      </UnsavedChangesProvider>,
    );
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('with a draft, Continue it goes back to the flow', async () => {
    renderAction({ count: 2, draftInProgress: true });
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    expect(
      await screen.findByText('You have a new profile in progress'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue it' }));
    expect(push).toHaveBeenCalledWith('/preferences/new/job');
    expect(discardNewProfileAction).not.toHaveBeenCalled();
  });

  it('with a draft, Start over discards it and opens the chooser', async () => {
    discardNewProfileAction.mockResolvedValue('discarded');
    renderAction({ count: 2, draftInProgress: true });
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/preferences/new'));
    expect(discardNewProfileAction).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });

  it('a failed Start over toasts and stays', async () => {
    discardNewProfileAction.mockResolvedValue('failed');
    renderAction({ count: 2, draftInProgress: true });
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start over' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again."),
    );
    expect(push).not.toHaveBeenCalled();
  });
});

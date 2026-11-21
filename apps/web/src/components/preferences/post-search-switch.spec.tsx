import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostSearchSwitch } from './post-search-switch';

const setPostSearchAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/actions', () => ({ setPostSearchAction }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-1111-4111-8111-111111111111';
const view = (over = {}) => ({
  enabled: false,
  allowed: true,
  searches: 2,
  ...over,
});

describe('PostSearchSwitch', () => {
  it('shows the label and description', () => {
    render(<PostSearchSwitch profileId={ID} initial={view()} />);
    expect(screen.getByText('Search LinkedIn posts')).toBeTruthy();
    expect(
      screen.getByText(
        'Looks every hour for hiring posts that match this profile. English posts are searched for remote work only.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No post searches for this profile/)).toBeNull();
  });

  it('shows the no-searches line when searches is 0', () => {
    render(
      <PostSearchSwitch profileId={ID} initial={view({ searches: 0 })} />,
    );
    expect(
      screen.getByText(
        'No post searches for this profile: English posts are searched for remote work only, and it has no remote places.',
      ),
    ).toBeTruthy();
  });

  it('reverts when the action fails', async () => {
    setPostSearchAction.mockResolvedValue('failed');
    render(<PostSearchSwitch profileId={ID} initial={view()} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(setPostSearchAction).toHaveBeenCalledWith(ID, true);
    await waitFor(() =>
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
  });
});

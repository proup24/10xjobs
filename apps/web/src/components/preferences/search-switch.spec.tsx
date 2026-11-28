import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchSwitch } from './search-switch';

const setSearchSwitchAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/preferences/actions', () => ({ setSearchSwitchAction }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-1111-4111-8111-111111111111';
const view = (over = {}) => ({
  key: 'posts' as const,
  enabled: false,
  searches: 2,
  pausedUntil: null as string | null,
  ...over,
});

describe('SearchSwitch', () => {
  it('shows the posts label and description', () => {
    render(<SearchSwitch profileId={ID} view={view()} />);
    expect(screen.getByText('Search LinkedIn posts')).toBeTruthy();
    expect(
      screen.getByText(
        'Looks every hour for hiring posts that match this profile. English posts are searched for remote work only.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No post searches for this profile/)).toBeNull();
  });

  it('shows the no-searches line when posts has 0 searches', () => {
    render(<SearchSwitch profileId={ID} view={view({ searches: 0 })} />);
    expect(
      screen.getByText(
        'No post searches for this profile: English posts are searched for remote work only, and it has no remote places.',
      ),
    ).toBeTruthy();
  });

  it('shows the Indeed label and description', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({ key: 'indeed', searches: 0 })}
      />,
    );
    expect(screen.getByText('Search Indeed')).toBeTruthy();
    expect(
      screen.getByText(
        "Searches Indeed for this profile's technologies in the countries it names, and for remote jobs in the US, Brazil, Poland, the UK and Canada.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No post searches for this profile/)).toBeNull();
  });

  it('says when post searches are paused for the day', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({ enabled: true, pausedUntil: '2026-11-28T00:00:00.000Z' })}
      />,
    );
    expect(
      screen.getByText(
        /Post searches are paused until .+ because today's search budget is used up\. They catch up on what they missed when they restart\./,
      ),
    ).toBeTruthy();
  });

  it('shows no pause line when posts is not paused', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({ enabled: true, pausedUntil: null })}
      />,
    );
    expect(screen.queryByText(/paused until/)).toBeNull();
  });

  it('shows no pause line for Indeed even with a pausedUntil', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({
          key: 'indeed',
          enabled: true,
          pausedUntil: '2026-11-28T00:00:00.000Z',
        })}
      />,
    );
    expect(screen.queryByText(/paused until/)).toBeNull();
  });

  it('hides the pause line once posts is turned off', async () => {
    setSearchSwitchAction.mockResolvedValue({
      status: 'saved',
      pausedUntil: null,
    });
    render(
      <SearchSwitch
        profileId={ID}
        view={view({ enabled: true, pausedUntil: '2026-11-28T00:00:00.000Z' })}
      />,
    );
    expect(screen.getByText(/paused until/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByText(/paused until/)).toBeNull();
    await waitFor(() =>
      expect(setSearchSwitchAction).toHaveBeenCalledWith(ID, 'posts', false),
    );
    expect(screen.queryByText(/paused until/)).toBeNull();
  });

  it('shows the pause line when posts is turned on while paused', async () => {
    setSearchSwitchAction.mockResolvedValue({
      status: 'saved',
      pausedUntil: '2026-11-28T00:00:00.000Z',
    });
    render(<SearchSwitch profileId={ID} view={view()} />);
    expect(screen.queryByText(/paused until/)).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    // The line shows at once with 'tomorrow', then with the formatted time.
    await waitFor(() => {
      expect(screen.getByText(/Post searches are paused until/)).toBeTruthy();
      expect(screen.queryByText(/paused until tomorrow/)).toBeNull();
    });
  });

  it('shows no pause line when posts has no searches', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({
          enabled: true,
          searches: 0,
          pausedUntil: '2026-11-28T00:00:00.000Z',
        })}
      />,
    );
    expect(screen.getByText(/No post searches for this profile/)).toBeTruthy();
    expect(screen.queryByText(/paused until/)).toBeNull();
  });

  it('falls back to tomorrow when pausedUntil cannot be read', () => {
    render(
      <SearchSwitch
        profileId={ID}
        view={view({ enabled: true, pausedUntil: 'not a date' })}
      />,
    );
    expect(screen.getByText(/paused until tomorrow because/)).toBeTruthy();
  });

  it('reverts when the action fails', async () => {
    setSearchSwitchAction.mockResolvedValue({ status: 'failed' });
    render(<SearchSwitch profileId={ID} view={view({ key: 'indeed' })} />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(setSearchSwitchAction).toHaveBeenCalledWith(ID, 'indeed', true);
    await waitFor(() =>
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
  });
});

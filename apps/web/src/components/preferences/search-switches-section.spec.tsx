import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchSwitchesSection } from './search-switches-section';

const searchSwitches = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine/server', () => ({
  engineClient: async () => ({ searchSwitches }),
}));
vi.mock('@/app/(app)/preferences/actions', () => ({
  setSearchSwitchAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ID = '11111111-1111-4111-8111-111111111111';

async function renderSection() {
  render(await SearchSwitchesSection({ profileId: ID }));
}

describe('SearchSwitchesSection', () => {
  it('renders one switch per item', async () => {
    searchSwitches.mockResolvedValue({
      kind: 'ok',
      data: [
        { key: 'posts', enabled: false, searches: 1, pausedUntil: null },
        { key: 'indeed', enabled: true, searches: 3, pausedUntil: null },
      ],
    });
    await renderSection();
    expect(searchSwitches).toHaveBeenCalledWith(ID);
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.getByText('Search LinkedIn posts')).toBeTruthy();
    expect(screen.getByText('Search Indeed')).toBeTruthy();
  });

  it('renders nothing for an empty list', async () => {
    searchSwitches.mockResolvedValue({ kind: 'ok', data: [] });
    await renderSection();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders nothing when the engine has no searches route', async () => {
    searchSwitches.mockResolvedValue({ kind: 'not-found' });
    await renderSection();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders nothing when the engine throws', async () => {
    searchSwitches.mockRejectedValue(new Error('down'));
    await renderSection();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});

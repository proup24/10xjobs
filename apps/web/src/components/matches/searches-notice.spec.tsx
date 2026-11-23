import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchesNotice } from './searches-notice';

const engine = vi.hoisted(() => ({ searchesState: vi.fn() }));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));
vi.mock('@/app/(app)/searches-actions', () => ({
  resumeSearchesAction: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderNotice = async () => {
  const node = await SearchesNotice();
  render(<>{node}</>);
  return node;
};
const resumeButton = () =>
  screen.queryByRole('button', { name: 'Resume searches' });

describe('SearchesNotice', () => {
  it('shows the notice when searches are paused', async () => {
    engine.searchesState.mockResolvedValue({
      kind: 'ok',
      data: { paused: true, lastActiveAt: '2026-11-20T10:00:00.000Z' },
    });
    await renderNotice();
    expect(resumeButton()).toBeTruthy();
    expect(screen.getByText(/No activity since Nov 20/)).toBeTruthy();
  });

  it('renders nothing when searches are running', async () => {
    engine.searchesState.mockResolvedValue({
      kind: 'ok',
      data: { paused: false, lastActiveAt: null },
    });
    expect(await renderNotice()).toBeNull();
  });

  it('renders nothing when the state read fails', async () => {
    engine.searchesState.mockResolvedValue({ kind: 'unauthorized' });
    expect(await renderNotice()).toBeNull();
  });

  it('renders nothing when the engine is down', async () => {
    engine.searchesState.mockRejectedValue(new Error('down'));
    expect(await renderNotice()).toBeNull();
  });
});

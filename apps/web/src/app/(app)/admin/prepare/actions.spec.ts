// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silenceAuthorAction, unsilenceAuthorAction } from './actions';

const silenceAuthor = vi.hoisted(() => vi.fn());
const unsilenceAuthor = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine/server', () => ({
  engineClient: async () => ({ silenceAuthor, unsilenceAuthor }),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

beforeEach(() => {
  vi.clearAllMocks();
  silenceAuthor.mockResolvedValue({
    kind: 'ok',
    data: { status: 'silenced' },
  });
  unsilenceAuthor.mockResolvedValue({ kind: 'ok', data: null });
});

describe('silenceAuthorAction', () => {
  it('silences with a trimmed reason and revalidates the page', async () => {
    expect(
      await silenceAuthorAction({
        authorKey: 'profile:jane',
        name: 'Jane',
        reason: '  spam  ',
      }),
    ).toBe('saved');
    expect(silenceAuthor).toHaveBeenCalledWith({
      authorKey: 'profile:jane',
      name: 'Jane',
      reason: 'spam',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/prepare');
  });

  it('counts an author already silenced as saved', async () => {
    silenceAuthor.mockResolvedValue({
      kind: 'ok',
      data: { status: 'already' },
    });
    expect(
      await silenceAuthorAction({ authorKey: 'company:acme', reason: 'x' }),
    ).toBe('saved');
    expect(silenceAuthor).toHaveBeenCalledWith({
      authorKey: 'company:acme',
      name: null,
      reason: 'x',
    });
  });

  it.each([
    [{ authorKey: 'jane', reason: 'spam' }],
    [{ authorKey: null, reason: 'spam' }],
    [{ authorKey: 'profile:jane', reason: '   ' }],
    [{ authorKey: 'profile:jane', reason: 'x'.repeat(1001) }],
    [{ authorKey: 'profile:jane', reason: 'spam', name: 3 }],
    [null],
  ])('refuses %j without calling the engine', async (input) => {
    expect(await silenceAuthorAction(input)).toBe('failed');
    expect(silenceAuthor).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('fails when the engine refuses or throws', async () => {
    silenceAuthor.mockResolvedValue({ kind: 'forbidden' });
    expect(
      await silenceAuthorAction({ authorKey: 'profile:a', reason: 'r' }),
    ).toBe('failed');
    silenceAuthor.mockRejectedValue(new Error('down'));
    expect(
      await silenceAuthorAction({ authorKey: 'profile:a', reason: 'r' }),
    ).toBe('failed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('unsilenceAuthorAction', () => {
  it('un-silences and revalidates the page', async () => {
    expect(await unsilenceAuthorAction('profile:jane')).toBe('saved');
    expect(unsilenceAuthor).toHaveBeenCalledWith('profile:jane');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/prepare');
  });

  it('counts an author no longer silenced as saved', async () => {
    unsilenceAuthor.mockResolvedValue({ kind: 'not-found' });
    expect(await unsilenceAuthorAction('profile:jane')).toBe('saved');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/prepare');
  });

  it('refuses a malformed key without calling the engine', async () => {
    expect(await unsilenceAuthorAction('jane')).toBe('failed');
    expect(await unsilenceAuthorAction(42)).toBe('failed');
    expect(unsilenceAuthor).not.toHaveBeenCalled();
  });

  it('fails when the engine refuses or throws', async () => {
    unsilenceAuthor.mockResolvedValue({ kind: 'unavailable' });
    expect(await unsilenceAuthorAction('profile:a')).toBe('failed');
    unsilenceAuthor.mockRejectedValue(new Error('down'));
    expect(await unsilenceAuthorAction('profile:a')).toBe('failed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

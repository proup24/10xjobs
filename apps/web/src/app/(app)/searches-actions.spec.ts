// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeSearchesAction } from './searches-actions';

const engine = vi.hoisted(() => ({ resumeSearches: vi.fn() }));
vi.mock('@/lib/engine/server', () => ({ engineClient: async () => engine }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

beforeEach(() => vi.clearAllMocks());

describe('resumeSearchesAction', () => {
  it('resumes and revalidates Matches', async () => {
    engine.resumeSearches.mockResolvedValue({
      kind: 'ok',
      data: { paused: false, lastActiveAt: null },
    });
    expect(await resumeSearchesAction()).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('is not ok when the engine refuses, and revalidates nothing', async () => {
    engine.resumeSearches.mockResolvedValue({ kind: 'unauthorized' });
    expect(await resumeSearchesAction()).toEqual({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('is not ok when the engine is down', async () => {
    engine.resumeSearches.mockRejectedValue(new Error('down'));
    expect(await resumeSearchesAction()).toEqual({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

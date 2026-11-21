// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAdmin } from './is-admin';

const adminMe = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine/server', () => ({
  engineClient: async () => ({ adminMe }),
}));

beforeEach(() => vi.clearAllMocks());

describe('isAdmin', () => {
  it('is true only when the engine says admin', async () => {
    adminMe.mockResolvedValue({ kind: 'ok', data: { admin: true } });
    expect(await isAdmin()).toBe(true);
    adminMe.mockResolvedValue({ kind: 'ok', data: { admin: false } });
    expect(await isAdmin()).toBe(false);
    adminMe.mockResolvedValue({ kind: 'unavailable' });
    expect(await isAdmin()).toBe(false);
  });

  it('is false when the engine call throws', async () => {
    adminMe.mockRejectedValue(new Error('down'));
    expect(await isAdmin()).toBe(false);
  });
});

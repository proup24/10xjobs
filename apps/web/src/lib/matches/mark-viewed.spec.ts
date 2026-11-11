import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from '@/test/fake-supabase';
import { markViewed } from './mark-viewed';

afterEach(() => vi.restoreAllMocks());

describe('markViewed', () => {
  it('upserts the view, keeping the first time it was viewed', async () => {
    const fake = fakeSupabase();
    await markViewed(fake.supabase, 'u1', 'j1');
    const [call] = fake.queries('job_views', 'upsert');
    expect(call.payload).toEqual({ userId: 'u1', jobId: 'j1' });
    expect(call.options).toEqual({
      onConflict: 'userId,jobId',
      ignoreDuplicates: true,
    });
  });

  it('logs a failed write and resolves', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fake = fakeSupabase({
      reply: () => ({ data: null, error: { message: 'denied' } }),
    });
    await expect(markViewed(fake.supabase, 'u1', 'j1')).resolves.toBe(
      undefined,
    );
    expect(error).toHaveBeenCalled();
  });

  it('logs a thrown failure and resolves', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fake = fakeSupabase({
      reply: () => {
        throw new Error('network');
      },
    });
    await expect(markViewed(fake.supabase, 'u1', 'j1')).resolves.toBe(
      undefined,
    );
    expect(error).toHaveBeenCalled();
  });
});

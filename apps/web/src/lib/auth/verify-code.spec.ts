import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CODE_FAILED } from './copy';
import { verifyCode } from './verify-code';

function fakeAuth(error: { code: string } | null) {
  return {
    verifyOtp: vi.fn(async () => ({
      data: {},
      error,
    })) as unknown as SupabaseClient['auth']['verifyOtp'] &
      Mock<() => Promise<unknown>>,
  };
}

describe('verifyCode', () => {
  it('verifies with type email and the normalized email', async () => {
    const auth = fakeAuth(null);
    expect(await verifyCode(auth, ' Me@Example.com ', '123456')).toEqual({
      ok: true,
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it.each([['otp_expired'], ['user_banned']])(
    'returns CODE_FAILED for %s',
    async (code) => {
      expect(
        await verifyCode(fakeAuth({ code }), 'me@example.com', '123456'),
      ).toEqual({
        ok: false,
        message: CODE_FAILED,
      });
    },
  );

  it.each([['12345'], ['1234567'], ['12a456'], ['']])(
    'rejects %j without calling Supabase',
    async (code) => {
      const auth = fakeAuth(null);
      expect(await verifyCode(auth, 'me@example.com', code)).toEqual({
        ok: false,
        message: CODE_FAILED,
      });
      expect(auth.verifyOtp).not.toHaveBeenCalled();
    },
  );
});

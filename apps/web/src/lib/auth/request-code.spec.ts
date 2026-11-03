import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { NEUTRAL_SENT } from './copy';
import { MIN_RESPONSE_MS, requestCode } from './request-code';

type Reply = { data: object; error: { code: string } | null };

function fakeAuth(reply: Reply | Error) {
  return {
    signInWithOtp: vi.fn(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    }) as unknown as SupabaseClient['auth']['signInWithOtp'] &
      Mock<() => Promise<Reply>>,
  };
}

function makeDeps(elapsed = 200) {
  let calls = 0;
  return {
    now: () => (calls++ === 0 ? 0 : elapsed),
    sleep: vi.fn(async () => undefined),
    log: vi.fn(),
  };
}

describe('requestCode', () => {
  it.each([
    ['sent', { data: {}, error: null }],
    ['unknown email', { data: {}, error: { code: 'otp_disabled' } }],
    ['unaccepted invite', { data: {}, error: { code: 'signup_disabled' } }],
    [
      'rate limited',
      { data: {}, error: { code: 'over_email_send_rate_limit' } },
    ],
  ])('answers %s with the neutral message', async (_, reply) => {
    const deps = makeDeps();
    expect(await requestCode(fakeAuth(reply), 'me@example.com', deps)).toEqual({
      status: 'sent',
      message: NEUTRAL_SENT,
    });
  });

  it('answers a thrown network error the same way', async () => {
    const deps = makeDeps();
    const result = await requestCode(
      fakeAuth(new Error('network down')),
      'me@example.com',
      deps,
    );
    expect(result).toEqual({ status: 'sent', message: NEUTRAL_SENT });
    expect(deps.sleep).toHaveBeenCalledWith(MIN_RESPONSE_MS - 200);
  });

  it('pads to 1500 ms from the start', async () => {
    const deps = makeDeps(200);
    await requestCode(
      fakeAuth({ data: {}, error: null }),
      'me@example.com',
      deps,
    );
    expect(deps.sleep).toHaveBeenCalledWith(1300);
  });

  it('pads a rate-limited reply the same as a sent one', async () => {
    const deps = makeDeps(200);
    await requestCode(
      fakeAuth({ data: {}, error: { code: 'over_email_send_rate_limit' } }),
      'me@example.com',
      deps,
    );
    expect(deps.sleep).toHaveBeenCalledWith(1300);
  });

  it('does not sleep when the call already took longer than 1500 ms', async () => {
    const deps = makeDeps(2000);
    await requestCode(
      fakeAuth({ data: {}, error: null }),
      'me@example.com',
      deps,
    );
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('passes shouldCreateUser false and the normalized email', async () => {
    const auth = fakeAuth({ data: {}, error: null });
    await requestCode(auth, ' Me@Example.com ', makeDeps());
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      options: { shouldCreateUser: false },
    });
  });

  it('rejects a malformed email without calling Supabase', async () => {
    const auth = fakeAuth({ data: {}, error: null });
    const result = await requestCode(auth, 'not-an-email', makeDeps());
    expect(result).toEqual({
      status: 'invalid',
      message: 'Enter a valid email address.',
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('logs the outcome code and never the email', async () => {
    const deps = makeDeps();
    await requestCode(
      fakeAuth({ data: {}, error: { code: 'otp_disabled' } }),
      'me@example.com',
      deps,
    );
    expect(deps.log).toHaveBeenCalledWith('otp_disabled');
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain('example.com');
  });
});

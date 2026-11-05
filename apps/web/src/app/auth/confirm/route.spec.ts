import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));

function call(query: string) {
  return GET(new NextRequest(`http://localhost:3000/auth/confirm${query}`));
}

function location(res: Response) {
  const url = new URL(res.headers.get('location') ?? '');
  return url.pathname + url.search;
}

describe('GET /auth/confirm', () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  it('verifies an invite link and redirects to /', async () => {
    const res = await call('?token_hash=h&type=invite');
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'invite' });
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/');
  });

  it('verifies an email link', async () => {
    const res = await call('?token_hash=h&type=email');
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'email' });
    expect(location(res)).toBe('/');
  });

  it('sends a failed verification to /sign-in?reason=link', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: { code: 'otp_expired' } });
    const res = await call('?token_hash=h&type=email');
    expect(location(res)).toBe('/sign-in?reason=link');
  });

  it.each(['recovery', 'signup', ''])(
    'refuses type %j without calling Supabase',
    async (type) => {
      const res = await call(`?token_hash=h&type=${type}`);
      expect(verifyOtp).not.toHaveBeenCalled();
      expect(location(res)).toBe('/sign-in?reason=link');
    },
  );

  it('refuses a missing token_hash without calling Supabase', async () => {
    const res = await call('?type=invite');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe('/sign-in?reason=link');
  });
});

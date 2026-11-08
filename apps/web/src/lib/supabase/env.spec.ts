// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPublicSupabaseEnv } from './env';

describe('readPublicSupabaseEnv', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pub-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns both values when set', () => {
    expect(readPublicSupabaseEnv()).toEqual({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'pub-key',
    });
  });

  it('throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(() => readPublicSupabaseEnv()).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL is not set',
    );
  });

  it('throws naming NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when it is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    expect(() => readPublicSupabaseEnv()).toThrow(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set',
    );
  });
});

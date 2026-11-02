import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync }));

import { loadStackEnv } from './stack-env.js';

const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DB_TESTS_ALLOW_REMOTE',
];

describe('loadStackEnv', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    for (const key of KEYS) vi.stubEnv(key, undefined as unknown as string);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the three env vars when all are set', () => {
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');

    expect(loadStackEnv()).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon',
      serviceRoleKey: 'service',
    });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('throws naming pnpm db:start when env is unset and the CLI fails', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('stack is down');
    });

    expect(() => loadStackEnv()).toThrow(/pnpm db:start/);
  });

  it('keeps the CLI failure as the error cause', () => {
    const failure = new Error('stack is down');
    execFileSync.mockImplementation(() => {
      throw failure;
    });

    expect(() => loadStackEnv()).toThrow(
      expect.objectContaining({ cause: failure }),
    );
  });

  describe('non-local URLs', () => {
    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://abc.supabase.co');
      vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    });

    it('refuses a non-local host, naming it and the opt-in variable', () => {
      expect(() => loadStackEnv()).toThrow(
        /abc\.supabase\.co.*DB_TESTS_ALLOW_REMOTE=1/,
      );
    });

    it('allows it when DB_TESTS_ALLOW_REMOTE=1', () => {
      vi.stubEnv('DB_TESTS_ALLOW_REMOTE', '1');
      expect(loadStackEnv().url).toBe('https://abc.supabase.co');
    });
  });
});

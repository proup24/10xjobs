import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync }));

import { loadStackEnv } from './stack-env.js';

const KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

describe('loadStackEnv', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    for (const key of KEYS) vi.stubEnv(key, undefined as unknown as string);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the three env vars when all are set', () => {
    vi.stubEnv('SUPABASE_URL', 'http://example.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');

    expect(loadStackEnv()).toEqual({
      url: 'http://example.test',
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
});

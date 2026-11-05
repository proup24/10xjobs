import { describe, expect, it } from 'vitest';
import { fakeAuth } from './fake-auth';
import { runUsersCli } from './users-cli';

const env = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
};

function setup() {
  const lines: string[] = [];
  return { lines, print: (l: string) => void lines.push(l) };
}

describe('runUsersCli', () => {
  it('refuses to run without both variables', async () => {
    const { lines, print } = setup();
    expect(await runUsersCli(['list'], {}, { print })).toBe(1);
    expect(
      await runUsersCli(['list'], { SUPABASE_URL: 'https://a.co' }, { print }),
    ).toBe(1);
    expect(lines[0]).toBe(
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (locally: eval "$(scripts/supabase-env.sh)").',
    );
  });

  it('prints the target host first', async () => {
    const { lines, print } = setup();
    const fake = fakeAuth();
    expect(
      await runUsersCli(['list'], env, { createAuth: () => fake, print }),
    ).toBe(0);
    expect(lines[0]).toBe('Using abc.supabase.co');
  });

  it('runs invite and returns 0, or 1 on failure', async () => {
    const { lines, print } = setup();
    const fake = fakeAuth();
    const deps = { createAuth: () => fake, print };
    expect(await runUsersCli(['invite', 'Me@x.co'], env, deps)).toBe(0);
    expect(lines).toContain('Invited me@x.co.');
    expect(await runUsersCli(['block', 'nobody@x.co'], env, deps)).toBe(1);
    expect(lines).toContain('No user with email nobody@x.co.');
  });

  it('prints usage and returns 1 for an unknown command', async () => {
    const { lines, print } = setup();
    const deps = { createAuth: () => fakeAuth(), print };
    expect(await runUsersCli(['nope'], env, deps)).toBe(1);
    expect(await runUsersCli(['invite'], env, deps)).toBe(1);
    expect(lines).toContain(
      'Usage: pnpm users <invite|block|unblock> <email> | pnpm users list',
    );
  });
});

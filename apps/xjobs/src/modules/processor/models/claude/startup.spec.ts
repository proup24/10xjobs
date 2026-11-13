import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeExtractionModel } from '../claude-extraction.model';
import { ClaudeRunner } from './runner';
import {
  checkClaudeCall,
  checkClaudeInstalled,
  claudeBin,
  hasClaudeCredential,
} from './startup';

const FAKE = resolve(__dirname, '../../testing/fake-claude.mjs');
const fixture = (name: string) =>
  resolve(__dirname, 'fixtures', `${name}.jsonl`);

function model(extraEnv: Record<string, string> = {}) {
  const runner = new ClaudeRunner({
    bin: FAKE,
    env: { PATH: process.env.PATH ?? '', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' },
    extraEnv,
    maxTurns: 1,
  });
  return new ClaudeExtractionModel(
    runner,
    'claude-sonnet-5-5',
    { effort: 'low', timeoutMs: 10_000 },
    () => undefined,
  );
}

describe('hasClaudeCredential', () => {
  it.each([
    [{ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' }, true],
    [{ ANTHROPIC_API_KEY: 'key' }, true],
    [{ CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '' }, false],
    [{}, false],
  ])('%j → %s', (env, expected) => {
    expect(hasClaudeCredential(env)).toBe(expected);
  });
});

describe('claudeBin', () => {
  it('reads XJOBS_CLAUDE_BIN only when NODE_ENV=test', () => {
    expect(claudeBin({ NODE_ENV: 'test', XJOBS_CLAUDE_BIN: '/fake' })).toBe(
      '/fake',
    );
    expect(
      claudeBin({ NODE_ENV: 'production', XJOBS_CLAUDE_BIN: '/fake' }),
    ).toBe('claude');
    expect(claudeBin({ XJOBS_CLAUDE_BIN: '/fake' })).toBe('claude');
    expect(claudeBin({ NODE_ENV: 'test' })).toBe('claude');
  });
});

describe('checkClaudeInstalled', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'startup-spec-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function script(body: string): string {
    const path = join(dir, 'claude');
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  it('passes on the pinned version', async () => {
    await expect(checkClaudeInstalled(FAKE)).resolves.toBeUndefined();
  });

  it('throws on another version', async () => {
    const bin = script('echo "2.1.300 (Claude Code)"');
    await expect(checkClaudeInstalled(bin)).rejects.toThrow(
      /2\.1\.300.*2\.1\.314/,
    );
  });

  it('throws on unparseable output', async () => {
    const bin = script('echo "hello"');
    await expect(checkClaudeInstalled(bin)).rejects.toThrow(/version/);
  });

  it('throws when the binary is missing', async () => {
    await expect(
      checkClaudeInstalled(join(dir, 'does-not-exist')),
    ).rejects.toThrow(/could not run.*ENOENT.*Claude Code 2\.1\.314/);
  });

  it('runs --version with only PATH and an empty HOME', async () => {
    const out = join(dir, 'env.txt');
    const bin = script(
      `env > "${out}"\nls -A "$HOME" >> "${out}"\necho "2.1.314 (Claude Code)"`,
    );
    process.env.XJOBS_STARTUP_SPEC_SECRET = 'secret';
    try {
      await checkClaudeInstalled(bin);
    } finally {
      delete process.env.XJOBS_STARTUP_SPEC_SECRET;
    }
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(out, 'utf8');
    expect(text).not.toContain('XJOBS_STARTUP_SPEC_SECRET');
    expect(text).toMatch(/^HOME=/m);
    expect(text).toMatch(/^PATH=/m);
  });
});

describe('checkClaudeCall', () => {
  it('returns null when the call succeeds', async () => {
    expect(await checkClaudeCall(model())).toBeNull();
  });

  it('returns { kind: "auth" } on an auth failure', async () => {
    expect(
      await checkClaudeCall(
        model({
          FAKE_CLAUDE_SCENARIO: fixture('auth-failure'),
          FAKE_CLAUDE_EXIT: '1',
        }),
      ),
    ).toEqual({ kind: 'auth' });
  });

  it('returns the usage limit with its reset', async () => {
    const failure = await checkClaudeCall(
      model({ FAKE_CLAUDE_SCENARIO: fixture('usage-limit') }),
    );
    expect(failure?.kind).toBe('usage_limit');
    expect(
      failure?.kind === 'usage_limit' && failure.limit?.resetsAt,
    ).toBeInstanceOf(Date);
  });

  it('returns an output failure when no structured output came back', async () => {
    const failure = await checkClaudeCall(
      model({ FAKE_CLAUDE_SCENARIO: fixture('no-structured-output') }),
    );
    expect(failure?.kind).toBe('output');
  });
});

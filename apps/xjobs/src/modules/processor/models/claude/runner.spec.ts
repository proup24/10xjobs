import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeCall, ClaudeRunner } from './runner';

const FAKE = resolve(__dirname, '../../testing/fake-claude.mjs');
const SOURCE = {
  PATH: process.env.PATH ?? '',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
  DATABASE_URL: 'postgres://secret',
};

const call: ClaudeCall = {
  model: 'claude-sonnet-5-5',
  systemPrompt: 'SYSTEM PROMPT',
  userMessage: 'USER MESSAGE',
  jsonSchema: { type: 'object' },
  effort: 'low',
  timeoutMs: 10_000,
};

interface Recorded {
  argv: string[];
  cwd: string;
  cwdEntries: string[];
  grandchildPid?: number;
  env: Record<string, string>;
  stdin: string;
}

describe('ClaudeRunner', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-spec-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function runner(extra: Record<string, string> = {}) {
    return new ClaudeRunner({
      bin: FAKE,
      env: SOURCE,
      maxTurns: 1,
      extraEnv: { FAKE_CLAUDE_RECORD: join(dir, 'rec.json'), ...extra },
    });
  }
  const record = (): Recorded =>
    JSON.parse(readFileSync(join(dir, 'rec.json'), 'utf8'));

  it('passes exactly the isolation flags', async () => {
    const r = runner();
    const out = await r.run(call);
    expect(out.code).toBe(0);
    const { argv } = record();
    const i = argv.indexOf('--system-prompt-file');
    const promptFile = argv[i + 1];
    expect(promptFile).toBeTruthy();
    expect(argv).toEqual([
      '-p',
      '--system-prompt-file',
      promptFile,
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--output-format',
      'stream-json',
      '--verbose',
      '--json-schema',
      JSON.stringify(call.jsonSchema),
      '--model',
      'claude-sonnet-5-5',
      '--effort',
      'low',
      '--max-turns',
      '1',
      '--tools',
      '',
    ]);
    expect(argv).not.toContain('--disallowedTools');
    expect(argv).not.toContain('--bare');
    expect(existsSync(promptFile)).toBe(false);
  });

  it('writes the system prompt to the file the child reads', async () => {
    // the fake does not read the file, so capture it via a wrapper script
    const wrapper = join(dir, 'wrap.sh');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nfor a in "$@"; do if [ "$p" = 1 ]; then cp "$a" "${dir}/prompt.txt"; p=0; fi; [ "$a" = --system-prompt-file ] && p=1; done\nexec "${FAKE}" "$@"\n`,
      { mode: 0o755 },
    );
    await new ClaudeRunner({
      bin: wrapper,
      env: SOURCE,
      maxTurns: 1,
      extraEnv: { FAKE_CLAUDE_RECORD: join(dir, 'rec.json') },
    }).run(call);
    expect(readFileSync(join(dir, 'prompt.txt'), 'utf8')).toBe('SYSTEM PROMPT');
  });

  it('runs in a fresh empty cwd and HOME, removed afterwards', async () => {
    await runner().run(call);
    const rec = record();
    expect(rec.cwd).not.toBe(process.cwd());
    expect(rec.cwdEntries).toEqual([]);
    expect(rec.env.HOME).not.toBe(rec.cwd);
    expect(existsSync(rec.cwd)).toBe(false);
    expect(existsSync(rec.env.HOME)).toBe(false);
  });

  it('writes the user message on stdin', async () => {
    await runner().run(call);
    expect(record().stdin).toBe('USER MESSAGE');
  });

  it('passes only the claudeEnv variables', async () => {
    await runner().run(call);
    const env = record().env;
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth');
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
  });

  it('returns the stdout and exit code', async () => {
    const out = await runner({ FAKE_CLAUDE_EXIT: '3' }).run(call);
    expect(out.code).toBe(3);
    expect(out.timedOut).toBe(false);
    expect(out.stdout).toContain('"type":"result"');
  });

  it('kills a hung process and its grandchild at the timeout', async () => {
    const pidFile = join(dir, 'child.pid');
    const timeoutMs = 2000;
    const started = Date.now();
    const out = await runner({
      FAKE_CLAUDE_HANG: '1',
      FAKE_CLAUDE_CHILD_PID_FILE: pidFile,
    }).run({ ...call, timeoutMs });
    expect(out.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(timeoutMs + 1500);
    // The timeout is generous so node has started under parallel load.
    expect(existsSync(join(dir, 'rec.json'))).toBe(true);
    const rec = record();
    expect(existsSync(rec.cwd)).toBe(false);
    expect(existsSync(rec.env.HOME)).toBe(false);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    expect(grandchild).toBe(rec.grandchildPid);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(grandchild, 0)).toThrow();
  });

  it('rejects clearly when the binary is missing', async () => {
    await expect(
      new ClaudeRunner({
        bin: join(dir, 'nope'),
        env: SOURCE,
        maxTurns: 1,
      }).run(call),
    ).rejects.toThrow(/claude/i);
  });
});

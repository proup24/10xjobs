#!/usr/bin/env node
// Test double for `claude -p`. Driven by FAKE_CLAUDE_* variables (see runner.spec.ts).
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const env = process.env;

if (argv.includes('--version')) {
  console.log('2.1.314 (Claude Code)');
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const scenario =
  env.FAKE_CLAUDE_SCENARIO ??
  resolve(here, '../models/claude/fixtures/success.jsonl');

function record(extra) {
  if (!env.FAKE_CLAUDE_RECORD) return;
  writeFileSync(
    env.FAKE_CLAUDE_RECORD,
    JSON.stringify({
      argv,
      cwd: process.cwd(),
      cwdEntries: readdirSync(process.cwd()),
      env,
      ...extra,
    }),
  );
}

if (env.FAKE_CLAUDE_HANG === '1') {
  const grandchild = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 600000)'],
    { stdio: 'ignore' },
  );
  record({ stdin: '', grandchildPid: grandchild.pid });
  if (env.FAKE_CLAUDE_CHILD_PID_FILE) {
    writeFileSync(env.FAKE_CLAUDE_CHILD_PID_FILE, String(grandchild.pid));
  }
  setInterval(() => undefined, 1000);
} else {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (stdin += chunk));
  process.stdin.on('end', () => {
    record({ stdin });
    process.stdout.write(readFileSync(scenario, 'utf8'), () => {
      process.exit(Number(env.FAKE_CLAUDE_EXIT ?? 0));
    });
  });
}

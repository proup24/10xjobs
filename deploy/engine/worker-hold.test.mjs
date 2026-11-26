import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'worker-hold.sh',
);

// Runs the script with a stub `docker` first on PATH that prints `stdout`.
const run = (stdout, exitCode = 0) => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-hold-'));
  const stub = join(dir, 'docker');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${dir}/args.txt"\nprintf '%s' "$STUB_STDOUT"\nexit ${exitCode}\n`,
  );
  chmodSync(stub, 0o755);
  const r = spawnSync('bash', [scriptPath], {
    env: {
      ...process.env,
      STUB_STDOUT: stdout,
      PATH: `${dir}:${process.env.PATH}`,
    },
    encoding: 'utf8',
  });
  let args = '';
  try {
    args = readFileSync(join(dir, 'args.txt'), 'utf8');
  } catch {
    // the script never called docker
  }
  return { code: r.status, out: r.stdout.trim(), err: r.stderr, args };
};

test('running → start', () => {
  assert.equal(run('running\n').out, 'start');
});
test('restarting → start', () => {
  assert.equal(run('restarting\n').out, 'start');
});
test('removing → start', () => {
  assert.equal(run('removing\n').out, 'start');
});
test('no container (empty output) → start', () => {
  const r = run('');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'start');
});
test('exited → hold', () => {
  assert.equal(run('exited\n').out, 'hold');
});
test('created → hold', () => {
  assert.equal(run('created\n').out, 'hold');
});
test('paused → hold', () => {
  assert.equal(run('paused\n').out, 'hold');
});
test('dead → hold', () => {
  assert.equal(run('dead\n').out, 'hold');
});
test('two containers, one running → start', () => {
  assert.equal(run('exited\nrunning\n').out, 'start');
});
test('exited plus created → hold', () => {
  assert.equal(run('exited\ncreated\n').out, 'hold');
});
test('trailing CRLF and blank lines → hold', () => {
  assert.equal(run('exited\r\n\r\n').out, 'hold');
});
test('unknown state → exit 1', () => {
  const r = run('sleeping\n');
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /^worker-hold:/);
});
test('docker exits 1 → exit 1', () => {
  const r = run('', 1);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
});
test('queries the worker of xjobs-engine', () => {
  const { args } = run('running\n');
  assert.ok(args.includes('label=com.docker.compose.project=xjobs-engine'));
  assert.ok(args.includes('label=com.docker.compose.service=worker'));
});

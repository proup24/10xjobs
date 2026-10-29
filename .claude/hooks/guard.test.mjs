import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './guard.mjs';

const blocked = (tool_name, tool_input) =>
  evaluate({ tool_name, tool_input }).block;

test('secrets via file tools', () => {
  assert.equal(blocked('Read', { file_path: '/repo/.env' }), true);
  assert.equal(blocked('Read', { file_path: '/repo/.env.local' }), true);
  assert.equal(
    blocked('Edit', { file_path: '/repo/apps/xjobs/.env.production' }),
    true,
  );
  assert.equal(blocked('Read', { file_path: '/repo/.env.example' }), false);
  assert.equal(blocked('Write', { file_path: '/repo/.env.example' }), false);
  assert.equal(
    blocked('Read', { file_path: '/repo/src/environment.ts' }),
    false,
  );
  assert.equal(blocked('Grep', { pattern: 'KEY', path: '/repo/.env' }), true);
  assert.equal(blocked('Glob', { pattern: '**/.env*' }), true);
  assert.equal(blocked('Grep', { pattern: 'x', glob: '**/.env*' }), true);
});

test('private data', () => {
  assert.equal(
    blocked('Read', { file_path: '/home/u/repo/private/cv.md' }),
    true,
  );
  assert.equal(blocked('Grep', { pattern: 'x', path: 'private' }), true);
  assert.equal(blocked('Glob', { pattern: 'private/**' }), true);
  assert.equal(
    blocked('Read', { file_path: '/repo/apps/private-api/x.ts' }),
    false,
  );
  // Grep's pattern is a content regex, not a path
  assert.equal(blocked('Grep', { pattern: 'private' }), false);
});

test('bash: secrets and private', () => {
  assert.equal(blocked('Bash', { command: 'cat .env' }), true);
  assert.equal(blocked('Bash', { command: 'grep -r token ./private/' }), true);
  assert.equal(blocked('Bash', { command: 'cat --env-file=.env' }), true);
  assert.equal(blocked('Bash', { command: 'cat ".env"' }), true);
  assert.equal(blocked('Bash', { command: 'cat .env.example' }), false);
  assert.equal(blocked('Bash', { command: 'ls apps/private-api' }), false);
});

test('bash: git push', () => {
  assert.equal(blocked('Bash', { command: 'git push' }), true);
  assert.equal(
    blocked('Bash', { command: 'git push -u origin chore/x' }),
    true,
  );
  assert.equal(blocked('Bash', { command: 'cd apps && git push' }), true);
  assert.equal(blocked('Bash', { command: 'git -C apps push' }), true);
  assert.equal(
    blocked('Bash', { command: 'git status; git push --force' }),
    true,
  );
  assert.equal(blocked('Bash', { command: 'FOO=1 git push' }), true);
  assert.equal(blocked('Bash', { command: 'git commit -m "push fix"' }), false);
  assert.equal(blocked('Bash', { command: 'git status' }), false);
});

test('unrelated tools pass', () => {
  assert.equal(blocked('WebSearch', { query: '.env' }), false);
});

test('reasons', () => {
  const push = evaluate({
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
  });
  assert.match(push.reason, /push it yourself/);
  const secret = evaluate({
    tool_name: 'Read',
    tool_input: { file_path: '/repo/.env' },
  });
  assert.match(secret.reason, /\/repo\/\.env/);
});

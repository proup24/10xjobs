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

test('bash: git push of a feature branch is allowed', () => {
  for (const command of [
    'git push -u origin chore/x',
    'git push --set-upstream origin docs/phase-2-roadmap',
    'git push origin feat/edit-preferences',
    'git push origin refs/heads/feat/x',
    'git -C .worktrees/x push -u origin feat/x',
    'cd .worktrees/x && git push -u origin feat/x',
    'git status && git push -u origin fix/a_b.c',
    'bash -c "git push -u origin chore/x"',
  ]) {
    assert.equal(blocked('Bash', { command }), false, command);
  }
});

test('bash: unsafe git push forms stay blocked', () => {
  for (const command of [
    // main, directly or by another name
    'git push origin main',
    'git push -u origin main',
    'git push origin refs/heads/main',
    'git push origin master',
    'git push origin HEAD',
    'git push origin feat/x:main',
    'git push origin HEAD:main',
    // implicit target
    'git push',
    'git push -u',
    'git push origin',
    // force, delete, mirror, all
    'git push --force origin feat/x',
    'git push -f origin feat/x',
    'git push -uf origin feat/x',
    'git push --force-with-lease origin feat/x',
    'git push origin +feat/x',
    'git push --delete origin feat/x',
    'git push -d origin feat/x',
    'git push origin :feat/x',
    'git push --mirror origin',
    'git push --all origin',
    'git push --tags origin',
    // other remotes, extra refspecs, tags, overrides, flags
    'git push upstream feat/x',
    'git push git@github.com:x/y.git feat/x',
    'git push origin feat/x main',
    'git push origin refs/tags/v1',
    'git push origin feat/../main',
    'git -c remote.origin.url=x push origin feat/x',
    'git --config-env=a=b push origin feat/x',
    'git push --no-verify origin feat/x',
    'git push --receive-pack=x origin feat/x',
    'git push -o ci.skip origin feat/x',
    // unverifiable arguments
    'echo main | xargs git push origin feat/x',
    'bash -c "git push origin main"',
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
});

test('bash: git push', () => {
  assert.equal(blocked('Bash', { command: 'git push' }), true);
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

test('bash: separators attached to tokens', () => {
  for (const command of [
    'cat .env; ls',
    'cat .env|head',
    'cat private/x;ls',
    'cat <.env',
    'echo $(cat .env)',
    'echo `cat .env`',
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  assert.equal(blocked('Bash', { command: 'cat .env.example; ls' }), false);
  assert.equal(blocked('Bash', { command: 'bash -c "cat .env"' }), true);
  assert.equal(blocked('Bash', { command: "sh -c 'ls private/'" }), true);
  assert.equal(blocked('Bash', { command: 'eval cat .env' }), true);
  assert.equal(
    blocked('Bash', { command: 'bash -c "cat .env.example"' }),
    false,
  );
});

test('bash: git push through wrappers', () => {
  for (const command of [
    'sleep 1 & git push',
    '(git push)',
    '{ git push; }',
    '$(git push)',
    '`git push`',
    'sudo git push',
    'env git push',
    'env FOO=1 git push',
    'sudo -E git push',
    'time git push',
    'command git push',
    'nice -n 5 git push',
    'exec git push',
    'xargs git push',
    'bash -c "git push"',
    "sh -c 'cd x && git push'",
    'zsh -lc "git push"',
    'eval git push',
    'eval "git push"',
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  assert.equal(blocked('Bash', { command: 'bash -c "git status"' }), false);
  assert.equal(blocked('Bash', { command: 'sudo git status' }), false);
});

test('bash: comments, escapes, heredocs, unterminated quotes', () => {
  for (const command of [
    "# Let's push the branch\ngit push -u origin main",
    "# don't print it\ncat .env",
    "cat > /tmp/m <<'EOF'\nDon't forget\nEOF\ngit commit -F /tmp/m && git push",
    "echo it\\'s && git push",
    "echo 'unterminated && git push",
    "echo 'unterminated && cat .env",
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  for (const command of [
    'git commit -m "push fix"',
    'git commit -m "say \\"push\\" now"',
    '# git push later\nls',
    "cat > /tmp/m <<'EOF'\ngit push\nEOF\nls",
  ]) {
    assert.equal(blocked('Bash', { command }), false, command);
  }
});

test('bash: env wildcards', () => {
  for (const command of ['cat .env*', 'grep KEY .env*', 'cat .env{,.local}']) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  assert.equal(blocked('Bash', { command: 'cat .envrc' }), false);
  assert.equal(blocked('Bash', { command: 'cat .env.example' }), false);
  assert.equal(blocked('Bash', { command: 'ls *.ts' }), false);
});

test('bash: keywords and wrappers before git push', () => {
  for (const command of [
    'if true; then git push; fi',
    'for x in a; do git push; done',
    'if false; then :; else git push; fi',
    '! git push',
    'nohup git push',
    'timeout 60 git push',
    'timeout -s KILL 60 git push',
    'git \\\n push',
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  assert.equal(blocked('Bash', { command: 'timeout 60 git status' }), false);
});

test('unrelated tools pass', () => {
  assert.equal(blocked('WebSearch', { query: '.env' }), false);
});

test('reasons', () => {
  const push = evaluate({
    tool_name: 'Bash',
    tool_input: { command: 'git push' },
  });
  assert.match(push.reason, /name the remote and one branch/);
  const main = evaluate({
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
  });
  assert.match(main.reason, /main is protected/);
  const secret = evaluate({
    tool_name: 'Read',
    tool_input: { file_path: '/repo/.env' },
  });
  assert.match(secret.reason, /\/repo\/\.env/);
});

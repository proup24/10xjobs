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
    "# Let's push the branch\ngit push -u origin x",
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

test('bash: heredoc bodies that run', () => {
  for (const command of [
    "bash <<'EOF'\ngit push\nEOF",
    'sh <<EOF\ncat .env\nEOF',
    "cat <<'EOF' | bash\ngit push\nEOF",
    'cat <<EOF | sh -s\ncat .env\nEOF',
    'cat <<EOF\n$(git push)\nEOF',
    'cat <<EOF\n`cat .env`\nEOF',
  ]) {
    assert.equal(blocked('Bash', { command }), true, command);
  }
  for (const command of [
    "cat > /tmp/m <<'EOF'\ngit push\nEOF\nls",
    "git commit -F - <<'EOF'\nDocument .env and git push\nEOF",
    "cat <<'EOF' | grep push\ngit push\nEOF",
    "cat <<'EOF' || bash x.sh\ngit push\nEOF",
  ]) {
    assert.equal(blocked('Bash', { command }), false, command);
  }
});

const onBranch = (branch, command) =>
  evaluate({ tool_name: 'Bash', tool_input: { command } }, { branch }).block;

test('bash: no commits or merges on main', () => {
  for (const command of [
    'git commit -m x',
    'git add . && git commit -m x',
    'git -C . commit -m x',
    'git merge fix/x',
    'git cherry-pick abc123',
    'git revert abc123',
    'git rebase fix/x',
    'git am fix.patch',
    'bash -c "git commit -m x"',
  ]) {
    assert.equal(onBranch('main', command), true, command);
  }
  for (const command of [
    'git status',
    'git pull',
    'git log --oneline',
    'git checkout -b fix/x',
    'git switch -c fix/x && git commit -m x',
    'git checkout -b fix/x main && git commit -m x',
    'git checkout main -- README.md',
  ]) {
    assert.equal(onBranch('main', command), false, command);
  }
});

test('bash: no switching to main to commit or merge', () => {
  for (const command of [
    'git checkout main && git merge fix/x',
    'git switch main; git commit -m x',
  ]) {
    assert.equal(onBranch('fix/x', command), true, command);
  }
  assert.equal(onBranch('fix/x', 'git commit -m x'), false);
  assert.equal(onBranch('fix/x', 'git merge main'), false);
  assert.equal(onBranch(undefined, 'git commit -m x'), false);
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
  const main = evaluate(
    { tool_name: 'Bash', tool_input: { command: 'git commit -m x' } },
    { branch: 'main' },
  );
  assert.match(main.reason, /pull request/);
});

import { pathToFileURL } from 'node:url';

const segments = (p) => p.split('/');
const isSecret = (s) =>
  s === '.env' || (s.startsWith('.env.') && s !== '.env.example');
const isPrivate = (s) => s === 'private';

const pathHit = (p) => segments(p).some((s) => isSecret(s) || isPrivate(s));
// Globs can match a secret through a wildcard such as `.env*`.
const globHit = (p) =>
  segments(p).some((s) => s.startsWith('.env') && s !== '.env.example') ||
  segments(p).some(isPrivate);

const PATH_KEYS = ['file_path', 'notebook_path'];
const CHECKS = {
  Grep: [
    [['path'], pathHit],
    [['glob'], globHit],
  ],
  Glob: [
    [['path'], pathHit],
    [['pattern'], globHit],
  ],
};

const blockPath = (p) => ({
  block: true,
  reason: `Blocked: ${p} is a secret or private file (see CLAUDE.md).`,
});

const tokenize = (command) =>
  (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) =>
    t.replace(/^["']|["']$/g, '').replace(/^\.\//, ''),
  );

function isGitPush(command) {
  for (const part of command.split(/;|&&|\|\||\||\n/)) {
    const tokens = tokenize(part);
    let i = 0;
    while (/^\w+=/.test(tokens[i] ?? '')) i++;
    if (tokens[i++] !== 'git') continue;
    while (tokens[i]?.startsWith('-'))
      i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
    if (tokens[i] === 'push') return true;
  }
  return false;
}

export function evaluate({ tool_name, tool_input = {} }) {
  if (tool_name === 'Bash') {
    const command = tool_input.command ?? '';
    if (isGitPush(command)) {
      return {
        block: true,
        reason:
          'git push is blocked for Claude in this repo — push it yourself.',
      };
    }
    for (const token of tokenize(command)) {
      for (const candidate of [token, token.slice(token.indexOf('=') + 1)]) {
        if (pathHit(candidate)) return blockPath(token);
      }
    }
    return { block: false };
  }

  const checks = [...(CHECKS[tool_name] ?? []), [PATH_KEYS, pathHit]];
  for (const [keys, hit] of checks) {
    for (const key of keys) {
      const value = tool_input[key];
      if (typeof value === 'string' && hit(value)) return blockPath(value);
    }
  }
  return { block: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const result = evaluate(event ?? {});
  if (result.block) {
    console.error(result.reason);
    process.exit(2);
  }
}

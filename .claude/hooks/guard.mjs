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

// Splits a command into segments of tokens. Unquoted shell operators and
// grouping characters end a token; `;`, `&`, `|`, newlines, parentheses and
// backticks also end the segment. Quote characters are removed.
function parse(command) {
  const segments = [[]];
  let token = '';
  let quote = null;
  const endToken = () => {
    if (token) segments.at(-1).push(token.replace(/^\.\//, ''));
    token = '';
  };
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/[;&|\n()`]/.test(ch)) {
      endToken();
      segments.push([]);
    } else if (/[\s<>]/.test(ch)) {
      endToken();
    } else {
      token += ch;
    }
  }
  endToken();
  return segments;
}

const WRAPPERS = ['sudo', 'env', 'time', 'command', 'nice', 'exec', 'xargs'];
const SHELLS = ['bash', 'sh', 'zsh'];

function isGitPush(command) {
  for (const tokens of parse(command)) {
    let i = 0;
    for (;;) {
      const t = tokens[i];
      if (t === '{' || /^\w+=/.test(t ?? '')) i++;
      else if (WRAPPERS.includes(t)) {
        i++;
        // wrapper flags; `-n` (nice) and `-u` (env) take a value
        while (tokens[i]?.startsWith('-') || /^\w+=/.test(tokens[i] ?? '')) {
          i += tokens[i] === '-n' || tokens[i] === '-u' ? 2 : 1;
        }
      } else break;
    }
    const cmd = tokens[i++];
    if (SHELLS.includes(cmd)) {
      const c = tokens.findIndex((t, j) => j >= i && /^-\w*c$/.test(t));
      if (c >= 0 && tokens[c + 1] && isGitPush(tokens[c + 1])) return true;
    } else if (cmd === 'eval') {
      if (isGitPush(tokens.slice(i).join(' '))) return true;
    } else if (cmd === 'git') {
      while (tokens[i]?.startsWith('-')) {
        i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
      }
      if (tokens[i] === 'push') return true;
    }
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
    for (const token of parse(command).flat()) {
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

import { execFileSync } from 'node:child_process';
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

// Bash expands wildcards itself, so `.env*` must count as a secret too.
const bashHit = (t) =>
  pathHit(t) ||
  segments(t).some((s) => s.startsWith('.env') && /[*?[{]/.test(s));

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
// backticks also end the segment. Quote characters are removed, backslashes
// escape the next character (outside quotes and inside "..."), and `#` starts
// a comment. Heredoc bodies are taken out of the token stream and returned in
// `heredocs` with the index of their segment; `pipes` holds the index of every
// segment piped into the next one. `unclosed` is true when a quote is still
// open at the end, so the caller can fail closed.
function parse(command) {
  const segments = [[]];
  const heredocs = [];
  const pending = [];
  const pipes = new Set();
  let token = '';
  let quote = null;
  const endToken = () => {
    if (token) segments.at(-1).push(token.replace(/^\.\//, ''));
    token = '';
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        token += command[++i];
      } else token += ch;
    } else if (ch === '\\') {
      if (command[i + 1] === '\n') endToken();
      else token += command[i + 1] ?? '';
      i++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && !token) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
    } else if (ch === '<' && /^<<(?!<)/.test(command.slice(i))) {
      const m = /^<<(-?)\s*(['"]?)([\w.-]+)\2/.exec(command.slice(i));
      if (m) {
        pending.push({
          word: m[3],
          strip: m[1] === '-',
          quoted: m[2] !== '',
          seg: segments.length - 1,
        });
        i += m[0].length - 1;
      } else i++;
      endToken();
    } else if (ch === '\n') {
      endToken();
      segments.push([]);
      for (const { word, strip, ...heredoc } of pending.splice(0)) {
        // body lines up to, not including, the delimiter line
        const body = [];
        while (i + 1 < command.length) {
          const end = command.indexOf('\n', i + 1);
          const line = command.slice(i + 1, end < 0 ? command.length : end);
          i = end < 0 ? command.length : end;
          if ((strip ? line.trim() : line) === word) break;
          body.push(line);
        }
        heredocs.push({ ...heredoc, body: body.join('\n') });
      }
    } else if (/[;&|()`]/.test(ch)) {
      endToken();
      const pipe =
        ch === '|' && command[i + 1] !== '|' && command[i - 1] !== '|';
      if (pipe) pipes.add(segments.length - 1);
      segments.push([]);
    } else if (/[\s<>]/.test(ch)) {
      endToken();
    } else {
      token += ch;
    }
  }
  endToken();
  return { segments, heredocs, pipes, unclosed: quote !== null };
}

const WRAPPERS = ['sudo', 'env', 'time', 'command', 'nice', 'exec', 'xargs'];
// Shell keywords and wrappers that precede the real command word.
const KEYWORDS = [
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
];
const SHELLS = ['bash', 'sh', 'zsh'];

// Index of the command word, after grouping, VAR=value and wrapper commands.
function commandIndex(tokens) {
  let i = 0;
  for (;;) {
    const t = tokens[i];
    if (KEYWORDS.includes(t) || t === 'nohup' || /^\w+=/.test(t ?? '')) i++;
    else if (t === 'timeout') {
      i++;
      while (tokens[i]?.startsWith('-')) {
        i += tokens[i] === '-k' || tokens[i] === '-s' ? 2 : 1;
      }
      i++; // the duration
    } else if (WRAPPERS.includes(t)) {
      i++;
      // wrapper flags; `-n` (nice) and `-u` (env) take a value
      while (tokens[i]?.startsWith('-') || /^\w+=/.test(tokens[i] ?? '')) {
        i += tokens[i] === '-n' || tokens[i] === '-u' ? 2 : 1;
      }
    } else return i;
  }
}

// The command string run by `bash -c "..."`, `sh -c`, `zsh -c` or `eval`.
function nestedCommand(tokens, i) {
  if (SHELLS.includes(tokens[i])) {
    const c = tokens.findIndex((t, j) => j > i && /^-\w*c$/.test(t));
    return c >= 0 ? tokens[c + 1] : undefined;
  }
  if (tokens[i] === 'eval') return tokens.slice(i + 1).join(' ');
}

// A heredoc body runs as commands when its pipeline includes a shell, and is
// expanded (so `$(...)` runs) when its delimiter is unquoted.
function heredocRuns({ seg, quoted }, segments, pipes) {
  let start = seg;
  let end = seg;
  while (pipes.has(start - 1)) start--;
  while (pipes.has(end)) end++;
  const pipeline = segments.slice(start, end + 1);
  return !quoted || pipeline.some((t) => SHELLS.includes(t[commandIndex(t)]));
}

// Every command segment that runs, in order: the top-level segments, each
// followed by its `bash -c`/`eval` string's segments, then the segments of
// heredoc bodies that run.
function commands(command) {
  const { segments, heredocs, pipes, unclosed } = parse(command);
  const result = { segments: [], unclosed };
  const add = (text) => {
    const inner = commands(text);
    result.segments.push(...inner.segments);
    result.unclosed ||= inner.unclosed;
  };
  for (const tokens of segments) {
    result.segments.push(tokens);
    const nested = nestedCommand(tokens, commandIndex(tokens));
    if (nested) add(nested);
  }
  for (const heredoc of heredocs) {
    if (heredocRuns(heredoc, segments, pipes)) add(heredoc.body);
  }
  return result;
}

// The arguments after `git` and its global options, or undefined.
function gitArgs(tokens) {
  let i = commandIndex(tokens);
  if (tokens[i++] !== 'git') return;
  while (tokens[i]?.startsWith('-')) {
    i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1;
  }
  return tokens.slice(i);
}

// Fallback for commands we could not tokenize (an unterminated quote).
const rawTokens = (command) =>
  command.split(/[\s;&|()`'"<>=]+/).map((t) => t.replace(/^\.\//, ''));

function isGitPush(command) {
  const { segments, unclosed } = commands(command);
  if (unclosed && /\bgit\b[^\n;&|]*\bpush\b/.test(command)) return true;
  return segments.some((tokens) => gitArgs(tokens)?.[0] === 'push');
}

// Returns the first secret or private token, looking inside nested shells.
function findBlockedToken(command) {
  const { segments, unclosed } = commands(command);
  const raw = unclosed && rawTokens(command).find(bashHit);
  if (raw) return raw;
  for (const tokens of segments) {
    for (const token of tokens) {
      if (bashHit(token) || bashHit(token.slice(token.indexOf('=') + 1))) {
        return token;
      }
    }
  }
}

// Subcommands that add commits to the current branch.
const WRITES = ['commit', 'merge', 'cherry-pick', 'revert', 'rebase', 'am'];
const CREATE = ['-b', '-B', '-c', '-C', '--orphan'];

// The branch `git checkout`/`git switch` moves to, if any.
function switchTarget([sub, ...args]) {
  if ((sub !== 'checkout' && sub !== 'switch') || args.includes('--')) return;
  const create = args.findIndex((a) => CREATE.includes(a));
  if (create >= 0) return args[create + 1];
  return args.find((a) => !a.startsWith('-'));
}

// True when the command commits to `main`, starting from `branch` and
// following any checkout/switch earlier in the same command.
function writesMain(command, branch) {
  let current = branch;
  for (const tokens of commands(command).segments) {
    const args = gitArgs(tokens);
    if (!args) continue;
    current = switchTarget(args) ?? current;
    if (current === 'main' && WRITES.includes(args[0])) return true;
  }
  return false;
}

// `branch` is the current git branch, when known.
export function evaluate({ tool_name, tool_input = {} }, { branch } = {}) {
  if (tool_name === 'Bash') {
    const command = tool_input.command ?? '';
    if (isGitPush(command)) {
      return {
        block: true,
        reason:
          'git push is blocked for Claude in this repo — push it yourself.',
      };
    }
    if (writesMain(command, branch)) {
      return {
        block: true,
        reason:
          'Committing to main is blocked — work on a branch and open a pull request (see CLAUDE.md).',
      };
    }
    const hit = findBlockedToken(command);
    if (hit) return blockPath(hit);
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

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
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
  const cwd = event?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const branch = event?.tool_name === 'Bash' ? currentBranch(cwd) : undefined;
  const result = evaluate(event ?? {}, { branch });
  if (result.block) {
    console.error(result.reason);
    process.exit(2);
  }
}

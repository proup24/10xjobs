import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Formats the edited file with Prettier. Always exits 0: a format failure
// must never fail the edit.
try {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const file = JSON.parse(input)?.tool_input?.file_path;
  if (typeof file === 'string' && existsSync(file)) {
    execFileSync(
      'npx',
      ['prettier', '--write', '--ignore-unknown', '--log-level=silent', file],
      { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), stdio: 'ignore' },
    );
  }
} catch {
  // ignore
}
process.exit(0);

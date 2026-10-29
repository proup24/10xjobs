import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

// Formats the edited file with Prettier. Always exits 0: a format failure
// must never fail the edit. Only files inside the project are touched. The
// project's own Prettier binary is run directly: `npx --no` / `--no-install`
// still fetch from the registry on npm 11, so npx is not used.
try {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  const given = JSON.parse(input)?.tool_input?.file_path;
  const project = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (typeof given === 'string') {
    const file = resolve(project, given);
    const rel = relative(project, file);
    const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    if (inside && existsSync(file)) {
      execFileSync(
        resolve(project, 'node_modules/.bin/prettier'),
        ['--write', '--ignore-unknown', '--log-level=silent', file],
        { cwd: project, stdio: 'ignore' },
      );
    }
  }
} catch {
  // ignore
}
process.exit(0);

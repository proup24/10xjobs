// Decides which CI jobs run, from `nx show projects --affected`.
// Usage: node .github/ci/changes.mjs (--all | --base <sha> --head <sha>) [--check-gaps]
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const DEPENDENCY_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const HOOKS_PREFIX = '.claude/hooks/';

export function isIgnored(file, globs) {
  return globs.some((g) => path.posix.matchesGlob(file, g));
}

export function packageJsonOtherFieldsChanged(before, after) {
  if (before == null || after == null) return true;
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !DEPENDENCY_FIELDS.includes(k)));
  return !isDeepStrictEqual(strip(before), strip(after));
}

export function decide({ all, changedFiles, affected, packageJsonOtherFieldsChanged: pkgOther }) {
  let runAllReason = null;
  if (all) runAllReason = 'run everything was requested (--all)';
  else if (changedFiles.includes('pnpm-workspace.yaml')) runAllReason = 'pnpm-workspace.yaml changed';
  else if (changedFiles.includes('package.json') && pkgOther) runAllReason = 'package.json changed outside its dependency fields';
  else if (changedFiles.includes('pnpm-lock.yaml') && affected.length === 0) runAllReason = 'pnpm-lock.yaml changed and Nx reports no affected project';

  const hooks = changedFiles.some((f) => f.startsWith(HOOKS_PREFIX));
  if (runAllReason) {
    return { jobs: { main: true, database: true, e2e: true, hooks: true, migrate: true, deploy: true }, runAllReason };
  }
  return {
    jobs: {
      main: affected.length > 0,
      database: affected.includes('@xjobs/db-tests'),
      e2e: affected.includes('@xjobs/xjobs-e2e'),
      hooks,
      migrate: affected.includes('@xjobs/database'),
      deploy: affected.includes('@xjobs/xjobs'),
    },
    runAllReason: null,
  };
}

export function findGaps({ addedOrModified, projectRoots, ignoreGlobs, ownsRootFile }) {
  return addedOrModified.filter((f) => {
    if (projectRoots.some((r) => f.startsWith(r + '/'))) return false;
    if (DEPENDENCY_FILES.includes(f)) return false;
    if (f.startsWith(HOOKS_PREFIX)) return false;
    if (isIgnored(f, ignoreGlobs)) return false;
    return !ownsRootFile(f);
  });
}

// ---- CLI ----

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, NX_DAEMON: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    process.stderr.write(`${cmd} failed: ${e.stderr || e.message}\n`);
    process.exit(e.status || 1);
  }
}

const nul = (s) => s.split('\0').filter(Boolean);

function readPackageJson(rev) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${rev}:package.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const checkGaps = argv.includes('--check-gaps');
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const base = arg('--base');
  const head = arg('--head');
  if (!all && !(base && head)) {
    process.stderr.write('usage: changes.mjs (--all | --base <sha> --head <sha>) [--check-gaps]\n');
    process.exit(2);
  }

  let changedFiles = [];
  let addedOrModified = [];
  let affected = [];
  let pkgOther = false;
  if (!all || checkGaps) {
    if (base && head) {
      changedFiles = nul(run('git', ['diff', '--name-only', '--no-renames', '-z', base, head]));
      addedOrModified = nul(run('git', ['diff', '--name-only', '-z', '--diff-filter=d', base, head]));
    }
  }
  if (base && head) {
    affected = JSON.parse(run('npx', ['nx', 'show', 'projects', '--affected', `--base=${base}`, `--head=${head}`, '--json']));
    if (changedFiles.includes('package.json')) pkgOther = packageJsonOtherFieldsChanged(readPackageJson(base), readPackageJson(head));
  }

  const { jobs, runAllReason } = decide({ all, changedFiles, affected, packageJsonOtherFieldsChanged: pkgOther });

  let gaps = [];
  if (checkGaps && base && head) {
    const graphFile = path.join(tmpdir(), `nx-graph-${process.pid}.json`);
    run('npx', ['nx', 'graph', `--file=${graphFile}`]);
    const graph = JSON.parse(readFileSync(graphFile, 'utf8')).graph;
    const projectRoots = Object.values(graph.nodes).map((n) => n.data.root);
    const ignoreGlobs = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'runs-nothing.json'), 'utf8'));
    const ownsRootFile = (f) => JSON.parse(run('npx', ['nx', 'show', 'projects', '--affected', `--files=${f}`, '--json'])).length > 0;
    gaps = findGaps({ addedOrModified, projectRoots, ignoreGlobs, ownsRootFile });
    for (const f of gaps) {
      console.log(`::error file=${f}::${f} is not covered: add it to a project's namedInputs in its package.json, or to .github/ci/runs-nothing.json`);
    }
  }

  const lines = [...Object.entries(jobs).map(([k, v]) => `${k}=${v}`), `all=${all || runAllReason !== null}`, `base=${base ?? ''}`, `head=${head ?? ''}`];
  const out = lines.join('\n') + '\n';
  process.stdout.write(out);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '### Change detection',
        `- Changed files: ${changedFiles.length}`,
        `- Affected projects: ${affected.length ? affected.join(', ') : 'none'}`,
        `- Run-all reason: ${runAllReason ?? 'none'}`,
        `- Gaps: ${gaps.length ? gaps.join(', ') : 'none'}`,
        '',
      ].join('\n'),
    );
  }
  if (gaps.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

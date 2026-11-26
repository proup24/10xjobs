// Finds the commit a workflow last handled, from the run names of successful runs on main.
// Usage: node .github/ci/last-handled.mjs --workflow <file.yml> --job <name>
// Prints the SHA, or nothing. Always exits 0; on an API error it warns on stderr.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function extractSha(title) {
  const matches = String(title).match(/(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/g);
  return matches && matches.length === 1 ? matches[0] : null;
}

export function pickLastHandled(runs, jobConclusion) {
  for (const run of runs) {
    if (jobConclusion(run.id) === 'success')
      return extractSha(run.display_title);
  }
  return null;
}

function gh(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || !argv[i + 1]) throw new Error(`missing ${name}`);
  return argv[i + 1];
}

function main(argv) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const workflow = arg(argv, '--workflow');
  const job = arg(argv, '--job');
  const { workflow_runs: runs } = gh(
    `repos/${repo}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=30`,
  );
  const conclusion = (id) =>
    gh(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`).jobs.find(
      (j) => j.name === job,
    )?.conclusion ?? null;
  return pickLastHandled(runs, conclusion);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const sha = main(process.argv.slice(2));
    if (sha) process.stdout.write(`${sha}\n`);
  } catch (e) {
    console.error(
      `::warning::last-handled lookup failed: ${String(e.message ?? e).split('\n')[0]}`,
    );
  }
  process.exit(0);
}

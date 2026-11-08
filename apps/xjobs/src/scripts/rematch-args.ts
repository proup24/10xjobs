/** Argument parsing for `db:rematch`, kept apart so specs can import it. */
export type RematchSelector = { all: true } | { jobIds: string[] };

export const REMATCH_USAGE =
  'usage: db:rematch -- --all | --job <id> [--job <id> ...]';

export function parseRematchArgs(rawArgv: readonly string[]): RematchSelector {
  const argv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
  let all = false;
  const jobIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') all = true;
    else if (arg === '--job') {
      const id = argv[++i];
      if (id === undefined || id.startsWith('--'))
        throw new Error('--job needs an id');
      jobIds.push(id);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (all && jobIds.length > 0)
    throw new Error('--all and --job cannot be combined');
  if (all) return { all };
  if (jobIds.length === 0) throw new Error('pass --all or at least one --job');
  return { jobIds };
}

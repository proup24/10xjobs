/** Argument parsing for `db:indeed-sample`, kept apart so specs can import it. */
export interface SampleArgs {
  /** Empty with `--from`, which reads the profile's values from `plan.json`. */
  profile: string;
  dryRun: boolean;
  from?: string;
}

export const SAMPLE_USAGE =
  'usage: db:indeed-sample -- --profile <id> [--dry-run | --from <folder>]';

function value(flag: string, next: string | undefined): string {
  if (next === undefined || next === '' || next.startsWith('--'))
    throw new Error(`${flag} needs a value`);
  return next;
}

export function parseSampleArgs(rawArgv: readonly string[]): SampleArgs {
  // pnpm forwards a literal `--` separator.
  const argv = rawArgv.filter((arg) => arg !== '--');
  let profile: string | undefined;
  let from: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile') profile = value('--profile', argv[++i]);
    else if (arg === '--from') from = value('--from', argv[++i]);
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (dryRun && from !== undefined)
    throw new Error('--dry-run and --from cannot be used together');
  if (from !== undefined) return { profile: profile ?? '', dryRun, from };
  if (profile === undefined) throw new Error('--profile <id> is required');
  return { profile, dryRun };
}

/** Argument parsing for `db:post-sample`, kept apart so specs can import it. */
export type PostSampleArgs = {
  size: number;
  days: number | undefined;
  out: string;
};

export const POST_SAMPLE_USAGE =
  'usage: db:post-sample -- --size <n> [--days <n>] --out <path>';

function positiveInt(flag: string, value: string | undefined): number {
  const n = value === undefined || value === '' ? NaN : Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${flag} needs a positive whole number`);
  return n;
}

export function parsePostSampleArgs(
  rawArgv: readonly string[],
): PostSampleArgs {
  const argv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
  let size: number | undefined;
  let days: number | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--size') size = positiveInt('--size', argv[++i]);
    else if (arg === '--days') days = positiveInt('--days', argv[++i]);
    else if (arg === '--out') {
      const path = argv[++i];
      if (path === undefined || path === '' || path.startsWith('--'))
        throw new Error('--out needs a path');
      out = path;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (size === undefined) throw new Error('--size <n> is required');
  if (out === undefined) throw new Error('--out <path> is required');
  return { size, days, out };
}

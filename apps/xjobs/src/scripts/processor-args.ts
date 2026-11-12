import type { ReprocessFilter } from 'src/modules/processor/repositories/processor.repository';
import { LIST_NAMES, type ListName } from 'src/modules/processor/vocab/lists';

/** Argument parsing for `db:reprocess` and `db:vocab`, kept apart so specs can import it. */
/** pnpm forwards the `--` of `pnpm run x -- args`; drop one. */
const withoutLeadingSeparator = (argv: readonly string[]) =>
  argv[0] === '--' ? argv.slice(1) : argv;

export function parseReprocessArgs(
  rawArgv: readonly string[],
): ReprocessFilter {
  const argv = withoutLeadingSeparator(rawArgv);
  const filter: ReprocessFilter = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all-in-scope') filter.allInScope = true;
    else if (arg === '--null-status') filter.nullStatus = true;
    else if (arg === '--failed') filter.failed = true;
    else if (arg === '--job') {
      const id = argv[++i];
      if (id === undefined || id.startsWith('--'))
        throw new Error('--job needs an id');
      (filter.jobIds ??= []).push(id);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (
    !filter.allInScope &&
    !filter.nullStatus &&
    !filter.failed &&
    !filter.jobIds
  )
    throw new Error(
      'pass at least one of --all-in-scope, --null-status, --failed, --job',
    );
  return filter;
}

export type VocabCommand =
  | { list: ListName | 'cities'; action: 'list' }
  | { list: ListName | 'cities'; action: 'approve' | 'reject'; code: string }
  | { list: 'cities'; action: 'alias'; code: string; spelling: string }
  | { list: ListName; action: 'alias'; code: string; to: string };

export function parseVocabArgs(rawArgv: readonly string[]): VocabCommand {
  const [list, action, code, ...rest] = withoutLeadingSeparator(rawArgv);
  if (list !== 'cities' && !LIST_NAMES.includes(list as ListName))
    throw new Error(
      `unknown list: ${list ?? '(none)'}; use one of ${[...LIST_NAMES, 'cities'].join(', ')}`,
    );
  const named = list as ListName | 'cities';
  if (action === 'list') {
    if (code !== undefined) throw new Error(`unexpected argument: ${code}`);
    return { list: named, action };
  }
  if (action === 'approve' || action === 'reject' || action === 'alias') {
    if (code === undefined || code.startsWith('--'))
      throw new Error(
        `${action} needs a ${named === 'cities' ? 'city id' : 'code'}`,
      );
    if (action !== 'alias') {
      if (rest.length > 0) throw new Error(`unexpected argument: ${rest[0]}`);
      return { list: named, action, code };
    }
    if (named === 'cities') {
      if (rest[0] !== '--as' || !rest[1]?.trim())
        throw new Error('alias needs --as "<spelling>"');
      if (rest.length > 2) throw new Error(`unexpected argument: ${rest[2]}`);
      return { list: 'cities', action, code, spelling: rest[1] };
    }
    if (rest[0] !== '--to' || rest[1] === undefined)
      throw new Error('alias needs --to <approved code>');
    if (rest.length > 2) throw new Error(`unexpected argument: ${rest[2]}`);
    return { list: named as ListName, action, code, to: rest[1] };
  }
  throw new Error(
    `unknown action: ${action ?? '(none)'}; use list, approve, reject or alias`,
  );
}

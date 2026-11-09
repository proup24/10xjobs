import type { ZodError } from 'zod';
import { errorCode } from '@/lib/resume/errors';

export type Deps = { log?: (line: string) => void };

export type SaveResult =
  | { status: 'saved' }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'failed' };

export const SAVED: SaveResult = { status: 'saved' };
export const FAILED: SaveResult = { status: 'failed' };

/** The first message per field path ("links.0.value"); a top-level issue goes under `_form`. */
export function fieldErrors(error: ZodError): SaveResult {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    errors[key] ??= issue.message;
  }
  return { status: 'invalid', errors };
}

/**
 * Codes the database raises for a value it refuses: integrity (23*: check, not null,
 * foreign key), data exceptions (22*: e.g. 22023, 22P02) and the triggers' RAISE (P0001).
 */
function isRefusal(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (code.startsWith('22') || code.startsWith('23') || code === 'P0001')
  );
}

/** Logs the code, then `invalid` with the database message when it refused a value, else `failed`. */
export function failure(
  log: (line: string) => void,
  what: string,
  error: unknown,
  prefix = 'setup save',
): SaveResult {
  log(`${prefix}: ${what} code=${errorCode(error)}`);
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e && isRefusal(e.code) && typeof e.message === 'string') {
    return { status: 'invalid', errors: { _form: e.message } };
  }
  return FAILED;
}

export const logger = (deps: Deps) =>
  deps.log ?? ((line: string) => console.error(line));

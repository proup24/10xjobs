/**
 * An error as its code, SQL state or class name, never its message: a message
 * may quote profile content, so it must not reach the logs.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code, sqlState } = error as { code?: unknown; sqlState?: unknown };
    if (typeof code === 'string') return code;
    if (typeof sqlState === 'string') return sqlState;
    return error.constructor.name;
  }
  return typeof error;
}

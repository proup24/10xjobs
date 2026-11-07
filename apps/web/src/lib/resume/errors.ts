export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; statusCode?: unknown; name?: unknown };
    for (const v of [e.code, e.statusCode, e.name]) {
      if (typeof v === 'string' && v) return v;
    }
  }
  return 'unknown_error';
}

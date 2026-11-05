const NULL_CHARACTER = String.fromCharCode(0);

/**
 * The payload with every `\u0000` removed from strings and keys: PostgreSQL
 * `jsonb` cannot store it, and some LinkedIn posts contain it. The stored
 * batch file keeps the untouched original, and the content hash is computed
 * from that original.
 */
export function postgresSafe(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll(NULL_CHARACTER, '');
  if (Array.isArray(value)) return value.map(postgresSafe);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key.replaceAll(NULL_CHARACTER, ''),
        postgresSafe(item),
      ]),
    );
  return value;
}

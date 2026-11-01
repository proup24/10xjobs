import { createHash } from 'node:crypto';
import type { Channel } from 'src/common/enums';
import { channelIngestConfig } from '../config/channels';

/** JSON with object keys sorted at every depth, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A copy of `value` without the dotted `path` (`author.info`); other values are shared. */
function without(value: unknown, path: string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const [head, ...rest] = path;
  const object = value as Record<string, unknown>;
  if (!head || !(head in object)) return value;
  const copy = { ...object };
  if (rest.length === 0) delete copy[head];
  else copy[head] = without(copy[head], rest);
  return copy;
}

/**
 * SHA-256 hex of the payload's canonical JSON without the channel's volatile
 * fields (dotted paths): the same content observed twice hashes the same.
 */
export function contentHash(channel: Channel, payload: unknown): string {
  const content = channelIngestConfig[channel].volatileKeys.reduce<unknown>(
    (current, key) => without(current, key.split('.')),
    payload,
  );
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

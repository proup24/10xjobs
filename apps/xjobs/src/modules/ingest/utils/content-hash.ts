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

/**
 * SHA-256 hex of the payload's canonical JSON without the channel's volatile
 * top-level keys: the same content observed twice hashes the same.
 */
export function contentHash(channel: Channel, payload: unknown): string {
  let content = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const volatile = new Set(channelIngestConfig[channel].volatileKeys);
    content = Object.fromEntries(
      Object.entries(payload as Record<string, unknown>).filter(
        ([key]) => !volatile.has(key),
      ),
    );
  }
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

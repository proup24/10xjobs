import { convert } from 'html-to-text';
import type { CollectedJob } from '../types/collector';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Trimmed string, or null when the value is not a non-blank string or number. */
export function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Converts source markup to plain text. Plain text passes through unchanged.
 * `entityEncoded` decodes an extra entity layer first (Greenhouse wraps its HTML this way).
 */
export function plainText(body: string, entityEncoded = false): string {
  let value = body;
  if (entityEncoded && /&lt;\/?[a-z][\s\S]*?&gt;/i.test(value)) {
    value = convert(value, { wordwrap: false });
  }
  return /<\/?[a-z][^>]*>/i.test(value)
    ? convert(value, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      }).trim()
    : value.trim();
}

/** A contact needs both a name and a profile URL; anything less is no contact. */
export function contact(name: unknown, url: unknown): CollectedJob['contact'] {
  const contactName = text(name);
  const contactUrl = text(url);
  return contactName && contactUrl
    ? { name: contactName, url: contactUrl }
    : null;
}

/** Date-only values carry day precision; timestamps carry hour precision. */
export function precisionOf(postedAt: string | null): 'hour' | 'day' {
  return postedAt?.includes('T') ? 'hour' : 'day';
}

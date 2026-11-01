import { convert } from 'html-to-text';

/** A trimmed, non-blank string; blanks and the `undefined`/`null` sentinels are null. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
  return trimmed;
}

/** A finite number, or null. */
export function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Plain text of HTML, with fixed options so the output never varies. */
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

/** `YYYY-MM-DD` (UTC) of an ISO date or datetime; null for anything else. */
export function datePart(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** An object field, or an empty object. */
export function objectAt(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const namedEntities: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Decodes HTML entities in one left-to-right pass, so `&amp;lt;` becomes
 * `&lt;`, never `<`. Unknown entities are left as they are.
 */
export function decodeEntitiesOnce(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        // Unpaired surrogates are not text: PostgreSQL rejects them in jsonb.
        const surrogate = code >= 0xd800 && code <= 0xdfff;
        return Number.isFinite(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          !surrogate
          ? String.fromCodePoint(code)
          : match;
      }
      return namedEntities[body.toLowerCase()] ?? match;
    },
  );
}

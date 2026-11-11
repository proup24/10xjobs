const UNIT_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
} as const;

const AGO = /^(?:reposted\s+)?(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i;
const NOW = /^(?:just now|moments ago)$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = UNIT_MS.day;

/**
 * Estimates when a job was posted from LinkedIn's relative text ("8 hours
 * ago") and the scrape time. The estimate is clamped into the published day
 * when one is given and on or before the scrape day, and never lands after the
 * scrape. Null when the text is not a recognised relative phrase.
 */
export function postedAtFromAgo(
  ago: unknown,
  scrapedAt: Date,
  publishedDate: string | null,
): string | null {
  if (typeof ago !== 'string') return null;
  const text = ago.trim();
  let offset: number;
  if (NOW.test(text)) {
    offset = 0;
  } else {
    const match = AGO.exec(text);
    if (!match) return null;
    offset =
      Number(match[1]) *
      UNIT_MS[match[2].toLowerCase() as keyof typeof UNIT_MS];
  }
  const scraped = scrapedAt.getTime();
  let estimate = scraped - offset;
  let hi = scraped;
  if (publishedDate && DATE_ONLY.test(publishedDate)) {
    const start = Date.parse(`${publishedDate}T00:00:00.000Z`);
    if (!Number.isNaN(start) && start <= scraped) {
      hi = Math.min(start + DAY_MS - 1, scraped);
      estimate = Math.max(estimate, start);
    }
  }
  return new Date(Math.min(estimate, hi)).toISOString();
}

/**
 * An exact source timestamp as an ISO string. Date-only and unparseable
 * values are null; exact times are not clamped.
 */
export function exactPostedAt(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('T')) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

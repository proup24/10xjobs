import { type NormalizedRecord } from './record';
import { cleanNumber, cleanText } from './text';

/*
 * Field helpers shared by the LinkedIn mappers. A LinkedIn job board item is
 * mapped by its actor's mapper in `mappers/`; posts are stored raw.
 */

/** The largest salary bound the job columns hold (PostgreSQL `integer`). */
const MAX_SALARY = 2_147_483_647;

/** A salary bound that can be stored; anything larger is not kept. */
export function salaryBound(value: unknown): number | null {
  const n = cleanNumber(value);
  return n !== null && Math.abs(n) <= MAX_SALARY ? n : null;
}

/** A parsed http(s) URL, or null. */
export function httpUrl(value: unknown): URL | null {
  const raw = cleanText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function isLinkedinHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

/** The URL without LinkedIn's `trk*` tracking parameters. */
export function withoutTrk(url: URL | null): string | null {
  if (!url) return null;
  for (const key of [...url.searchParams.keys()])
    if (/^trk/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

/**
 * `https://www.linkedin.com/jobs/view/<id>` from the item's id, else the id in
 * its (regional, slugged) job URL.
 */
export function linkedinJobUrl(id: unknown, jobUrl: unknown): string | null {
  const found =
    cleanText(id) ??
    (cleanText(jobUrl) ?? '').match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/)?.[1];
  return found ? `https://www.linkedin.com/jobs/view/${found}` : null;
}

/**
 * An external job's apply URL, unchanged; null for Easy Apply and for a link
 * back to LinkedIn, which names no employer page.
 */
export function externalApplyUrl(
  applyType: unknown,
  applyUrl: unknown,
): string | null {
  const url = applyType === 'EXTERNAL' ? httpUrl(applyUrl) : null;
  return url && !isLinkedinHost(url) ? cleanText(applyUrl) : null;
}

/** An http(s) URL off LinkedIn, unchanged; null for anything else. */
export function outsideUrl(value: unknown): string | null {
  const url = httpUrl(value);
  return url && !isLinkedinHost(url) ? cleanText(value) : null;
}

/** The person LinkedIn shows on a job, or null when it shows none. */
export function jobPoster(
  name: unknown,
  profileUrl: unknown,
): NormalizedRecord['poster'] {
  const posterName = cleanText(name);
  const posterUrl = httpUrl(profileUrl)?.toString() ?? null;
  return posterName || posterUrl
    ? { name: posterName, profileUrl: posterUrl, type: 'person' }
    : null;
}

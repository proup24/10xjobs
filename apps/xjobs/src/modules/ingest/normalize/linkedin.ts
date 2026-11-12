import type { NormalizeContext } from './normalize';
import { exactPostedAt, postedAtFromAgo } from './posted-at';
import { emptyRecord, type NormalizedRecord } from './record';
import { cleanNumber, cleanText, datePart, objectAt } from './text';

/*
 * Field helpers shared by the LinkedIn mappers. A LinkedIn job board item is
 * mapped by its actor's mapper in `mappers/`; posts are mapped here.
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

/** `"2 hours ago • Visible to anyone on or off LinkedIn"` → `"2 hours ago"`. */
function agoPart(value: unknown): string | null {
  return cleanText(value)?.split('•')[0]?.trim() ?? null;
}

/**
 * A post is not a job: it may hold none (an #OpenToWork post) or several (a
 * digest), so only the body and the author are kept. The author is never the
 * employer; Process extracts jobs from the body.
 */
export function mapLinkedinPost(
  p: Record<string, unknown>,
  ctx: NormalizeContext,
): NormalizedRecord {
  const posted = objectAt(p.postedAt);
  const publishedAt = datePart(posted.date);
  const author = objectAt(p.author);
  const name = cleanText(author.name);
  const profileUrl = httpUrl(author.linkedinUrl)?.toString() ?? null;
  return emptyRecord({
    kind: 'post',
    publishedAt,
    postedAt:
      exactPostedAt(posted.date) ??
      postedAtFromAgo(
        agoPart(posted.postedAgoText),
        ctx.scrapedAt,
        publishedAt,
      ),
    descriptionText: cleanText(p.content),
    postingUrl: cleanText(p.linkedinUrl) as string,
    poster:
      name || profileUrl
        ? {
            name,
            profileUrl,
            type: author.type === 'company' ? 'company' : 'person',
          }
        : null,
  });
}

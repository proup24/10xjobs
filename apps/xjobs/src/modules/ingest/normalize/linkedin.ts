import { emptyRecord, type NormalizedRecord } from './record';
import {
  cleanNumber,
  cleanText,
  datePart,
  htmlToPlainText,
  objectAt,
} from './text';

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
function withoutTrk(url: URL | null): string | null {
  if (!url) return null;
  for (const key of [...url.searchParams.keys()])
    if (/^trk/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

/** `https://www.linkedin.com/jobs/view/<id>` from the item id or its job URL. */
function linkedinJobUrl(p: Record<string, unknown>): string | null {
  const id =
    cleanText(p.id) ??
    cleanText(p.jobId) ??
    (cleanText(p.jobUrl) ?? '').match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/)?.[1];
  return id ? `https://www.linkedin.com/jobs/view/${id}` : null;
}

export function mapLinkedinJob(p: Record<string, unknown>): NormalizedRecord {
  const descriptionHtml = cleanText(p.descriptionHtml);
  const salaryText = cleanText(p.salary);
  const salaryMin = cleanNumber(p.salaryMin);
  const salaryMax = cleanNumber(p.salaryMax);
  const apply = p.applyType === 'EXTERNAL' ? httpUrl(p.applyUrl) : null;
  const posterName = cleanText(p.posterFullName);
  const posterUrl = httpUrl(p.posterProfileUrl)?.toString() ?? null;
  return emptyRecord({
    kind: 'job',
    title: cleanText(p.title),
    companyName: cleanText(p.companyName),
    companyUrl: withoutTrk(httpUrl(p.companyUrl)),
    location: cleanText(p.location),
    contractType: cleanText(p.contractType),
    experienceLevel: cleanText(p.experienceLevel),
    sector: cleanText(p.sector),
    salary:
      salaryText || salaryMin !== null || salaryMax !== null
        ? {
            text: salaryText,
            min: salaryMin,
            max: salaryMax,
            currency: cleanText(p.salaryCurrency),
            period: cleanText(p.salaryPeriod),
          }
        : null,
    publishedAt: datePart(p.publishedAt),
    descriptionHtml,
    descriptionText:
      cleanText(p.description) ??
      (descriptionHtml ? cleanText(htmlToPlainText(descriptionHtml)) : null),
    applyUrl: apply && !isLinkedinHost(apply) ? cleanText(p.applyUrl) : null,
    postingUrl: linkedinJobUrl(p) as string,
    poster:
      posterName || posterUrl
        ? { name: posterName, profileUrl: posterUrl, type: 'person' }
        : null,
  });
}

/**
 * A post is not a job: it may hold none (an #OpenToWork post) or several (a
 * digest), so only the body and the author are kept. The author is never the
 * employer; Process extracts jobs from the body.
 */
export function mapLinkedinPost(p: Record<string, unknown>): NormalizedRecord {
  const author = objectAt(p.author);
  const name = cleanText(author.name);
  const profileUrl = httpUrl(author.linkedinUrl)?.toString() ?? null;
  return emptyRecord({
    kind: 'post',
    publishedAt: datePart(objectAt(p.postedAt).date),
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

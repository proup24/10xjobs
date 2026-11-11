import { postedAtFromAgo } from '../posted-at';
import type { NormalizeContext } from '../normalize';
import { emptyRecord, type NormalizedRecord } from '../record';
import { cleanText, datePart } from '../text';
import {
  externalApplyUrl,
  httpUrl,
  jobPoster,
  linkedinJobUrl,
  withoutTrk,
} from '../linkedin';

/**
 * One `cheap_scraper/linkedin-job-scraper` dataset item, the fields we read
 * (the actor's README, "Output Fields"). Raw payloads are untrusted, so every
 * field is read through the `clean*` helpers.
 */
export interface CheapScraperJobItem {
  jobId: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  location: string | null;
  /** Bounds as formatted strings, e.g. `["$69100.00", "$129200.00"]`. */
  salaryInfo: string[];
  /** Relative, e.g. `"6 hours ago"`; volatile. */
  postedTime: string | null;
  /** ISO date-time at midnight, e.g. `"2026-06-14T00:00:00.000Z"`. */
  publishedAt: string | null;
  /** `"<keyword> - <location>"`: the search that found it; volatile. */
  searchString: string | null;
  companyName: string | null;
  /** The company's LinkedIn page, with `trk` parameters. */
  companyUrl: string | null;
  /** Plain text, sometimes ending in `Show more Show less`. */
  jobDescription: string | null;
  contractType: string | null;
  experienceLevel: string | null;
  sector: string | null;
  /** For external jobs too, this is the LinkedIn job page, not the employer's. */
  applyUrl: string | null;
  applyType: 'EASY_APPLY' | 'EXTERNAL' | null;
  /** Empty string when LinkedIn shows nobody. */
  posterFullName: string | null;
  posterProfileUrl: string | null;
}

/** The page's collapsed toggle text left at the end of some descriptions. */
const SHOW_MORE = /\s*Show more Show less\s*$/;

/** Whether a payload has cheap_scraper's field names. */
export function isCheapScraperJob(p: Record<string, unknown>): boolean {
  return 'jobTitle' in p || 'jobDescription' in p || 'searchString' in p;
}

/**
 * `salaryInfo` joined as the stated text. No bounds or currency are read from
 * it: a `$` does not say which dollar.
 */
function salaryText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value.map(cleanText).filter((part) => part !== null);
  return parts.length ? parts.join(' - ') : null;
}

export function mapCheapScraperJob(
  payload: Record<string, unknown>,
  ctx: NormalizeContext,
): NormalizedRecord {
  const p = payload as Partial<Record<keyof CheapScraperJobItem, unknown>>;
  const salary = salaryText(p.salaryInfo);
  return emptyRecord({
    kind: 'job',
    title: cleanText(p.jobTitle),
    companyName: cleanText(p.companyName),
    companyUrl: withoutTrk(httpUrl(p.companyUrl)),
    location: cleanText(p.location),
    contractType: cleanText(p.contractType),
    experienceLevel: cleanText(p.experienceLevel),
    sector: cleanText(p.sector),
    salary: salary
      ? { text: salary, min: null, max: null, currency: null, period: null }
      : null,
    publishedAt: datePart(p.publishedAt),
    postedAt: postedAtFromAgo(
      p.postedTime,
      ctx.scrapedAt,
      datePart(p.publishedAt),
    ),
    descriptionText: cleanText(
      (cleanText(p.jobDescription) ?? '').replace(SHOW_MORE, ''),
    ),
    applyUrl: externalApplyUrl(p.applyType, p.applyUrl),
    postingUrl: linkedinJobUrl(p.jobId, p.jobUrl) as string,
    poster: jobPoster(p.posterFullName, p.posterProfileUrl),
  });
}

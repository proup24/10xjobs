import { emptyRecord, type NormalizedRecord } from '../record';
import { cleanText, datePart, htmlToPlainText } from '../text';
import {
  externalApplyUrl,
  httpUrl,
  jobPoster,
  linkedinJobUrl,
  salaryBound,
  withoutTrk,
} from '../linkedin';

/**
 * One `bebity/linkedin-jobs-scraper` dataset item, the fields we read. The
 * actor is no longer collected from (it stopped returning jobs on
 * 2026-11-03); this mapper stays because raw storage holds its items and
 * `db:renormalize` reads them again.
 */
export interface BebityJobItem {
  id: string | null;
  title: string | null;
  jobUrl: string | null;
  companyName: string | null;
  companyUrl: string | null;
  location: string | null;
  /** `YYYY-MM-DD`. */
  publishedAt: string | null;
  description: string | null;
  descriptionHtml: string | null;
  contractType: string | null;
  experienceLevel: string | null;
  sector: string | null;
  /** Stated text, e.g. `"£50,000.00/yr - £80,000.00/yr"`. */
  salary: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** The employer's link for external jobs. */
  applyUrl: string | null;
  applyType: 'EASY_APPLY' | 'EXTERNAL' | null;
  posterFullName: string | null;
  posterProfileUrl: string | null;
  /** The start URL and position that found it; volatile. */
  scrapingInfo: { inputUrl: string; index: number; page: number } | null;
}

/** Whether a payload has bebity's field names. */
export function isBebityJob(p: Record<string, unknown>): boolean {
  return (
    'title' in p ||
    'description' in p ||
    'descriptionHtml' in p ||
    'scrapingInfo' in p
  );
}

export function mapBebityJob(
  payload: Record<string, unknown>,
): NormalizedRecord {
  const p = payload as Partial<Record<keyof BebityJobItem, unknown>>;
  const descriptionHtml = cleanText(p.descriptionHtml);
  const salaryText = cleanText(p.salary);
  const salaryMin = salaryBound(p.salaryMin);
  const salaryMax = salaryBound(p.salaryMax);
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
    applyUrl: externalApplyUrl(p.applyType, p.applyUrl),
    postingUrl: linkedinJobUrl(
      cleanText(p.id) ?? payload.jobId,
      p.jobUrl,
    ) as string,
    poster: jobPoster(p.posterFullName, p.posterProfileUrl),
  });
}

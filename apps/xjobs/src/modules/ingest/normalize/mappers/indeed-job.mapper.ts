import type { NormalizeContext } from '../normalize';
import { httpUrl } from '../linkedin';
import { emptyRecord, type NormalizedRecord } from '../record';
import {
  cleanNumber,
  cleanText,
  datePart,
  htmlToPlainText,
  objectAt,
} from '../text';

/** Employer tag codes in `employerAttributes`. */
const REMOTE_TAG = 'DSQF7';
const HYBRID_TAG = 'PAXZC';

const SALARY_PERIODS: Record<string, string> = {
  YEAR: 'YEARLY',
  MONTH: 'MONTHLY',
  DAY: 'DAILY',
  HOUR: 'HOURLY',
};

/** True for `indeed.com` and any `*.indeed.com` host. */
export function isIndeedHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'indeed.com' || host.endsWith('.indeed.com');
}

/** An ISO datetime for a valid date string, else null. */
function isoDate(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** What the employer set: remote beats hybrid; no tag is unknown, never on-site. */
function workplaceType(
  employerAttributes: unknown,
): 'remote' | 'hybrid' | null {
  const tags = objectAt(employerAttributes);
  if (REMOTE_TAG in tags) return 'remote';
  if (HYBRID_TAG in tags) return 'hybrid';
  return null;
}

/** The first of valig's `jobTypes` (an object of code to label). */
function firstJobType(jobTypes: unknown): string | null {
  const values = Array.isArray(jobTypes)
    ? jobTypes
    : Object.values(objectAt(jobTypes));
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function salaryOf(baseSalary: unknown): NormalizedRecord['salary'] {
  const pay = objectAt(baseSalary);
  const min = cleanNumber(pay.min);
  const max = cleanNumber(pay.max);
  if (min === null && max === null) return null;
  const unit = cleanText(pay.unitOfWork);
  return {
    text: null,
    min,
    max,
    currency: cleanText(pay.currencyCode),
    period: unit ? (SALARY_PERIODS[unit] ?? unit) : null,
    providedByEmployer: true,
  };
}

/** One `valig/indeed-scraper` dataset item to the unified record. */
export function mapIndeedJob(
  payload: Record<string, unknown>,
  _ctx: NormalizeContext,
): NormalizedRecord {
  const place = objectAt(payload.location);
  const employer = objectAt(payload.employer);
  const description = objectAt(payload.description);
  const rawCity = cleanText(place.city);
  const state = cleanText(place.admin1Code);
  const parts = [rawCity, state, cleanText(place.countryName)].filter(
    (part): part is string => part !== null,
  );
  const countryCode = cleanText(place.countryCode)?.toUpperCase() ?? null;
  const descriptionHtml = cleanText(description.html);
  const jobUrl = httpUrl(payload.jobUrl);
  const key = cleanText(payload.key);
  const posting = httpUrl(payload.url);
  if (posting) posting.protocol = 'https:';
  const postedAt =
    isoDate(payload.datePublished) ?? isoDate(payload.dateOnIndeed);
  return emptyRecord({
    kind: 'job',
    title: cleanText(payload.title),
    companyName: cleanText(employer.name),
    companyUrl: httpUrl(employer.companyPageUrl)?.href ?? null,
    location: parts.length ? parts.join(', ') : null,
    countryCode:
      countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    city: rawCity && !/^remote$/i.test(rawCity) ? rawCity : null,
    state,
    workplaceType: workplaceType(payload.employerAttributes),
    salary: salaryOf(payload.baseSalary),
    publishedAt: datePart(postedAt),
    postedAt,
    expiresAt: isoDate(payload.expirationDate),
    contractType: firstJobType(payload.jobTypes),
    descriptionHtml,
    descriptionText:
      cleanText(description.text) ??
      (descriptionHtml ? cleanText(htmlToPlainText(descriptionHtml)) : null),
    applyUrl: jobUrl && !isIndeedHost(jobUrl) ? jobUrl.href : null,
    postingUrl: (posting?.href ??
      `https://www.indeed.com/viewjob?jk=${key}`) as string,
  });
}

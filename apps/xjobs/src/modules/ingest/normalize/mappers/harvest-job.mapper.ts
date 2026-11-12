import type { NormalizeContext } from '../normalize';
import {
  emptyRecord,
  type NormalizedCompany,
  type NormalizedRecord,
} from '../record';
import {
  httpUrl,
  jobPoster,
  linkedinJobUrl,
  outsideUrl,
  salaryBound,
  withoutTrk,
} from '../linkedin';
import {
  cleanNumber,
  cleanText,
  datePart,
  htmlToPlainText,
  objectAt,
} from '../text';

/** Whether a payload has the `harvestapi/linkedin-job-search` field names. */
export function isHarvestJob(p: Record<string, unknown>): boolean {
  return 'applyMethod' in p && 'jobState' in p;
}

const workplaceTypes: Record<string, NormalizedRecord['workplaceType']> = {
  remote: 'remote',
  hybrid: 'hybrid',
  on_site: 'onsite',
};

/** `full_time` → `Full-time`, `part_time` → `Part-time`, `contract` → `Contract`. */
function contractText(employmentType: string | null): string | null {
  if (!employmentType) return null;
  const words = employmentType.replace(/_/g, ' ').toLowerCase();
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  return title.replace(/^(Full|Part) /, '$1-');
}

function count(value: unknown): number | null {
  const n = cleanNumber(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function isoDatetime(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((v) => {
        const t = cleanText(v);
        return t ? [t] : [];
      })
    : [];
}

function mapCompany(value: unknown): NormalizedCompany | null {
  const c = objectAt(value);
  const linkedinId = cleanText(c.id);
  if (!linkedinId) return null;
  const range = objectAt(c.employeeCountRange);
  const headquarter = (Array.isArray(c.locations) ? c.locations : [])
    .map(objectAt)
    .find((l) => l.headquarter === true);
  const hqCountry = cleanText(
    objectAt(headquarter?.parsed).countryCode,
  )?.toUpperCase();
  const industries = (Array.isArray(c.industries) ? c.industries : []).flatMap(
    (i) => {
      const name = cleanText(objectAt(i).name);
      return name ? [name] : [];
    },
  );
  return {
    linkedinId,
    universalName: cleanText(c.universalName),
    name: cleanText(c.name),
    linkedinUrl: withoutTrk(httpUrl(c.linkedinUrl)),
    website: httpUrl(c.website)?.toString() ?? null,
    employeeCount: count(c.employeeCount),
    employeeCountMin: count(range.start),
    employeeCountMax: count(range.end),
    industries,
    specialities: strings(c.specialities),
    description: cleanText(c.description),
    headquartersCountryCode:
      hqCountry && /^[A-Z]{2}$/.test(hqCountry) ? hqCountry : null,
  };
}

export function mapHarvestJob(
  payload: Record<string, unknown>,
  _ctx: NormalizeContext,
): NormalizedRecord {
  const p = payload;
  const company = mapCompany(p.company);
  const descriptionHtml = cleanText(p.descriptionHtml);
  const salary = objectAt(p.salary);
  const salaryText = cleanText(salary.text);
  const salaryMin = salaryBound(salary.min);
  const salaryMax = salaryBound(salary.max);
  const parsed = objectAt(objectAt(p.location).parsed);
  const countryCode = cleanText(parsed.countryCode);
  const employmentType = cleanText(p.employmentType);
  const team = Array.isArray(p.hiringTeam) ? objectAt(p.hiringTeam[0]) : {};
  const postedDate = cleanText(p.postedDate);
  const workplace = cleanText(p.workplaceType);
  return emptyRecord({
    kind: 'job',
    title: cleanText(p.title),
    companyName: company?.name ?? null,
    companyUrl: company?.linkedinUrl ?? null,
    location: cleanText(objectAt(p.location).linkedinText),
    contractType: contractText(employmentType),
    experienceLevel: cleanText(p.experienceLevel),
    sector: company?.industries[0] ?? null,
    salary:
      salaryText || salaryMin !== null || salaryMax !== null
        ? {
            text: salaryText,
            min: salaryMin,
            max: salaryMax,
            currency: cleanText(salary.currency),
            period: cleanText(salary.payPeriod),
          }
        : null,
    publishedAt: datePart(postedDate),
    postedAt: isoDatetime(postedDate),
    descriptionHtml,
    descriptionText:
      cleanText(p.descriptionText) ??
      (descriptionHtml ? cleanText(htmlToPlainText(descriptionHtml)) : null),
    applyUrl: outsideUrl(objectAt(p.applyMethod).companyApplyUrl),
    postingUrl: linkedinJobUrl(p.id, p.linkedinUrl) as string,
    poster: jobPoster(team.name, team.linkedinUrl),
    workplaceType: workplace ? (workplaceTypes[workplace] ?? null) : null,
    remoteAllowed:
      typeof p.workRemoteAllowed === 'boolean' ? p.workRemoteAllowed : null,
    employmentType,
    countryCode:
      countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    regionCode: cleanText(parsed.regionCode),
    applicantTrackingSystem: cleanText(p.applicantTrackingSystem),
    applicantCount: count(p.applicants),
    expiresAt: isoDatetime(p.expireAt),
    listingState: cleanText(p.jobState),
    company,
  });
}

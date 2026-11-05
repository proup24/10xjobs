import { emptyRecord, type NormalizedRecord } from './record';
import {
  cleanText,
  datePart,
  decodeEntitiesOnce,
  htmlToPlainText,
  objectAt,
} from './text';

/** Ashby `employmentType` values, in the LinkedIn `contractType` wording. */
export const ASHBY_EMPLOYMENT: Record<string, string> = {
  FullTime: 'Full-time',
  PartTime: 'Part-time',
  Contract: 'Contract',
  Intern: 'Internship',
  Temporary: 'Temporary',
};

type AtsMapped = NormalizedRecord | { invalid: string };

/** The posting URL the Google hit names (or the collector resolved it to). */
function hitUrl(p: Record<string, unknown>): string | null {
  return cleanText(p.resolvedUrl) ?? cleanText(objectAt(p.hit).url);
}

/**
 * A missing posting is a closed one when the fetch said so; any other fetch
 * failure carries no content to normalize.
 */
function missingPosting(p: Record<string, unknown>): AtsMapped | null {
  if (p.posting !== null && typeof p.posting === 'object') return null;
  const error = cleanText(p.fetchError) ?? '';
  if (!/closed or unavailable/i.test(error))
    return { invalid: 'normalize: posting not fetched' };
  return emptyRecord({
    kind: 'job',
    postingUrl: hitUrl(p) as string,
    closed: true,
  });
}

function descriptions(html: string | null) {
  return {
    descriptionHtml: html,
    descriptionText: html ? cleanText(htmlToPlainText(html)) : null,
  };
}

export function mapAshby(p: Record<string, unknown>): AtsMapped {
  const missing = missingPosting(p);
  if (missing) return missing;
  const posting = objectAt(p.posting);
  const url = hitUrl(p) as string;
  const employment = cleanText(posting.employmentType);
  return emptyRecord({
    kind: 'job',
    title: cleanText(posting.title),
    location: cleanText(posting.locationName),
    contractType: employment ? (ASHBY_EMPLOYMENT[employment] ?? null) : null,
    publishedAt: datePart(posting.publishedDate),
    ...descriptions(cleanText(posting.descriptionHtml)),
    applyUrl: url,
    postingUrl: url,
  });
}

export function mapGreenhouse(p: Record<string, unknown>): AtsMapped {
  const missing = missingPosting(p);
  if (missing) return missing;
  const posting = objectAt(p.posting);
  const url = cleanText(posting.absolute_url) ?? (hitUrl(p) as string);
  const content = cleanText(posting.content);
  return emptyRecord({
    kind: 'job',
    title: cleanText(posting.title),
    companyName: cleanText(posting.company_name),
    location: cleanText(objectAt(posting.location).name),
    publishedAt: datePart(posting.first_published),
    ...descriptions(content ? decodeEntitiesOnce(content) : null),
    applyUrl: url,
    postingUrl: url,
  });
}

import {
  cleanText,
  htmlToPlainText,
  objectAt,
} from 'src/modules/ingest/normalize/text';

export type PlaceId = 'us-remote' | 'uk-remote' | 'ma-onsite';
export type ActorName = 'valig' | 'kaix' | 'memo23' | 'curious_coder';

export interface SampleSearch {
  id: string;
  place: PlaceId;
  keywordKind: 'plain' | 'real';
  keyword: string;
  /** 'filter': the actor's remote filter; 'location': `Remote` as location; 'none': on-site. */
  remoteBy: 'filter' | 'location' | 'none';
  /** memo23 probe only. */
  seniorOnly: boolean;
}

export interface SampleJob {
  jk: string | null;
  title: string | null;
  company: string | null;
  place: string | null;
  descriptionText: string | null;
  /** Employer link only; any indeed.com URL is null. */
  applyUrl: string | null;
  easyApply: boolean | null;
  /** Exact ISO, or the relative text as given. */
  postedAt: string | null;
  remote: boolean | null;
  salary: string | null;
  jobType: string | null;
}

export interface ActorSpec {
  name: ActorName;
  actorId: string;
  rows: number;
  hasRemoteFilter: boolean;
  /** Per-row Apify event names this actor's input turns on, plus its start event. */
  rowEvents: string[];
  /** Charged once per started GB of `memoryMbytes`, at least once. */
  startEvent: string;
  /** Live events this actor's input keeps off, each with the reason; any other unlisted event refuses the plan. */
  knownOffEvents: Record<string, string>;
  /** Run memory, pinned at the actor's default run option. */
  memoryMbytes: number;
  buildInput(search: SampleSearch): Record<string, unknown>;
  readItem(raw: Record<string, unknown>): SampleJob;
}

const COUNTRY: Record<ActorName, Record<PlaceId, string>> = {
  valig: { 'us-remote': 'us', 'uk-remote': 'uk', 'ma-onsite': 'ma' },
  kaix: { 'us-remote': 'US', 'uk-remote': 'UK', 'ma-onsite': 'MA' },
  memo23: {
    'us-remote': 'United States',
    'uk-remote': 'United Kingdom',
    'ma-onsite': 'Morocco',
  },
  curious_coder: { 'us-remote': 'us', 'uk-remote': 'uk', 'ma-onsite': 'ma' },
};

const NO_JOB: SampleJob = {
  jk: null,
  title: null,
  company: null,
  place: null,
  descriptionText: null,
  applyUrl: null,
  easyApply: null,
  postedAt: null,
  remote: null,
  salary: null,
  jobType: null,
};

/** First non-blank string among the candidates. */
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

/** Plain text from a text field, or from an HTML field when the text is missing; markup and entities never survive either path. */
function plainText(text: unknown, html: unknown): string | null {
  const raw = cleanText(text) ?? cleanText(html);
  return raw ? cleanText(htmlToPlainText(raw)) : null;
}

/** An employer URL: http(s) only, and never an indeed.com host. */
function employerUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const raw = cleanText(value);
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      const host = url.hostname.toLowerCase();
      if (host === 'indeed.com' || host.endsWith('.indeed.com')) continue;
      return raw;
    } catch {
      continue;
    }
  }
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Indeed's remote job attribute (the `sc=attr(DSQF7)` search filter). */
const REMOTE_ATTRIBUTE = 'DSQF7';

/**
 * Remote from Indeed's job attributes, as a key → label map (valig) or a list of
 * `{ key, label }` (curious_coder): true when DSQF7 is there, false when the attributes
 * are there without it, null when the item has no attributes.
 */
function remoteAttribute(attributes: unknown): boolean | null {
  if (Array.isArray(attributes)) {
    return attributes.some(
      (attribute) => objectAt(attribute).key === REMOTE_ATTRIBUTE,
    );
  }
  if (attributes && typeof attributes === 'object') {
    return REMOTE_ATTRIBUTE in attributes;
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** An ISO string, or epoch milliseconds turned into one; relative text passes through. */
function dateText(value: unknown): string | null {
  const n = num(value);
  if (n !== null) {
    const date = new Date(n);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return cleanText(value);
}

/** One string from a string, a list of strings, or a map of key to string. */
function listText(value: unknown): string | null {
  if (typeof value === 'string') return cleanText(value);
  const parts = (Array.isArray(value) ? value : Object.values(objectAt(value)))
    .map((part) => cleanText(part))
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join(', ') : null;
}

function salaryText(
  min: unknown,
  max: unknown,
  currency: unknown,
  period: unknown,
): string | null {
  const low = num(min);
  const high = num(max);
  if (low === null && high === null) return null;
  const range =
    low !== null && high !== null && low !== high
      ? `${low}-${high}`
      : String(low ?? high);
  return [range, cleanText(currency), cleanText(period)?.toLowerCase()]
    .filter(Boolean)
    .join(' ');
}

function joinPlace(...parts: unknown[]): string | null {
  const texts = parts
    .map((part) => cleanText(part))
    .filter((part): part is string => part !== null);
  return texts.length ? texts.join(', ') : null;
}

/** Location text the actor should search: `Remote` or empty (on-site Morocco). */
function remoteLocation(search: SampleSearch): string {
  return search.remoteBy === 'none' ? '' : 'Remote';
}

/** Source fields: key, title, jobUrl, employer.name, location.*, description.text/html, datePublished, baseSalary, jobTypes, attributes (DSQF7 = remote). */
function readValig(raw: Record<string, unknown>): SampleJob {
  const location = objectAt(raw.location);
  const salary = objectAt(raw.baseSalary);
  return {
    ...NO_JOB,
    jk: firstText(raw.key),
    title: firstText(raw.title),
    company: firstText(objectAt(raw.employer).name),
    place: joinPlace(location.city, location.admin1Code, location.countryCode),
    descriptionText: plainText(
      objectAt(raw.description).text,
      objectAt(raw.description).html,
    ),
    applyUrl: employerUrl(raw.jobUrl),
    postedAt: dateText(raw.datePublished) ?? dateText(raw.dateOnIndeed),
    salary: salaryText(
      salary.min,
      salary.max,
      salary.currencyCode,
      salary.unitOfWork,
    ),
    remote: remoteAttribute(raw.attributes),
    jobType: listText(raw.jobTypes),
  };
}

/** Source fields: id, title.text, company.name, location.formatted, description.text/html, apply.url/isEasyApply, urls.external, dates.posted, workArrangement.isRemote, salary.*, classification.jobType. */
function readKaix(raw: Record<string, unknown>): SampleJob {
  const salary = objectAt(raw.salary);
  const apply = objectAt(raw.apply);
  const urls = objectAt(raw.urls);
  const dates = objectAt(raw.dates);
  const location = objectAt(raw.location);
  return {
    ...NO_JOB,
    jk: firstText(raw.id),
    title: firstText(objectAt(raw.title).text, raw.title),
    company: firstText(objectAt(raw.company).name),
    place: firstText(
      location.formatted,
      location.formattedShort,
      location.fullAddress,
    ),
    descriptionText: plainText(
      objectAt(raw.description).text,
      objectAt(raw.description).html,
    ),
    applyUrl: employerUrl(apply.url, urls.external, urls.apply),
    easyApply: bool(apply.isEasyApply),
    postedAt: dateText(dates.posted) ?? dateText(dates.onIndeed),
    remote: bool(objectAt(raw.workArrangement).isRemote),
    salary:
      firstText(salary.text) ??
      salaryText(salary.min, salary.max, salary.currency, salary.period),
    jobType: listText(objectAt(raw.classification).jobType),
  };
}

/**
 * Source fields (flat output, from the actor's dataset schema): jobId, positionName, company,
 * location, jobDescription (the schema does not say text or HTML, so both are cleaned),
 * externalApplyLink, indeedApplyable/indeedApplyEnabled, datePublished (else dateOnIndeed,
 * postedAt relative text), salary, jobType, remote. Alternates for the normalizeOutput columns.
 */
function readMemo23(raw: Record<string, unknown>): SampleJob {
  const urlKey = /[?&]jk=([0-9a-f]+)/i.exec(String(raw.url ?? ''))?.[1];
  return {
    ...NO_JOB,
    jk: firstText(raw.jobId, raw.jobKey, raw.id, urlKey),
    title: firstText(raw.positionName, raw.normTitle, raw.title),
    company: firstText(raw.company),
    place: firstText(raw.location) ?? joinPlace(raw.city, raw.countryCode),
    descriptionText: plainText(
      raw.jobDescription ?? raw.description_text,
      raw.description_html,
    ),
    applyUrl: employerUrl(raw.externalApplyLink, raw.externalApplyUrl),
    easyApply: bool(raw.indeedApplyable) ?? bool(raw.indeedApplyEnabled),
    postedAt:
      dateText(raw.datePublished) ??
      dateText(raw.dateOnIndeed) ??
      dateText(raw.postedAt),
    remote: bool(raw.remote),
    salary:
      firstText(raw.salary) ??
      salaryText(raw.salaryMin, raw.salaryMax, raw.currency, raw.salaryType),
    jobType: listText(raw.jobType),
  };
}

/** Source fields: id, title, companyDetails.name (else jobSourceName), formattedLocation, jobDescription/jobDescriptionHTML, originalApplyUrl, pubDate (epoch ms), salary.*, jobTypes, attributes (DSQF7 = remote). */
function readCuriousCoder(raw: Record<string, unknown>): SampleJob {
  const salary = objectAt(raw.salary);
  return {
    ...NO_JOB,
    jk: firstText(raw.id),
    title: firstText(raw.title),
    company: firstText(objectAt(raw.companyDetails).name, raw.jobSourceName),
    place: firstText(raw.formattedLocation),
    descriptionText: plainText(raw.jobDescription, raw.jobDescriptionHTML),
    applyUrl: employerUrl(raw.originalApplyUrl),
    postedAt: dateText(raw.pubDate),
    salary: salaryText(
      salary.min,
      salary.max,
      salary.currencyCode,
      salary.type,
    ),
    remote: remoteAttribute(raw.attributes),
    jobType: listText(raw.jobTypes),
  };
}

export const ACTORS: Record<ActorName, ActorSpec> = {
  valig: {
    name: 'valig',
    actorId: 'valig/indeed-jobs-scraper',
    rows: 100,
    hasRemoteFilter: false,
    rowEvents: ['apify-default-dataset-item'],
    startEvent: 'apify-actor-start',
    knownOffEvents: {},
    memoryMbytes: 128,
    buildInput: (search) => ({
      country: COUNTRY.valig[search.place],
      title: search.keyword,
      location: remoteLocation(search),
      limit: 100,
      datePosted: '1',
    }),
    readItem: readValig,
  },
  kaix: {
    name: 'kaix',
    actorId: 'kaix/indeed-scraper',
    rows: 100,
    hasRemoteFilter: true,
    rowEvents: ['apify-default-dataset-item'],
    startEvent: 'apify-actor-start',
    knownOffEvents: {},
    memoryMbytes: 512,
    // Rich mode is the only one that combines the date and remote filters.
    buildInput: (search) => ({
      keyword: search.keyword,
      country: COUNTRY.kaix[search.place],
      location: search.remoteBy === 'location' ? 'Remote' : '',
      maxItems: 100,
      sort: 'date',
      fromDays: '1',
      remote: search.remoteBy === 'filter' ? 'remote' : '',
      searchMode: 'rich',
    }),
    readItem: readKaix,
  },
  memo23: {
    name: 'memo23',
    actorId: 'memo23/apify-indeed-cheerio-ppr',
    rows: 50,
    hasRemoteFilter: true,
    rowEvents: ['apify-default-dataset-item', 'additional-data'],
    startEvent: 'apify-actor-start',
    knownOffEvents: {
      'contact-email':
        'charged only by enrichEmails, which the input sets false',
    },
    memoryMbytes: 1024,
    buildInput: (search) => ({
      position: search.keyword,
      country: COUNTRY.memo23[search.place],
      location: search.remoteBy === 'location' ? 'Remote' : '',
      datePosted: '1',
      remoteWork: search.remoteBy === 'filter' ? 'REMOTE' : '',
      sort: 'date',
      maxJobs: 50,
      includeCompanyDetails: false,
      resolveExternalApplyUrl: true,
      enrichEmails: false,
      expandToCities: false,
      deepSearch: false,
      flattenOutput: true,
      ...(search.seniorOnly ? { experienceLevel: 'SENIOR_LEVEL' } : {}),
    }),
    readItem: readMemo23,
  },
  curious_coder: {
    name: 'curious_coder',
    actorId: 'curious_coder/indeed-scraper',
    rows: 100,
    hasRemoteFilter: false,
    rowEvents: ['apify-default-dataset-item'],
    startEvent: 'apify-actor-start',
    knownOffEvents: {},
    memoryMbytes: 512,
    buildInput: (search) => ({
      country: COUNTRY.curious_coder[search.place],
      query: search.keyword,
      location: remoteLocation(search),
      postedWithinDays: '1',
      count: 100,
    }),
    readItem: readCuriousCoder,
  },
};

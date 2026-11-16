import { checkLines, type Labels } from '@xjobs/database/matches';
import { WEBHOOK_CONFIG } from '../config/webhooks.config';

/** What the payload is built from: one delivery's match, profile and job, as read from the database. */
export interface PayloadInput {
  profile: { id: string; position: string };
  match: {
    id: string;
    /** `job_matches.checks`, as stored. */
    checks: unknown;
    unverified: boolean;
    stackScore: number | null;
    trigger: 'decision' | 'review';
  };
  job: {
    id: string;
    title: string | null;
    companyName: string | null;
    companyUrl: string | null;
    postingUrl: string;
    applyUrl: string | null;
    postedAt: Date | null;
    firstSeenAt: Date;
    descriptionText: string | null;
  };
  /** The job's `job_facts.facts` document (raw, with codes); null when the job has no facts row. */
  facts: unknown;
}

export interface PayloadContext {
  deliveryId: string;
  createdAt: Date;
  /** `WEB_APP_URL`; null when unset. */
  webAppUrl: string | null;
}

export interface WebhookPayloadV1 {
  version: 1;
  event: 'match.qualified' | 'test';
  deliveryId: string;
  createdAt: string;
  profile: { id: string; position: string; label: string | null };
  trigger: 'decision' | 'review';
  match: {
    id: string;
    unverified: boolean;
    stackScore: number | null;
    reasons: {
      check: string;
      outcome: 'pass' | 'fail' | 'unknown';
      summary: string;
    }[];
  };
  job: {
    id: string;
    title: string | null;
    company: { name: string | null; url: string | null };
    postingUrl: string;
    applyUrl: string | null;
    postedAt: string | null;
    firstSeenAt: string;
    locations: { arrangement: string; places: string[] }[] | null;
    seniority: string | null;
    contractType: string | null;
    salary: {
      min: number | null;
      max: number | null;
      currency: string | null;
      period: string | null;
    } | null;
    techStack: string[] | null;
    languages: string[] | null;
    description: string | null;
  };
  links: { match: string | null };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A fact's value, or null when the fact is missing or JSON null. */
function factValue(facts: unknown, field: string): unknown {
  if (!isObject(facts)) return null;
  const fact = facts[field];
  return isObject(fact) ? (fact.value ?? null) : null;
}

const labelOf = (list: Labels[keyof Labels], code: string): string =>
  list.find((o) => o.value === code)?.label ?? code;

function placeName(place: unknown, labels: Labels): string | null {
  if (!isObject(place)) return null;
  switch (place.kind) {
    case 'worldwide':
      return 'Worldwide';
    case 'region': {
      const code = str(place.code);
      return code && labelOf(labels.regions, code);
    }
    case 'country': {
      const code = str(place.code);
      return code && labelOf(labels.countries, code);
    }
    case 'city': {
      const id = str(place.cityId);
      const known = id && labels.cities.find((c) => c.value === id)?.label;
      return known || str(place.name);
    }
    default:
      return null;
  }
}

/** One entry per arrangement of each opening; null when the job's openings are unknown. */
function locations(facts: unknown, labels: Labels) {
  const openings = isObject(facts) ? facts.openings : null;
  if (!Array.isArray(openings)) return null;
  return openings.flatMap((o) => {
    if (!isObject(o) || !Array.isArray(o.arrangements)) return [];
    const places = (Array.isArray(o.places) ? o.places : [])
      .map((p) => placeName(p, labels))
      .filter((p): p is string => p !== null);
    return o.arrangements
      .filter((a): a is string => typeof a === 'string')
      .map((arrangement) => ({ arrangement, places }));
  });
}

function salary(facts: unknown): WebhookPayloadV1['job']['salary'] {
  const v = factValue(facts, 'salary');
  if (!isObject(v)) return null;
  return {
    min: num(v.min),
    max: num(v.max),
    currency: str(v.currency),
    period: str(v.period),
  };
}

function techStack(facts: unknown): string[] | null {
  const v = factValue(facts, 'techStack');
  if (!isObject(v) || !Array.isArray(v.requirements)) return null;
  const names = v.requirements.flatMap((r) => {
    const t = isObject(r) && isObject(r.technology) ? r.technology : null;
    const name = t && (str(t.code) ?? str(t.text));
    return name ? [name] : [];
  });
  return [...new Set(names)];
}

function languages(facts: unknown): string[] | null {
  const v = factValue(facts, 'requiredLanguages');
  if (!Array.isArray(v)) return null;
  return v.flatMap((l) => {
    const lang = isObject(l) ? str(l.lang) : null;
    return lang ? [lang] : [];
  });
}

function build(
  event: WebhookPayloadV1['event'],
  input: PayloadInput,
  labels: Labels,
  ctx: PayloadContext,
): WebhookPayloadV1 {
  const { job, match, profile, facts } = input;
  const description = job.descriptionText?.slice(
    0,
    WEBHOOK_CONFIG.maxDescriptionChars,
  );
  return {
    version: 1,
    event,
    deliveryId: ctx.deliveryId,
    createdAt: ctx.createdAt.toISOString(),
    profile: {
      id: profile.id,
      position: profile.position,
      label:
        labels.positions.find((o) => o.value === profile.position)?.label ??
        null,
    },
    trigger: match.trigger,
    match: {
      id: match.id,
      unverified: match.unverified,
      stackScore: match.stackScore,
      reasons: checkLines(match.checks, labels).map(({ rule, mark, text }) => ({
        check: rule,
        outcome: mark,
        summary: text,
      })),
    },
    job: {
      id: job.id,
      title: job.title,
      company: { name: job.companyName, url: job.companyUrl },
      postingUrl: job.postingUrl,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt?.toISOString() ?? null,
      firstSeenAt: job.firstSeenAt.toISOString(),
      locations: locations(facts, labels),
      seniority: str(factValue(facts, 'seniority')),
      contractType: str(factValue(facts, 'contractType')),
      salary: salary(facts),
      techStack: techStack(facts),
      languages: languages(facts),
      description: description || null,
    },
    links: {
      match: ctx.webAppUrl
        ? `${ctx.webAppUrl.replace(/\/+$/, '')}/?job=${job.id}`
        : null,
    },
  };
}

/** The `match.qualified` body, snapshotted at a delivery's first send attempt. */
export function buildMatchPayload(
  input: PayloadInput,
  labels: Labels,
  ctx: PayloadContext,
): WebhookPayloadV1 {
  return build('match.qualified', input, labels, ctx);
}

const NIL = '00000000-0000-0000-0000-000000000000';

/** Shown when the user has no qualified match to sample. */
const EXAMPLE_INPUT: PayloadInput = {
  profile: { id: NIL, position: 'backend_engineer' },
  match: {
    id: NIL,
    unverified: false,
    stackScore: 0.72,
    trigger: 'decision',
    checks: [
      {
        rule: 'location',
        outcome: 'pass',
        reason: 'Remote in Europe fits your remote places',
      },
    ],
  },
  job: {
    id: NIL,
    title: 'Senior Backend Engineer (example)',
    companyName: 'Example Co',
    companyUrl: 'https://example.com',
    postingUrl: 'https://example.com/jobs/1',
    applyUrl: 'https://example.com/jobs/1/apply',
    postedAt: new Date('2026-11-16T09:00:00Z'),
    firstSeenAt: new Date('2026-11-16T10:00:00Z'),
    descriptionText: 'This is an example listing sent by your test delivery.',
  },
  facts: {
    seniority: { value: 'senior' },
    contractType: { value: 'full_time' },
    salary: {
      value: { min: 80000, max: 100000, currency: 'EUR', period: 'year' },
    },
    techStack: {
      value: {
        requirements: [
          { technology: { code: 'node', text: 'Node.js' } },
          { technology: { code: 'postgres', text: 'PostgreSQL' } },
        ],
      },
    },
    requiredLanguages: { value: [{ lang: 'en', level: 'fluent' }] },
    openings: [
      {
        arrangements: ['remote'],
        places: [{ kind: 'region', code: 'EUROPE' }],
      },
    ],
  },
};

/** The `test` body: the user's latest qualified match as the sample, else a fixed example job. */
export function buildTestPayload(
  sample: PayloadInput | null,
  labels: Labels,
  ctx: PayloadContext,
): WebhookPayloadV1 {
  return build('test', sample ?? EXAMPLE_INPUT, labels, ctx);
}

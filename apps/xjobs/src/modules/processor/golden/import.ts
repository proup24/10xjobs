/**
 * Turns one career-hub golden file into an xjobs `GoldenCase` (spec section 8).
 * Pure: the script reads and writes the files.
 *
 * Dropped on purpose: career-hub's `expected` (the owner's verdict), `covers`
 * (owner notes), `greenhouse`, `extraction.roleMatch` (fit to one candidate)
 * and `extraction.contactPerson` / `contactEmail` (third-party data).
 */
import type { ListName } from '../vocab/lists';
import type { SeedTerm } from '../vocab/seed-data';
import {
  type GoldenCase,
  type GoldenFacts,
  type GoldenPlace,
  type GoldenTerm,
  requirementsFromGroups,
  yearsRange,
} from './golden';

type Seed = Record<ListName, SeedTerm[]>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ImportResult =
  | { case: GoldenCase; unmapped: string[] }
  | { skipped: string };

/** career-hub roleKind to the xjobs `roleKinds` codes. */
const ROLE_KINDS: Record<string, string> = {
  'product-fullstack': 'fullstack_engineer',
  'product-backend': 'backend_engineer',
  'product-frontend': 'frontend_engineer',
  'ai-engineering': 'ai_engineer',
  'ai-training': 'ai_training',
  'platform-engineering': 'platform_engineer',
  'devops-sre': 'devops_engineer',
  mobile: 'mobile_engineer',
  'qa-manual': 'qa_manual',
  'qa-automation': 'qa_engineer',
  'seo-marketing-web': 'seo_marketing_web',
  'ux-engineering': 'ux_engineering',
  security: 'security_engineer',
  support: 'support',
  devrel: 'devrel',
  other: 'other',
  desktop: 'other',
};

/** career-hub tags whose xjobs code is spelled differently. */
const TAG_RENAMES: Record<string, string> = { golang: 'go' };

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE =
  /(?:\+\d[\d\s().-]{7,}\d|\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\b)/g;

/** Email addresses and phone numbers are personal data; they never reach the golden set. */
export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

/**
 * Drops every `## Company page (...)` section and keeps the text under
 * `## LinkedIn posting` (without its heading): what production receives. A
 * company page runs until the `## LinkedIn posting` heading, whatever other
 * `## ` headings it holds.
 */
export function stripCompanyPage(description: string): string {
  const kept: string[] = [];
  let dropping = false;
  for (const line of description.split('\n')) {
    if (/^## LinkedIn posting\b/.test(line)) {
      dropping = false;
      continue;
    }
    if (line.startsWith('## Company page')) {
      dropping = true;
      continue;
    }
    if (!dropping) kept.push(line);
  }
  return kept.join('\n').trim();
}

const flat = (s: string): string =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** An empty quote stays valid (the fact is unstated); otherwise it must still be in the text. */
const quoted = (quote: unknown, text: string): boolean =>
  typeof quote !== 'string' ||
  quote.trim() === '' ||
  text.includes(flat(quote));

/** Does a pay figure still appear in the text, as 140,000 or 140k or 140000? */
function salaryInText(salary: Json, text: string): boolean {
  const digits = text.replace(/(\d)[,. \u202f](?=\d{3}\b)/g, '$1');
  return [salary.min, salary.max].some(
    (n) =>
      typeof n === 'number' &&
      (digits.includes(String(n)) ||
        (n >= 1000 && n % 1000 === 0 && digits.includes(`${n / 1000}k`))),
  );
}

/** The owner's home country is not part of the golden set; the city stays. */
function cleanLocation(location: string): string {
  return redact(location)
    .replace(/,?\s*Morocco\b/g, '')
    .trim();
}

export function skipReason(raw: Json): string | null {
  const covers = String(raw.covers ?? '');
  if (/\bposts?\b/i.test(covers))
    return `LinkedIn post (covers: ${covers.slice(0, 40)})`;
  if (/^## LinkedIn post$/m.test(String(raw.description ?? '')))
    return 'description has a "## LinkedIn post" section';
  return null;
}

export function translateCase(raw: Json, seed: Seed): ImportResult {
  const skipped = skipReason(raw);
  if (skipped) return { skipped };

  const unmapped: string[] = [];
  const stripped = stripCompanyPage(String(raw.description ?? ''));
  const text = flat(stripped);
  const e: Json = raw.extraction ?? {};
  const codes = (list: ListName) => new Set(seed[list].map((t) => t.code));
  const regions = codes('regions');
  const countries = codes('countries');
  const roleKinds = codes('roleKinds');
  const tagByForm = new Map<string, string>();
  for (const t of seed.techTags) {
    tagByForm.set(t.code, t.code);
    for (const a of t.aliases) tagByForm.set(a.toLowerCase(), t.code);
    tagByForm.set(t.label.toLowerCase(), t.code);
  }

  const tagCode = (term: Json): string | null => {
    const forms = [term.tag, term.text]
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.toLowerCase());
    for (const f of forms)
      for (const v of [
        TAG_RENAMES[f] ?? f,
        f.replace(/-/g, ''),
        f.replace(/-/g, '_'),
      ]) {
        const hit = tagByForm.get(v);
        if (hit) return hit;
      }
    unmapped.push(`tag ${String(term.tag)} (${String(term.text)})`);
    return null;
  };
  const term = (t: Json): GoldenTerm => ({ text: t.text, code: tagCode(t) });

  const place = (p: Json): GoldenPlace | null => {
    if (p.kind === 'worldwide') return { kind: 'worldwide' };
    if (p.kind === 'region') {
      const code = String(p.code).toUpperCase().replace(/-/g, '_');
      if (regions.has(code)) return { kind: 'region', code };
      unmapped.push(`region ${p.code}`);
      return null;
    }
    if (p.kind === 'country') {
      const code = String(p.code).toUpperCase();
      if (countries.has(code)) return { kind: 'country', code };
      unmapped.push(`country ${p.code}`);
      return null;
    }
    const countryCode = String(p.country ?? '').toUpperCase();
    return {
      kind: 'city',
      name: p.name,
      countryCode: countries.has(countryCode) ? countryCode : null,
    };
  };

  const expected: Partial<GoldenFacts> = {};

  // Facts whose quote left with the company page become unstated.
  const openings: Json[] = e.openings ?? [];
  expected.openings = openings.every((o) => quoted(o.quote, text))
    ? openings.map((o) => ({
        arrangements: o.arrangements,
        places: (o.places as Json[]).flatMap((p) => place(p) ?? []),
        placeStrictness: o.placeStrictness,
      }))
    : [{ arrangements: ['unstated'], places: [], placeStrictness: 'unstated' }];

  const rk = e.roleKind;
  if (rk) {
    const code = ROLE_KINDS[rk.value] ?? 'other';
    if (!ROLE_KINDS[rk.value]) unmapped.push(`roleKind ${rk.value}`);
    expected.roleKind =
      quoted(rk.quote, text) && roleKinds.has(code) ? code : 'unstated';
  }
  const sen = e.seniority;
  if (sen)
    expected.seniority = quoted(sen.quote, text) ? sen.value : 'unstated';
  const years = e.yearsRequired;
  if (years)
    expected.yearsRequired = yearsRange(
      quoted(years.quote, text) ? (years.value ?? null) : null,
    );
  const months = e.contractMonths;
  expected.contractMonths =
    typeof months === 'number' ? months : (months?.value ?? null);

  const groups: Json[] = e.mainStack?.groups ?? [];
  Object.assign(
    expected,
    requirementsFromGroups({
      main: quoted(e.mainStack?.quote, text)
        ? groups.map((g) => ({ anyOf: (g.anyOf as Json[]).map(term) }))
        : [],
    }),
  );

  expected.requiredLanguages = ((e.requiredLanguages ?? []) as Json[])
    .filter((l) => quoted(l.quote, text))
    .map((l) => ({ lang: l.lang, level: l.level }));

  const sp = e.sponsorship;
  expected.sponsorship =
    sp && quoted(sp.quote, text) ? (sp.value ?? 'unstated') : 'unstated';

  expected.salary =
    e.salary && salaryInText(e.salary, text)
      ? {
          min: e.salary.min ?? null,
          max: e.salary.max ?? null,
          currency: e.salary.currency,
          period: e.salary.period,
        }
      : null;

  expected.junkFlags = ((e.junkFlags ?? []) as (string | Json)[])
    .map((f) => (typeof f === 'string' ? f : String(f.code)))
    .map((f) => f.replace(/-/g, '_'));

  return {
    unmapped,
    case: {
      id: String(raw.id),
      input: {
        title: redact(String(raw.title ?? '')),
        companyName: redact(String(raw.company ?? '')),
        description: redact(stripped),
        evidence: {
          location: raw.location ? cleanLocation(String(raw.location)) : null,
          contractType: null,
          experienceLevel: null,
          salary: null,
        },
      },
      expected,
      // Requirement domains and years are labeled by hand.
      drafted: { requirements: { value: null, reviewed: false } },
    },
  };
}

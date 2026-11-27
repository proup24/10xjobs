import type { MatchRow } from './group';

/**
 * The job facts `match_details` returns (`facts` jsonb, labels already resolved in SQL),
 * worded for display. Every value is null when the job doesn't state it.
 */
export type FactLines = {
  role: FactLine | null;
  seniority: FactLine | null;
  arrangement: FactLine | null;
  places: FactLine | null;
  contractType: FactLine | null;
  engagement: FactLine | null;
  salary: FactLine | null;
};

/** A worded fact and where it came from: the description, or the listing. */
export type FactLine = { text: string; source: FactSource };
export type FactSource = 'description' | 'linkedin';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
// The value lists' `unstated` code is the extractor saying the job doesn't say: "Not stated".
const label = (v: unknown): string | null =>
  obj(v)?.code === 'unstated'
    ? null
    : (str(obj(v)?.label) ?? str(obj(v)?.code));
const unique = (xs: (string | null)[]): string[] => [
  ...new Set(xs.filter((x): x is string => x !== null)),
];

function years(v: unknown): string | null {
  const o = obj(v);
  const min = num(o?.min);
  const max = num(o?.max);
  if (min !== null && max !== null)
    return min === max ? `${min} years` : `${min}–${max} years`;
  if (min !== null) return `${min}+ years`;
  if (max !== null) return `up to ${max} years`;
  return null;
}

function placeName(v: unknown): string | null {
  const p = obj(v);
  if (!p) return null;
  if (p.kind === 'worldwide') return 'Worldwide';
  return str(p.label) ?? str(p.name) ?? str(p.code);
}

function opening(v: unknown): string | null {
  const o = obj(v);
  const places = unique(arr(o?.places).map(placeName));
  const zones = unique(arr(o?.timezones).map((z) => str(obj(z)?.label)));
  if (places.length === 0 && zones.length === 0) return null;
  const where = places.length ? places.join(', ') : 'Anywhere';
  return zones.length ? `${where} (${zones.join(', ')})` : where;
}

function money(n: number): string {
  return n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en');
}

function salaryRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string | null {
  if (min === null && max === null) return null;
  const range =
    min !== null && max !== null && min !== max
      ? `${money(min)}–${money(max)}`
      : min !== null && max === null
        ? `${money(min)}+`
        : money((max ?? min) as number);
  return [currency, range, period ? `per ${period}` : null]
    .filter(Boolean)
    .join(' ');
}

/** The salary from the job's combined facts (the description's, else LinkedIn's). */
function factSalary(facts: unknown): string | null {
  const s = obj(obj(facts)?.salary);
  return salaryRange(
    num(s?.min),
    num(s?.max),
    str(s?.currency),
    str(s?.period),
  );
}

/** The job's salary: the combined facts', else the listing's own text or range. */
export function salaryLine(
  row: Pick<
    MatchRow,
    'salaryText' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
  > & { facts: unknown },
): string | null {
  return (
    factSalary(row.facts) ??
    str(row.salaryText) ??
    salaryRange(
      num(row.salaryMin),
      num(row.salaryMax),
      str(row.salaryCurrency),
      str(row.salaryPeriod),
    )
  );
}

const sourceOf = (v: unknown): FactSource =>
  v === 'linkedin' ? 'linkedin' : 'description';
const line = (text: string | null, source: unknown): FactLine | null =>
  text === null ? null : { text, source: sourceOf(source) };

/** The job's arrangement: the stated one, else those of its openings. */
export function arrangementLine(facts: unknown): string | null {
  const f = obj(facts);
  const stated = label(f?.arrangement);
  if (stated) return stated;
  const fromOpenings = unique(
    arr(f?.openings).flatMap((o) => arr(obj(o)?.arrangements).map(label)),
  );
  return fromOpenings.length ? fromOpenings.join(', ') : null;
}

export function factLines(
  row: Pick<
    MatchRow,
    'salaryText' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
  > & { facts: unknown; channels?: string[] | null },
): FactLines {
  const f = obj(row.facts);
  const position = obj(f?.position);
  const seniority = [label(f?.seniority), years(f?.yearsRequired)].filter(
    (x): x is string => x !== null,
  );
  const openings = arr(f?.openings);
  const places = unique(openings.map(opening));
  const stated = label(f?.arrangement);
  const arrangement = arrangementLine(row.facts);
  const salary = salaryLine(row);
  const listed = (row.channels ?? []).some((c) => c.startsWith('LINKEDIN'));
  return {
    role: line(
      label(position?.roleKind) ?? str(position?.title),
      position?.source,
    ),
    seniority: line(
      seniority.length ? seniority.join(' · ') : null,
      obj(f?.seniority)?.source,
    ),
    arrangement: line(
      arrangement,
      obj(f?.arrangement)?.source === 'linkedin' ||
        (!stated && fromListing(openings, 'arrangementSource'))
        ? 'linkedin'
        : 'description',
    ),
    places: line(
      places.length ? places.join('; ') : null,
      fromListing(openings, 'placesSource') ? 'linkedin' : 'description',
    ),
    contractType: line(label(f?.contractType), obj(f?.contractType)?.source),
    engagement: line(label(f?.engagement), obj(f?.engagement)?.source),
    salary: line(
      salary,
      factSalary(row.facts)
        ? obj(f?.salary)?.source
        : listed
          ? 'linkedin'
          : 'description',
    ),
  };
}

/** Whether any opening took that part (its arrangement or its places) from the listing. */
const fromListing = (
  openings: unknown[],
  part: 'arrangementSource' | 'placesSource',
): boolean => openings.some((o) => obj(o)?.[part] === 'linkedin');

const CONFLICT_FIELDS = [
  'arrangement',
  'places',
  'salary',
  'seniority',
  'contractType',
] as const;
export type ConflictField = (typeof CONFLICT_FIELDS)[number];

/** Words one side of a conflict: a code or text, a place, a salary, or a list of them. */
function conflictValue(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = unique(v.map(conflictValue));
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return String(v);
  const o = obj(v);
  if (!o) return null;
  if ('min' in o || 'max' in o)
    return salaryRange(num(o.min), num(o.max), str(o.currency), str(o.period));
  return placeName(o) ?? str(o.text) ?? str(o.city) ?? str(o.country);
}

/**
 * Where the listing disagreed with the description, by fact, worded as
 * "The listing says X". A fact with no conflict is absent.
 */
export function conflictLines(
  conflicts: unknown,
): Partial<Record<ConflictField, string>> {
  const out: Partial<Record<ConflictField, string>> = {};
  for (const c of arr(conflicts)) {
    const field = obj(c)?.field;
    const text = conflictValue(obj(c)?.listingValue);
    if (text && CONFLICT_FIELDS.some((f) => f === field))
      out[field as ConflictField] = `The listing says ${text}`;
  }
  return out;
}

/** The stack rule's comparison for one match, with tech codes shown as labels. */
export type StackLines = {
  covered: string[];
  uncovered: string[];
  notCompared: string[];
};

export function stackLines(
  checks: unknown,
  techLabel: (code: string) => string,
): StackLines {
  const stack = arr(checks)
    .map(obj)
    .find((c) => c?.rule === 'stack');
  const detail = obj(stack?.detail);
  // A unit is "react or vue" when any member counts; word each code.
  const units = (v: unknown) =>
    arr(v)
      .map(str)
      .filter((x): x is string => x !== null)
      .map((u) => u.split(' or ').map(techLabel).join(' or '));
  return {
    covered: [...units(detail?.covered), ...units(detail?.niceCovered)],
    uncovered: units(detail?.uncovered),
    notCompared: arr(detail?.notComparable)
      .map(str)
      .filter((x): x is string => x !== null),
  };
}

/**
 * The description's words for one fact (a key of the row's `facts`, as the matcher names
 * the field a check rests on): its own quote, else its parts' (each opening, each required
 * language or technology). Empty when the fact has none, or isn't in the facts.
 */
export function factQuotes(facts: unknown, field: string): string[] {
  const f = obj(facts);
  if (field === 'openings')
    return unique(arr(f?.openings).map((o) => str(obj(o)?.quote)));
  const fact = obj(f?.[field]);
  const own = str(fact?.quote);
  if (own) return [own];
  const parts =
    field === 'requiredLanguages'
      ? arr(fact?.languages)
      : field === 'techStack'
        ? arr(fact?.requirements)
        : [];
  return unique(parts.map((p) => str(obj(p)?.quote)));
}

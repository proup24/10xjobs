import type { MatchRow } from './group';

/**
 * The job facts `match_details` returns (`facts` jsonb, labels already resolved in SQL),
 * worded for display. Every value is null when the job doesn't state it.
 */
export type FactLines = {
  role: string | null;
  seniority: string | null;
  arrangement: string | null;
  places: string | null;
  contractType: string | null;
  engagement: string | null;
  salary: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const label = (v: unknown): string | null =>
  str(obj(v)?.label) ?? str(obj(v)?.code);
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

export function salaryLine(
  row: Pick<
    MatchRow,
    'salaryText' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
  > & { facts: unknown },
): string | null {
  const fromJob =
    str(row.salaryText) ??
    salaryRange(
      num(row.salaryMin),
      num(row.salaryMax),
      str(row.salaryCurrency),
      str(row.salaryPeriod),
    );
  if (fromJob) return fromJob;
  const s = obj(obj(row.facts)?.salary);
  return salaryRange(
    num(s?.min),
    num(s?.max),
    str(s?.currency),
    str(s?.period),
  );
}

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
  > & { facts: unknown },
): FactLines {
  const f = obj(row.facts);
  const position = obj(f?.position);
  const seniority = [label(f?.seniority), years(f?.yearsRequired)].filter(
    (x): x is string => x !== null,
  );
  const places = unique(arr(f?.openings).map(opening));
  return {
    role: label(position?.roleKind) ?? str(position?.title),
    seniority: seniority.length ? seniority.join(' · ') : null,
    arrangement: arrangementLine(row.facts),
    places: places.length ? places.join('; ') : null,
    contractType: label(f?.contractType),
    engagement: label(f?.engagement),
    salary: salaryLine(row),
  };
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

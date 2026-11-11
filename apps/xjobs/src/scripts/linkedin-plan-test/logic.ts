/**
 * The pure decisions of the LinkedIn plan live test (`../linkedin-plan-test.ts`),
 * kept apart from its paid Apify runs so they can be unit tested.
 */
import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';
import { locationKey } from 'src/modules/queries/steps/normalize';

/** The most one invocation of the test may reserve across its runs. */
export const TOTAL_BUDGET_USD = 1;

/**
 * The most every invocation together may reserve, tracked in a local spend
 * file: the main run ($1) plus the ceiling run (its 1,200-row cap alone is
 * about $0.97), so about $2 in all. Awaiting the maintainer's approval: the
 * spec says about $1 in total.
 */
export const CAMPAIGN_BUDGET_USD = 2;

/** What this invocation may reserve, given what earlier ones already did. */
export function invocationLimit(
  campaignReservedUsd: number,
  campaignLimitUsd: number = CAMPAIGN_BUDGET_USD,
): number {
  return Math.max(
    0,
    Math.min(TOTAL_BUDGET_USD, campaignLimitUsd - campaignReservedUsd),
  );
}

export class BudgetExceededError extends Error {}

export interface Budget {
  remaining(): number;
  /** Counts a run's cap against the total, or throws if it would pass it. */
  reserve(maxTotalChargeUsd: number): void;
  spent(): number;
}

export function createBudget(limitUsd: number = TOTAL_BUDGET_USD): Budget {
  let reserved = 0;
  return {
    reserve(maxTotalChargeUsd) {
      // Tolerate float noise so 0.4 + 0.6 fits a budget of 1.
      if (reserved + maxTotalChargeUsd > limitUsd + 1e-9)
        throw new BudgetExceededError(
          `Budget exceeded: ${reserved.toFixed(2)} spent + ${maxTotalChargeUsd.toFixed(2)} cap > ${limitUsd} USD`,
        );
      reserved += maxTotalChargeUsd;
    },
    spent: () => reserved,
    remaining: () => limitUsd - reserved,
  };
}

export interface OrForms {
  quoted: string;
  parenthesised: string;
  bare: string;
}

/** The three ways to spell an OR of terms, multi-word terms included. */
export function orForms(terms: readonly string[]): OrForms {
  const multi = (term: string) => term.includes(' ');
  return {
    quoted: terms.map((t) => (multi(t) ? `"${t}"` : t)).join(' OR '),
    parenthesised: terms.map((t) => (multi(t) ? `(${t})` : t)).join(' OR '),
    bare: terms.join(' OR '),
  };
}

/** Technology terms OR'd together, as many as fit in `maxChars`. */
export function keywordOfLength(maxChars: number): string {
  const terms = [...new Set(Object.values(TECHNOLOGY_TERMS))];
  const chosen: string[] = [];
  let length = 0;
  for (const term of terms) {
    const next = length + (chosen.length > 0 ? 4 : 0) + term.length;
    if (next > maxChars) continue;
    chosen.push(term);
    length = next;
  }
  return chosen.join(' OR ');
}

export interface DatedItem {
  id: string;
  publishedAt: string | null;
}

export type ContainmentVerdict =
  | 'pass'
  | 'row-limit-cut'
  | 'window-edge'
  | 'fail'
  | 'invalid';

export interface ContainmentContext {
  /** The parent run returned as many rows as it asked for, so it may be cut. */
  parentFull: boolean;
  /** When the shared `f_TPR` window opened (ms), for the child run. */
  windowStart?: number;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Dates may be rounded to a day in a time zone other than UTC, so a cut job
 * can carry the day after the parent's oldest.
 */
const DATE_SLACK_DAYS = 1;

/** The UTC day number of a date, or NaN when it has none. */
function dayOf(value: string | null): number {
  if (value === null) return Number.NaN;
  return Math.floor(Date.parse(value) / DAY_MS);
}

/**
 * Whether the parent search holds the child's jobs. The actor dates jobs to
 * the day (midnight UTC), so the check works in days:
 * - a missing job from the window's first day may have aged out between the
 *   two runs: `window-edge`;
 * - when the parent came back full, a missing job dated on or before its
 *   oldest day (one day of slack), or with no date, may be past its row
 *   limit: `row-limit-cut` (rerun the parent with more rows);
 * - any other missing job is a `fail`.
 * Only `pass` approves a pair; the other two are inconclusive, never a fail.
 */
export function containmentVerdict(
  child: readonly DatedItem[],
  parent: readonly DatedItem[],
  context: ContainmentContext,
): { verdict: ContainmentVerdict; missing: string[] } {
  const parentIds = new Set(parent.map((item) => item.id));
  const missingItems = child.filter((item) => !parentIds.has(item.id));
  const missing = missingItems.map((item) => item.id);
  if (missing.length === 0) return { verdict: 'pass', missing };
  const parentDays = parent
    .map((item) => dayOf(item.publishedAt))
    .filter((d) => Number.isFinite(d));
  const oldestDay =
    parentDays.length > 0 ? Math.min(...parentDays) : Number.NaN;
  const edgeDay =
    context.windowStart === undefined
      ? Number.NEGATIVE_INFINITY
      : Math.floor(context.windowStart / DAY_MS);
  let cut = false;
  let edge = false;
  for (const item of missingItems) {
    const d = dayOf(item.publishedAt);
    if (Number.isFinite(d) && d <= edgeDay) edge = true;
    else if (
      context.parentFull &&
      (!Number.isFinite(d) ||
        !Number.isFinite(oldestDay) ||
        d <= oldestDay + DATE_SLACK_DAYS)
    )
      cut = true;
    else return { verdict: 'fail', missing };
  }
  return {
    verdict: cut ? 'row-limit-cut' : edge ? 'window-edge' : 'fail',
    missing,
  };
}

export interface PublishedAtStats {
  total: number;
  parseableShare: number;
  nonMidnightShare: number;
}

/** How usable `publishedAt` is: parseable, and carrying a real time of day. */
export function publishedAtStats(
  items: readonly { publishedAt?: unknown }[],
): PublishedAtStats {
  let parseable = 0;
  let nonMidnight = 0;
  for (const { publishedAt } of items) {
    if (typeof publishedAt !== 'string') continue;
    const date = new Date(publishedAt);
    if (Number.isNaN(date.getTime())) continue;
    parseable++;
    if (
      date.getUTCHours() !== 0 ||
      date.getUTCMinutes() !== 0 ||
      date.getUTCSeconds() !== 0
    )
      nonMidnight++;
  }
  const total = items.length;
  return {
    total,
    parseableShare: total === 0 ? 0 : parseable / total,
    nonMidnightShare: total === 0 ? 0 : nonMidnight / total,
  };
}

export interface RunSide {
  ok: boolean;
  items: readonly DatedItem[];
}

/**
 * The verdict for one pair's two runs. A run that failed, or a child that came
 * back empty, proves nothing about containment: `invalid`, never a pass or fail.
 */
export function judgeContainment(
  child: RunSide,
  parent: RunSide,
  context: ContainmentContext,
): { verdict: ContainmentVerdict; missing: string[] } {
  if (!child.ok || child.items.length === 0 || !parent.ok)
    return { verdict: 'invalid', missing: [] };
  return containmentVerdict(child.items, parent.items, context);
}

/** Dataset items as id + date; items with no id cannot be compared, so counted apart. */
export function datedItems(items: readonly Record<string, unknown>[]): {
  items: DatedItem[];
  withoutId: number;
} {
  const dated: DatedItem[] = [];
  let withoutId = 0;
  for (const item of items) {
    const id = [item.jobId, item.jobUrl].find(
      (value) => typeof value === 'string' && value !== '',
    );
    if (typeof id !== 'string') {
      withoutId++;
      continue;
    }
    dated.push({
      id,
      publishedAt:
        typeof item.publishedAt === 'string' ? item.publishedAt : null,
    });
  }
  return { items: dated, withoutId };
}

export interface RunOutcome {
  ok: boolean;
  /** Out-of-memory style failure at the run's memory setting. */
  memoryFailure: boolean;
  /** The run stopped at its maxTotalChargeUsd, so it may be truncated. */
  chargeCapped: boolean;
}

/** Messages a run out of memory leaves; a bare mention of memory is not one. */
const MEMORY_FAILURE =
  /out of memory|\boom\b|oom[- ]?kill|memory limit (exceeded|reached)|exceeded (its |the )?memory/i;

/** Apify's message for a run stopped by its `maxTotalChargeUsd`. */
const CHARGE_LIMIT =
  /max(imum)? total charge|maxTotalChargeUsd|total charge (limit|cap)/i;

/**
 * Reads an Apify run's final state; each flag is set on its own evidence.
 * A run counts as charge-capped when its usage reached its cap (within 2%,
 * as Apify stops just before it), or its message says so.
 */
export function classifyRun(run: {
  status?: string;
  statusMessage?: string;
  exitCode?: number;
  error?: string;
  usageTotalUsd?: number;
  maxTotalChargeUsd?: number;
}): RunOutcome {
  const text = `${run.statusMessage ?? ''} ${run.error ?? ''}`;
  const usageAtCap =
    run.usageTotalUsd !== undefined &&
    run.maxTotalChargeUsd !== undefined &&
    run.maxTotalChargeUsd > 0 &&
    run.usageTotalUsd >= run.maxTotalChargeUsd * 0.98;
  return {
    ok: run.status === 'SUCCEEDED',
    memoryFailure: run.exitCode === 137 || MEMORY_FAILURE.test(text),
    chargeCapped: usageAtCap || CHARGE_LIMIT.test(text),
  };
}

export type GeoSource = 'override' | 'LINKEDIN_GEO_IDS' | 'none';

/** `--geo '<place>=<geoId>'` values as a map keyed by location key. */
export function parseGeoArgs(args: readonly string[]): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const arg of args) {
    const at = arg.lastIndexOf('=');
    const place = at > 0 ? arg.slice(0, at).trim() : '';
    const geoId = at > 0 ? arg.slice(at + 1).trim() : '';
    if (!place || !/^\d+$/.test(geoId))
      throw new Error(
        `--geo expects '<place text>=<numeric geoId>', got '${arg}'`,
      );
    overrides.set(locationKey(place), geoId);
  }
  return overrides;
}

/**
 * The geoId for a place, by any of its names (its search text first, then a
 * region code): an override wins over the pinned table.
 */
export function resolveGeo(
  names: string | readonly string[],
  overrides: ReadonlyMap<string, string>,
  pinned: Readonly<Record<string, string>>,
): { geoId: string | undefined; source: GeoSource } {
  const keys = (typeof names === 'string' ? [names] : names).map(locationKey);
  for (const key of keys) {
    const override = overrides.get(key);
    if (override) return { geoId: override, source: 'override' };
  }
  for (const key of keys) {
    const known = pinned[key];
    if (known) return { geoId: known, source: 'LINKEDIN_GEO_IDS' };
  }
  return { geoId: undefined, source: 'none' };
}

export const SECTIONS = ['or', 'length', 'containment', 'ceiling'] as const;
export type Section = (typeof SECTIONS)[number];

/** `--sections or,containment` as a set in canonical order; default all. */
export function parseSections(value: string | undefined): Set<Section> {
  if (value === undefined) return new Set(SECTIONS);
  const wanted = value.split(',').map((name) => name.trim());
  for (const name of wanted)
    if (!(SECTIONS as readonly string[]).includes(name))
      throw new Error(`--sections: unknown section '${name}'`);
  return new Set(SECTIONS.filter((name) => wanted.includes(name)));
}

export interface Pair {
  /** The child's search text (a builder location). */
  child: string;
  /** The child's region code, when the child is a region. */
  childCode?: string;
  /** The parent's search text: a region's label or a country's label. */
  parent: string;
  /** The parent's region code, when the parent is a region. */
  parentCode?: string;
}

/**
 * The regions the spec's worked example folds into, by code (the search text
 * is the region's label: `LATAM` is searched as "Latin America").
 */
export const FIXED_PARENT_CODES = [
  'EMEA',
  'EUROPE',
  'LATAM',
  'NORTH_AFRICA',
] as const;

/** Not a place a profile can want, so nothing folds into it. */
const NO_PARENT_CODES = new Set(['GLOBAL']);

export interface Geography {
  regions: { code: string; label: string }[];
  countries: { code: string; label: string }[];
  cities: { name: string; countryCode: string }[];
  links: { regionCode: string; countryCode: string }[];
}

type Kind = 'region' | 'country' | 'city';

interface Node {
  kind: Kind;
  text: string;
  countries: Set<string>;
  /** A city's country. */
  countryCode?: string;
}

const KIND_ORDER: Record<Kind, number> = { region: 0, country: 1, city: 2 };

function isSuperset(outer: Set<string>, inner: Set<string>): boolean {
  for (const code of inner) if (!outer.has(code)) return false;
  return true;
}

/**
 * Candidate containment pairs, in the order they should run. A child is a
 * builder place (a region, a country or `city, country`); its parents are its
 * country (for a city) and every region whose countries (`region_countries`)
 * include all of the child's. A parent that cannot contain the child is never
 * paired. Places that match nothing are skipped.
 *
 * Order, so a budget stop loses the least useful pairs (the spec's worked
 * example first, and EMEA first of all since the gate depends on it):
 * 1. regions and countries into EMEA (regions first);
 * 2. cities into their country (the hybrid and on-site searches);
 * 3. regions and countries into Latin America;
 * 4. into another fixed parent or a place some builder wants;
 * 5. the rest.
 */
export function buildPairs(
  places: readonly string[],
  geography: Geography,
): Pair[] {
  const key = (text: string) => locationKey(text);
  const countriesOf = new Map<string, Set<string>>();
  for (const link of geography.links) {
    const set = countriesOf.get(link.regionCode) ?? new Set<string>();
    set.add(link.countryCode);
    countriesOf.set(link.regionCode, set);
  }
  const countryLabel = new Map(
    geography.countries.map((c) => [c.code, c.label]),
  );

  const resolve = (place: string): (Node & { code?: string }) | undefined => {
    const k = key(place);
    const region = geography.regions.find(
      (r) => key(r.label) === k || key(r.code) === k,
    );
    if (region) {
      const countries = countriesOf.get(region.code);
      return countries && countries.size > 0
        ? { kind: 'region', text: place, countries, code: region.code }
        : undefined;
    }
    const country = geography.countries.find(
      (c) => key(c.label) === k || key(c.code) === k,
    );
    if (country)
      return {
        kind: 'country',
        text: place,
        countries: new Set([country.code]),
      };
    const city = geography.cities.find(
      (c) => key(`${c.name}, ${countryLabel.get(c.countryCode) ?? ''}`) === k,
    );
    if (city)
      return {
        kind: 'city',
        text: place,
        countries: new Set([city.countryCode]),
        countryCode: city.countryCode,
      };
    return undefined;
  };

  const wanted = new Set(places.map(key));
  const ranked: { pair: Pair; tier: number; kind: number; index: number }[] =
    [];
  const seen = new Set<string>();
  const add = (child: Node, pair: Pair, tier: number) => {
    const id = `${key(pair.child)}|${key(pair.parent)}`;
    if (key(pair.child) === key(pair.parent) || seen.has(id)) return;
    seen.add(id);
    ranked.push({
      pair,
      tier,
      kind: KIND_ORDER[child.kind],
      index: ranked.length,
    });
  };

  for (const place of places) {
    const child = resolve(place);
    if (!child) continue;
    if (child.kind === 'city' && child.countryCode) {
      const owner = countryLabel.get(child.countryCode);
      if (owner) add(child, { child: place, parent: owner }, 2);
    }
    for (const region of geography.regions) {
      if (NO_PARENT_CODES.has(region.code)) continue;
      if ('code' in child && child.code === region.code) continue;
      const countries = countriesOf.get(region.code);
      if (!countries || !isSuperset(countries, child.countries)) continue;
      // A region holding exactly the same countries is a synonym, not a parent.
      if (child.kind === 'region' && countries.size === child.countries.size)
        continue;
      const notCity = child.kind !== 'city';
      const tier =
        region.code === 'EMEA' && notCity
          ? 1
          : region.code === 'LATAM' && notCity
            ? 3
            : (FIXED_PARENT_CODES as readonly string[]).includes(region.code) ||
                wanted.has(key(region.label))
              ? 4
              : 5;
      add(
        child,
        {
          child: place,
          ...(child.code ? { childCode: child.code } : {}),
          parent: region.label,
          parentCode: region.code,
        },
        tier,
      );
    }
  }
  return ranked
    .sort((a, b) => a.tier - b.tier || a.kind - b.kind || a.index - b.index)
    .map(({ pair }) => pair);
}

/** `--pairs 'Casablanca>Morocco,Europe>EMEA'` as child/parent names. */
export function parsePairsFilter(
  value: string,
): { child: string; parent: string }[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [child, parent, extra] = entry.split('>').map((s) => s.trim());
      if (!child || !parent || extra !== undefined)
        throw new Error(`--pairs expects 'child>parent,...', got '${entry}'`);
      return { child, parent };
    });
}

/**
 * The pairs a `--pairs` filter names, in run order. A name matches a side by
 * its search text, a city's name alone (`Casablanca`), or a region code.
 */
export function filterPairs(
  pairs: readonly Pair[],
  wanted: readonly { child: string; parent: string }[],
): { pairs: Pair[]; unmatched: string[] } {
  const names = (text: string, code?: string) =>
    new Set(
      [text, text.split(',')[0] ?? text, code ?? '']
        .filter((n) => n !== '')
        .map(locationKey),
    );
  const matches = (pair: Pair, w: { child: string; parent: string }) =>
    names(pair.child, pair.childCode).has(locationKey(w.child)) &&
    names(pair.parent, pair.parentCode).has(locationKey(w.parent));
  return {
    pairs: pairs.filter((pair) => wanted.some((w) => matches(pair, w))),
    unmatched: wanted
      .filter((w) => !pairs.some((pair) => matches(pair, w)))
      .map((w) => `${w.child}>${w.parent}`),
  };
}

/**
 * The charge cap for a run of `rows` rows: the actor's start fee at 1 GB
 * ($0.005) plus its dearest price (Free plan, $0.70 per 1,000 jobs), with 15%
 * headroom. A cap below this could cut a run short and be mistaken for a
 * LinkedIn limit.
 */
export function rowsCap(rows: number): number {
  return Number(((0.005 + rows * 0.0007) * 1.15).toFixed(4));
}

/** Runs per section, and the rows each asks for. */
export const OR_RUNS = 5;
/** Keyword lengths (chars) the length section tries. */
export const LENGTHS = [100, 200, 400, 800] as const;
export const LENGTH_RUNS = LENGTHS.length;
export const SMALL_ROWS = 25;
export const PAIR_ROWS = 50;
export const RERUN_ROWS = 200;
export const CEILING_ROWS = 1200;

export interface SpendPlan {
  reservedUsd: {
    or: number;
    length: number;
    containmentPerPair: number;
    ceiling: number;
  };
  containmentPairsAffordable: number;
  warnings: string[];
}

/**
 * What the chosen sections reserve within `limitUsd`, how many containment
 * pairs fit once the ceiling's share is kept, and plain warnings for a mix
 * that cannot all run. Runs go in order (or, length, containment, ceiling).
 */
export function planSpend(input: {
  sections: ReadonlySet<Section>;
  pairCount: number;
  limitUsd: number;
}): SpendPlan {
  const { sections, pairCount, limitUsd } = input;
  const or = sections.has('or') ? OR_RUNS * rowsCap(SMALL_ROWS) : 0;
  const length = sections.has('length') ? LENGTH_RUNS * rowsCap(SMALL_ROWS) : 0;
  const ceiling = sections.has('ceiling') ? rowsCap(CEILING_ROWS) : 0;
  const perPair = 2 * rowsCap(PAIR_ROWS);
  const left = limitUsd - or - length - ceiling;
  const affordable = sections.has('containment')
    ? Math.max(0, Math.floor((left + 1e-9) / perPair))
    : 0;
  const warnings: string[] = [];
  if (or + length > limitUsd + 1e-9)
    warnings.push(
      `or and length reserve ${(or + length).toFixed(2)} USD, over the ${limitUsd} USD limit: later runs will be refused.`,
    );
  if (sections.has('ceiling') && left < -1e-9)
    warnings.push(
      `The ceiling run reserves ${ceiling.toFixed(2)} USD and does not fit beside ${[
        ...sections,
      ]
        .filter((s) => s !== 'ceiling')
        .join(
          ', ',
        )} within ${limitUsd} USD: run it on its own with --sections ceiling.`,
    );
  if (sections.has('containment') && pairCount > 0) {
    if (affordable === 0)
      warnings.push(
        `No containment pair fits in what is left (${Math.max(0, left).toFixed(2)} USD, ${perPair.toFixed(2)} USD a pair).`,
      );
    else if (affordable < pairCount)
      warnings.push(
        `Only ${affordable} of ${pairCount} pairs fit; the rest are skipped in order. Narrow them with --pairs.`,
      );
  }
  return {
    reservedUsd: { or, length, containmentPerPair: perPair, ceiling },
    containmentPairsAffordable: affordable,
    warnings,
  };
}

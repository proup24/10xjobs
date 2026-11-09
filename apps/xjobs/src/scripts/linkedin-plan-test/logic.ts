/**
 * The pure decisions of the LinkedIn plan live test (`../linkedin-plan-test.ts`),
 * kept apart from its paid Apify runs so they can be unit tested.
 */
import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';
import { locationKey } from 'src/modules/queries/steps/normalize';

/** The most the whole test may spend across every run. */
export const TOTAL_BUDGET_USD = 1;

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

export type ContainmentVerdict = 'pass' | 'row-limit-cut' | 'fail' | 'invalid';

function time(value: string | null): number {
  return value === null ? Number.NaN : Date.parse(value);
}

/**
 * Whether the parent search holds the child's jobs. Missing ids all older than
 * the parent's oldest item mean the parent hit its row limit (rerun it with
 * more rows), not that the place does not contain the child.
 */
export function containmentVerdict(
  child: readonly DatedItem[],
  parent: readonly DatedItem[],
): { verdict: ContainmentVerdict; missing: string[] } {
  const parentIds = new Set(parent.map((item) => item.id));
  const missingItems = child.filter((item) => !parentIds.has(item.id));
  const missing = missingItems.map((item) => item.id);
  if (missing.length === 0) return { verdict: 'pass', missing };
  const parentTimes = parent.map((item) => time(item.publishedAt));
  const oldest = parentTimes.length > 0 ? Math.min(...parentTimes) : Number.NaN;
  const cut = missingItems.every((item) => time(item.publishedAt) < oldest);
  return { verdict: cut ? 'row-limit-cut' : 'fail', missing };
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
): { verdict: ContainmentVerdict; missing: string[] } {
  if (!child.ok || child.items.length === 0 || !parent.ok)
    return { verdict: 'invalid', missing: [] };
  return containmentVerdict(child.items, parent.items);
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

/** Reads an Apify run's final state; each flag is set on its own evidence. */
export function classifyRun(run: {
  status?: string;
  statusMessage?: string;
  exitCode?: number;
  error?: string;
}): RunOutcome {
  const text = `${run.statusMessage ?? ''} ${run.error ?? ''}`;
  return {
    ok: run.status === 'SUCCEEDED',
    memoryFailure:
      run.exitCode === 137 || /out of memory|\bmemory\b|\boom\b/i.test(text),
    chargeCapped:
      /(max(imum)?|cost|charge)\b.*\b(charge|cost|limit|reached)|charge limit|charge cap/i.test(
        text,
      ),
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

export function resolveGeo(
  place: string,
  overrides: ReadonlyMap<string, string>,
  pinned: Readonly<Record<string, string>>,
): { geoId: string | undefined; source: GeoSource } {
  const key = locationKey(place);
  const override = overrides.get(key);
  if (override) return { geoId: override, source: 'override' };
  const known = pinned[key];
  if (known) return { geoId: known, source: 'LINKEDIN_GEO_IDS' };
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
  child: string;
  parent: string;
}

/** The wide regions every place is checked against, in the order they run. */
export const FIXED_PARENTS = ['EMEA', 'Europe', 'LATAM', 'North Africa'];

export interface Geography {
  regions: { code: string; label: string }[];
  countries: { code: string; label: string }[];
  cities: { name: string; countryCode: string }[];
  links: { regionCode: string; countryCode: string }[];
}

/**
 * Candidate containment pairs: each place (a country or `city, country`) with
 * its country (for a city), the regions containing its country, and the fixed
 * wide regions. Regions and places that match nothing are skipped.
 */
export function buildPairs(
  places: readonly string[],
  geography: Geography,
): Pair[] {
  const pairs = new Map<string, Pair>();
  const add = (child: string, parent: string) => {
    if (child.toLowerCase() === parent.toLowerCase()) return;
    pairs.set(`${child}|${parent}`.toLowerCase(), { child, parent });
  };
  const regionLabels = new Set(
    geography.regions.map((r) => r.label.toLowerCase()),
  );
  const labelOf = (code: string) =>
    geography.countries.find((c) => c.code === code)?.label;
  for (const place of places) {
    if (regionLabels.has(place.toLowerCase())) continue;
    const country = geography.countries.find(
      (c) =>
        c.label.toLowerCase() === place.toLowerCase() ||
        c.code.toLowerCase() === place.toLowerCase(),
    );
    const city = geography.cities.find(
      (c) =>
        `${c.name}, ${labelOf(c.countryCode) ?? ''}`.toLowerCase() ===
        place.toLowerCase(),
    );
    const countryCode = country?.code ?? city?.countryCode;
    if (!countryCode) continue;
    if (city) {
      const owner = labelOf(city.countryCode);
      if (owner) add(place, owner);
    }
    for (const link of geography.links) {
      if (link.countryCode !== countryCode) continue;
      const region = geography.regions.find((r) => r.code === link.regionCode);
      if (region) add(place, region.label);
    }
    for (const parent of FIXED_PARENTS) add(place, parent);
  }
  return [...pairs.values()];
}

/** Fixed parents first (EMEA first), so a budget stop loses the least useful pairs. */
export function orderPairs(pairs: readonly Pair[]): Pair[] {
  const rank = (pair: Pair) => {
    const at = FIXED_PARENTS.findIndex(
      (fixed) => fixed.toLowerCase() === pair.parent.toLowerCase(),
    );
    return at === -1 ? FIXED_PARENTS.length : at;
  };
  return pairs
    .map((pair, index) => ({ pair, index }))
    .sort((a, b) => rank(a.pair) - rank(b.pair) || a.index - b.index)
    .map(({ pair }) => pair);
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

/**
 * The pure decisions of the LinkedIn plan live test (`../linkedin-plan-test.ts`),
 * kept apart from its paid Apify runs so they can be unit tested.
 */
import { TECHNOLOGY_TERMS } from 'src/modules/queries/builders/keywords';

/** The most the whole test may spend across every run. */
export const TOTAL_BUDGET_USD = 1;

export interface Budget {
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
        throw new Error(
          `Budget exceeded: ${reserved.toFixed(2)} spent + ${maxTotalChargeUsd.toFixed(2)} cap > ${limitUsd} USD`,
        );
      reserved += maxTotalChargeUsd;
    },
    spent: () => reserved,
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

export type ContainmentVerdict = 'pass' | 'row-limit-cut' | 'fail';

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

import type { ValueLists } from '@/lib/setup/value-lists';

/** The code to label lookups the check wording needs: the value lists the app already loads. */
export type Labels = Pick<
  ValueLists,
  'positions' | 'seniorities' | 'techs' | 'countries' | 'regions' | 'cities'
>;

export type CheckLine = {
  rule: 'position' | 'seniority' | 'location' | 'stack';
  mark: 'pass' | 'unknown';
  text: string;
};

const RULES: readonly CheckLine['rule'][] = [
  'position',
  'seniority',
  'location',
  'stack',
];

/** Every code in the lists mapped to its label, so a reason can be reworded. */
function labelMap(labels: Labels): Map<string, string> {
  const m = new Map<string, string>();
  for (const list of [
    labels.positions,
    labels.seniorities,
    labels.techs,
    labels.countries,
    labels.regions,
  ]) {
    for (const o of list) m.set(o.value, o.label);
  }
  return m;
}

/**
 * One line per rule the matcher ran, from its outcome and reason, with codes such as
 * `fullstack_engineer` replaced by their labels. Rules this page does not know are skipped.
 */
export function checkLines(checks: unknown, labels: Labels): CheckLine[] {
  if (!Array.isArray(checks)) return [];
  const names = labelMap(labels);
  const lines: CheckLine[] = [];
  for (const c of checks) {
    if (typeof c !== 'object' || c === null) continue;
    const { rule, outcome, reason } = c as Record<string, unknown>;
    if (!RULES.includes(rule as CheckLine['rule'])) continue;
    if (typeof reason !== 'string') continue;
    const text = reason.replace(/[A-Za-z0-9_]+/g, (w) => names.get(w) ?? w);
    lines.push({
      rule: rule as CheckLine['rule'],
      mark: outcome === 'pass' ? 'pass' : 'unknown',
      text: text.charAt(0).toUpperCase() + text.slice(1),
    });
  }
  return lines;
}

/**
 * What the matcher does not look at yet. Keep this beside the matcher's rules in mind:
 * slices 08 and 09 remove entries as the matcher gains rules, so update it in this one place.
 */
export const NOT_CHECKED = [
  'salary',
  'contract type',
  'engagement',
  'required languages',
  'work authorization',
  'residence',
] as const;

export function notCheckedText(): string {
  const head = NOT_CHECKED.slice(0, -1).join(', ');
  const last = NOT_CHECKED[NOT_CHECKED.length - 1];
  return `Not checked yet: ${head} and ${last}. Check these in the post.`;
}

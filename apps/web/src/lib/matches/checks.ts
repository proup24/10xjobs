import type { ValueLists } from '@/lib/setup/value-lists';

/** The code to label lookups the check wording needs: the value lists the app already loads. */
export type Labels = Pick<
  ValueLists,
  'positions' | 'seniorities' | 'techs' | 'countries' | 'regions' | 'cities'
>;

/** Each rule the matcher runs, in the order it runs them, with its plain-English name. */
const RULE_LABELS = {
  position: 'Position',
  seniority: 'Seniority',
  location: 'Location',
  stack: 'Stack',
  salary: 'Salary',
  currency: 'Currency',
  contractType: 'Contract type',
  languages: 'Languages',
  postingLanguage: 'Posting language',
  workAuthorization: 'Work authorization',
} as const;

export type CheckLine = {
  rule: keyof typeof RULE_LABELS;
  label: string;
  mark: 'pass' | 'unknown';
  text: string;
};

const isRule = (rule: unknown): rule is CheckLine['rule'] =>
  typeof rule === 'string' && Object.hasOwn(RULE_LABELS, rule);

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
    if (!isRule(rule)) continue;
    if (typeof reason !== 'string') continue;
    const text = reason.replace(/[A-Za-z0-9_]+/g, (w) => names.get(w) ?? w);
    lines.push({
      rule,
      label: RULE_LABELS[rule],
      mark: outcome === 'pass' ? 'pass' : 'unknown',
      text: text.charAt(0).toUpperCase() + text.slice(1),
    });
  }
  return lines;
}

/**
 * What the matcher does not look at yet. Keep this beside the matcher's rules in mind:
 * remove an entry when the matcher gains its rule, in this one place.
 */
export const NOT_CHECKED: readonly string[] = ['engagement'];

export function notCheckedText(): string {
  if (NOT_CHECKED.length === 1)
    return `Not checked yet: ${NOT_CHECKED[0]}. Check it in the post.`;
  const head = NOT_CHECKED.slice(0, -1).join(', ');
  const last = NOT_CHECKED[NOT_CHECKED.length - 1];
  return `Not checked yet: ${head} and ${last}. Check these in the post.`;
}

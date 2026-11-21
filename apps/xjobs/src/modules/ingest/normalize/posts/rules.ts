/** What a drop rule sees: the original post's text and its author's headline. */
export type RuleInput = { text: string; headline: string | null };

/** A rule that finds posts not worth preparing; `match` returns the span or null. */
export type DropRule = {
  name: string;
  match(input: RuleInput): string | null;
};

/** No rules yet: they wait for real posts. */
export const DROP_RULES: readonly DropRule[] = [];

/** The first rule that matches, with its match trimmed to 80 characters. */
export function firstDrop(
  input: RuleInput,
): { rule: string; match: string } | null {
  for (const rule of DROP_RULES) {
    const match = rule.match(input);
    if (match !== null) return { rule: rule.name, match: match.slice(0, 80) };
  }
  return null;
}

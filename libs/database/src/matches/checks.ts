/** The code to label lookups the check wording needs. */
export type Labels = Record<
  | 'positions'
  | 'seniorities'
  | 'techs'
  | 'countries'
  | 'regions'
  | 'cities'
  | 'languages'
  | 'currencies'
  | 'contractTypes',
  { value: string; label: string }[]
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
  mark: 'pass' | 'fail' | 'unknown';
  /** The outcome rests on a value the processor was unsure of (marks a match unverified). */
  unsure: boolean;
  text: string;
};

const isRule = (rule: unknown): rule is CheckLine['rule'] =>
  typeof rule === 'string' && Object.hasOwn(RULE_LABELS, rule);

/** The rule's plain-English name, or null for a rule this page does not know. */
export function ruleLabel(rule: unknown): string | null {
  return isRule(rule) ? RULE_LABELS[rule] : null;
}

/**
 * The facts a check can rest on (the matcher's `unsureField`), named for people. Every
 * field but `isSoftwareEngineeringRole` is a key of the row's `facts`.
 */
const FIELD_LABELS: Record<string, string> = {
  position: 'Role',
  isSoftwareEngineeringRole: 'Whether it is a software engineering role',
  seniority: 'Seniority',
  yearsRequired: 'Years of experience required',
  openings: 'Where and how you work',
  techStack: 'Tech stack',
  salary: 'Salary',
  contractType: 'Contract type',
  requiredLanguages: 'Required languages',
  workAuthorization: 'Work authorization',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Norwegian `no`/`nb`/`nn` name one language, as in the matcher; every other code is exact. */
const SAME_LANGUAGE: Record<string, string> = {
  no: 'no',
  nb: 'no',
  nn: 'no',
};
const family = (code: string) => SAME_LANGUAGE[code] ?? code;

type Lang = { lang: string; level: string };
const isLangs = (v: unknown): v is Lang[] =>
  Array.isArray(v) &&
  v.every(
    (l) =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as Lang).lang === 'string' &&
      typeof (l as Lang).level === 'string',
  );
const isCodes = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * The rules whose reasons name language, currency or contract codes, worded again from the
 * check's structured values (the matcher's own sentences, rules/*.ts), with labels for the
 * codes. Codes such as `it` or `no` are also English words, so the reason text is never
 * rewritten word by word. Null keeps the matcher's reason: an outcome or shape this does not
 * know, or a sentence with no code in it.
 */
function structuredText(
  c: Record<string, unknown>,
  labels: Labels,
): string | null {
  const name = (list: { value: string; label: string }[]) => {
    const m = new Map(list.map((o) => [o.value, o.label]));
    return (code: string) => m.get(code) ?? code;
  };
  const { rule, outcome, jobValue, profileValue } = c;
  if (rule === 'languages' && isLangs(jobValue) && jobValue.length > 0) {
    const lang = name(labels.languages);
    if (outcome === 'pass') {
      const asked = jobValue.map((r) => `${lang(r.lang)} (${r.level})`);
      return `you speak every required language: ${asked.join(', ')}`;
    }
    if (outcome === 'fail' && isLangs(profileValue)) {
      const rank: Record<string, number> = { working: 0, fluent: 1, native: 2 };
      const held = new Map(profileValue.map((l) => [l.lang, l.level]));
      const short = jobValue.flatMap(({ lang: code, level }) => {
        const have = held.get(code);
        if (have === undefined)
          return [`${lang(code)} (${level}; you don't speak it)`];
        return (rank[have] ?? 0) < (rank[level] ?? 0)
          ? [`${lang(code)} (${level}; you have ${have})`]
          : [];
      });
      return short.length ? `job requires ${short.join(', ')}` : null;
    }
    return null;
  }
  if (rule === 'postingLanguage') {
    const value = jobValue as {
      codes?: unknown;
      closeCalls?: unknown;
      confident?: unknown;
    } | null;
    const codes = value?.codes;
    // Not confident: the matcher's reason says so, whatever was detected.
    if (value?.confident === false) return null;
    // Rows written before close calls existed have none.
    const closeCalls =
      Array.isArray(value?.closeCalls) && value.closeCalls.every(isCodes)
        ? value.closeCalls
        : [];
    if (!isCodes(codes) || (codes.length === 0 && closeCalls.length === 0))
      return null;
    const lang = name(labels.languages);
    if (outcome === 'fail') {
      const written = [
        ...codes.map(lang),
        ...closeCalls.map((set) => `one of ${set.map(lang).join('/')}`),
      ];
      return `posting is written in ${written.join(', ')}, which you don't speak`;
    }
    if (outcome === 'unknown' && isCodes(profileValue)) {
      const spoken = new Set(profileValue.map(family));
      const doubtful = closeCalls.find((set) =>
        set.some((x) => spoken.has(family(x))),
      );
      return doubtful
        ? `posting is in one of ${doubtful.map(lang).join(', ')}; can't tell which`
        : null;
    }
    if (outcome === 'pass' && isCodes(profileValue)) {
      const spoken = new Set(profileValue.map(family));
      const shared = codes.filter((x) => spoken.has(family(x)));
      return shared.length
        ? `posting is written in ${shared.map(lang).join(', ')}, which you speak`
        : null;
    }
    return null;
  }
  if (rule === 'currency' && typeof jobValue === 'string') {
    const cur = name(labels.currencies);
    if (outcome === 'pass' && isCodes(profileValue))
      return `job pays in ${cur(jobValue)}, which you accept`;
    if (outcome === 'fail' && isCodes(profileValue))
      return `job pays in ${cur(jobValue)}; you accept ${profileValue.map(cur).join(', ')}`;
    return null;
  }
  if (
    rule === 'contractType' &&
    typeof jobValue === 'string' &&
    isCodes(profileValue) &&
    (outcome === 'pass' || outcome === 'fail')
  ) {
    const ct = name(labels.contractTypes);
    const wanted = profileValue.map(ct).join(', ');
    return outcome === 'pass'
      ? `job contract ${ct(jobValue)} is in your contract types: ${wanted}`
      : `job contract ${ct(jobValue)} is not in your contract types: ${wanted}`;
  }
  return null;
}

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
    const check = c as Record<string, unknown>;
    const { rule, outcome, reason, unsure } = check;
    if (!isRule(rule)) continue;
    if (typeof reason !== 'string') continue;
    const text =
      structuredText(check, labels) ??
      reason.replace(/[A-Za-z0-9_]+/g, (w) => names.get(w) ?? w);
    lines.push({
      rule,
      label: RULE_LABELS[rule],
      mark:
        outcome === 'pass' ? 'pass' : outcome === 'fail' ? 'fail' : 'unknown',
      unsure: unsure === true,
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

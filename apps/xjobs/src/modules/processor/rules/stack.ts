import { IMPORTANCE_BANDS, type TechStack } from '../schema/shared';

export interface StackIssue {
  /** Path inside `techStack.value`. */
  path: (string | number)[];
  message: string;
}

/** The rules the stack's shape cannot express (spec §5a); empty means valid. */
export function stackIssues(stack: TechStack): StackIssue[] {
  const issues: StackIssue[] = [];
  const groupIds = new Set<string>();
  stack.groups.forEach((g, j) => {
    if (groupIds.has(g.id))
      issues.push({
        path: ['groups', j, 'id'],
        message: `duplicate group "${g.id}"`,
      });
    groupIds.add(g.id);
  });

  const seen = new Set<string>();
  stack.requirements.forEach((r, i) => {
    const [low, high] = IMPORTANCE_BANDS[r.kind];
    if (r.importance < low || r.importance > high) {
      issues.push({
        path: ['requirements', i, 'importance'],
        message: `a ${r.kind} requirement has importance ${low}-${high}, got ${r.importance}`,
      });
    }
    if (
      r.years?.min != null &&
      r.years.max != null &&
      r.years.max < r.years.min
    ) {
      issues.push({
        path: ['requirements', i, 'years', 'max'],
        message: 'max must be >= min',
      });
    }
    if (r.group !== null && !groupIds.has(r.group)) {
      issues.push({
        path: ['requirements', i, 'group'],
        message: `group "${r.group}" is not in groups`,
      });
    }
    const tech =
      r.technology.code ?? `text:${r.technology.text.trim().toLowerCase()}`;
    const key = `${tech}|${r.domain ?? ''}`;
    if (seen.has(key)) {
      issues.push({
        path: ['requirements', i, 'technology'],
        message: `"${r.technology.code ?? r.technology.text}" with domain ${r.domain ?? 'null'} appears twice`,
      });
    }
    seen.add(key);
  });

  stack.groups.forEach((g, j) => {
    const members = stack.requirements.filter((r) => r.group === g.id);
    if (members.length < 2) {
      issues.push({
        path: ['groups', j],
        message: `group "${g.id}" needs at least 2 members, has ${members.length}`,
      });
    } else if (g.min > members.length) {
      issues.push({
        path: ['groups', j, 'min'],
        message: `group "${g.id}" has min ${g.min} but ${members.length} members`,
      });
    }
    if (new Set(members.map((r) => r.kind)).size > 1) {
      issues.push({
        path: ['groups', j],
        message: `members of group "${g.id}" have different kinds`,
      });
    }
  });
  return issues;
}

/** Each message is `techStack.value.<path>: <reason>`. Empty means valid. */
export function stackErrors(stack: TechStack): string[] {
  return stackIssues(stack).map(
    (i) => `techStack.value.${i.path.join('.')}: ${i.message}`,
  );
}

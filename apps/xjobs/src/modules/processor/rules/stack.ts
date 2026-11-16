import {
  IMPORTANCE_BANDS,
  type Requirement,
  type TechStack,
} from '../schema/shared';

export interface StackIssue {
  /** Path inside `techStack.value`. */
  path: (string | number)[];
  message: string;
}

/** The technology part of a requirement's duplicate key: its code, or its normalized text. */
function technologyKey(r: Requirement): string {
  return r.technology.code ?? `text:${r.technology.text.trim().toLowerCase()}`;
}

/** Two requirements with the same key are duplicates. */
function requirementKey(r: Requirement): string {
  return `${technologyKey(r)}|${r.domain ?? ''}`;
}

const KIND_RANK: Record<Requirement['kind'], number> = {
  main: 3,
  must: 2,
  nice: 1,
};

/** True when `a` should be kept over `b`: stronger kind, then higher importance. */
function isStronger(a: Requirement, b: Requirement): boolean {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] > KIND_RANK[b.kind];
  return a.importance > b.importance;
}

export interface MergedStack {
  stack: TechStack;
  /** One entry per dropped copy: its key's technology, code or `text:<text>`. */
  dropped: string[];
}

/**
 * Collapses clear duplicate requirements (same key). Copies are merged only
 * within one place: among the standalone ones (strongest kept, earlier on a
 * tie) or inside a single group (first kept). A technology listed in two
 * places is left for `stackIssues` to reject. The dropped copy is not merged
 * into the kept one. A group left with one member is dissolved; a group's
 * `min` is lowered to its member count. The input is not mutated.
 */
export function mergeDuplicateRequirements(stack: TechStack): MergedStack {
  const dropped: string[] = [];
  let requirements = structuredClone(stack.requirements);
  let groups = structuredClone(stack.groups);

  // Step 1: inside each group keep the first copy; dissolve groups left with one member.
  const touchedGroups = new Set<string>();
  const seenInGroup = new Set<string>();
  requirements = requirements.filter((r) => {
    if (r.group === null) return true;
    const key = `${r.group}\u0000${requirementKey(r)}`;
    if (!seenInGroup.has(key)) {
      seenInGroup.add(key);
      return true;
    }
    touchedGroups.add(r.group);
    dropped.push(technologyKey(r));
    return false;
  });
  groups = groups.filter((g) => {
    if (!touchedGroups.has(g.id)) return true;
    const members = requirements.filter((r) => r.group === g.id);
    if (members.length < 2) {
      members.forEach((m) => (m.group = null));
      return false;
    }
    g.min = Math.min(g.min, members.length);
    return true;
  });

  // Step 2: among the standalone copies (including dissolved members) keep the strongest.
  const keepers = new Map<string, Requirement>();
  for (const r of requirements) {
    if (r.group !== null) continue;
    const key = requirementKey(r);
    const kept = keepers.get(key);
    if (kept === undefined || isStronger(r, kept)) keepers.set(key, r);
  }
  requirements = requirements.filter((r) => {
    if (r.group !== null || keepers.get(requirementKey(r)) === r) return true;
    dropped.push(technologyKey(r));
    return false;
  });

  return { stack: { requirements, groups }, dropped };
}

/** Where a requirement sits: `on its own`, or its group id. */
function placeOf(r: Requirement): string {
  return r.group === null ? 'on its own' : `group ${r.group}`;
}

/** The duplicate message: names both texts, their places, and the shared technology and domain. */
function duplicateMessage(
  first: Requirement,
  j: number,
  later: Requirement,
  i: number,
): string {
  const tech = later.technology.code ?? first.technology.text.trim();
  const domain =
    later.domain === null ? 'with no domain' : `in domain ${later.domain}`;
  return `"${first.technology.text.trim()}" (requirements.${j}, ${placeOf(first)}) and "${later.technology.text.trim()}" (requirements.${i}, ${placeOf(later)}) are the same technology (${tech}) ${domain}; list it once`;
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

  const firstIndex = new Map<string, number>();
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
    const key = requirementKey(r);
    const first = firstIndex.get(key);
    if (first !== undefined) {
      issues.push({
        path: ['requirements', i, 'technology'],
        message: duplicateMessage(stack.requirements[first], first, r, i),
      });
    } else {
      firstIndex.set(key, i);
    }
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

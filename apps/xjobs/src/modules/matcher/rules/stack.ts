import type { Requirement, TechStack } from 'src/modules/processor/schema';
import { MIN_STACK_SCORE } from '../config/matcher.config';
import { restsOn, type Check, type Confidence, type MatchSkill } from './types';

/** tech tag code -> codes it implies (tech_tags.implies). */
export type ImpliesMap = Map<string, string[]>;

type Kind = Requirement['kind'];
const KIND_RANK: Record<Kind, number> = { main: 2, must: 1, nice: 0 };

interface Unit {
  kind: Kind;
  importance: number;
  min: number;
  /** Members that carry a code. */
  codes: string[];
  /** Whether any member requirement is unsure. */
  unsure: boolean;
}

function masteryByCode(
  skills: MatchSkill[],
  implies: ImpliesMap,
): Map<string, number> {
  const out = new Map<string, number>();
  const put = (code: string, mastery: number) => {
    if (mastery > (out.get(code) ?? -1)) out.set(code, mastery);
  };
  for (const s of skills) {
    put(s.technology, s.mastery);
    for (const implied of implies.get(s.technology) ?? [])
      put(implied, s.mastery);
  }
  return out;
}

/**
 * Scores the scored units given each unit's mastery (null when uncovered): they pass when
 * some main unit is covered (when there are main units) and the score reaches the minimum.
 */
function evaluate(
  scored: Unit[],
  masteryOf: (u: Unit) => number | null,
): { score: number; noMainCovered: boolean; pass: boolean } {
  const mains = scored.filter((u) => u.kind === 'main');
  const noMainCovered =
    mains.length > 0 && mains.every((u) => masteryOf(u) === null);
  let earned = 0;
  let total = 0;
  for (const u of scored) {
    total += u.importance;
    earned += u.importance * ((masteryOf(u) ?? 0) / 10);
  }
  const score = Math.round((earned / total) * 1000) / 1000;
  return {
    score,
    noMainCovered,
    pass: !noMainCovered && score >= MIN_STACK_SCORE,
  };
}

/**
 * `confidence` is the tech stack fact's own: an unsure fact makes any outcome rest on it.
 * Otherwise a failure is unsure only when it might not hold: counting every unit with an
 * unsure requirement as covered at mastery 10 (the most favourable case), the stack would
 * pass. A pass is unsure when a covered unit has an unsure requirement.
 */
export function checkStack(
  stack: TechStack | null,
  skills: MatchSkill[],
  implies: ImpliesMap,
  confidence: Confidence = 'sure',
): { check: Check; score: number | null } {
  const profileValue = skills.map((s) => s.technology);
  const unknown = (reason: string, notComparable: string[] = []) => ({
    check: {
      rule: 'stack',
      outcome: 'unknown',
      jobValue: stack?.requirements.map((r) => r.technology.code) ?? null,
      profileValue,
      reason,
      unsure: false,
      unsureField: null,
      detail: {
        covered: [],
        uncovered: [],
        niceCovered: [],
        notComparable,
        score: null,
      },
    } satisfies Check,
    score: null,
  });

  if (!stack || stack.requirements.length === 0) {
    return unknown('job lists no tech requirements to compare');
  }

  const mastery = masteryByCode(skills, implies);
  const minOf = new Map(stack.groups.map((g) => [g.id, g.min]));
  const notComparable: string[] = [];
  const units = new Map<string, Unit>();
  stack.requirements.forEach((r, i) => {
    const key = r.group === null ? `#${i}` : `g:${r.group}`;
    let unit = units.get(key);
    if (!unit) {
      unit = {
        kind: r.kind,
        importance: r.importance,
        min: r.group === null ? 1 : (minOf.get(r.group) ?? 1),
        codes: [],
        unsure: false,
      };
      units.set(key, unit);
    }
    if (KIND_RANK[r.kind] > KIND_RANK[unit.kind]) unit.kind = r.kind;
    unit.importance = Math.max(unit.importance, r.importance);
    if (r.confidence === 'unsure') unit.unsure = true;
    if (r.technology.code === null) notComparable.push(r.technology.text);
    else unit.codes.push(r.technology.code);
  });

  const comparable = [...units.values()].filter((u) => u.codes.length > 0);
  const label = (u: Unit) => u.codes.join(' or ');
  const coveredMastery = (u: Unit): number | null => {
    const have = u.codes.filter((c) => mastery.has(c));
    if (have.length < u.min) return null;
    return Math.max(...have.map((c) => mastery.get(c) ?? 0));
  };

  const scored = comparable.filter((u) => u.kind !== 'nice');
  const niceCovered = comparable
    .filter((u) => u.kind === 'nice' && coveredMastery(u) !== null)
    .map(label);
  if (scored.length === 0) {
    return unknown(
      'job has no comparable main or must requirements',
      notComparable,
    );
  }

  const covered: string[] = [];
  const uncovered: string[] = [];
  const scoredUnits = scored.map((u) => {
    const m = coveredMastery(u);
    (m === null ? uncovered : covered).push(label(u));
    return { unit: label(u), importance: u.importance, mastery: m };
  });
  const { score, noMainCovered } = evaluate(scored, coveredMastery);
  const mainUnits = scored.filter((u) => u.kind === 'main');

  let outcome: Check['outcome'] = 'pass';
  let reason = `job stack covered at ${score}: ${covered.join(', ') || 'none'}`;
  if (noMainCovered) {
    outcome = 'fail';
    reason = `none of the job's main technologies are in your stack: ${mainUnits.map(label).join(', ')}`;
  } else if (score < MIN_STACK_SCORE) {
    outcome = 'fail';
    reason =
      uncovered.length > 0
        ? `stack coverage ${score} is below ${MIN_STACK_SCORE}; missing ${uncovered.join(', ')}`
        : `stack coverage ${score} is below ${MIN_STACK_SCORE}; every technology is covered but your mastery is low`;
  }
  const unsure =
    confidence === 'unsure' ||
    (outcome === 'pass'
      ? scored.some((u) => u.unsure && coveredMastery(u) !== null)
      : evaluate(scored, (u) => (u.unsure ? 10 : coveredMastery(u))).pass);

  return {
    check: {
      rule: 'stack',
      outcome,
      jobValue: scored.map(label),
      profileValue,
      reason,
      ...restsOn(unsure ? 'techStack' : null),
      detail: {
        covered,
        uncovered,
        niceCovered,
        notComparable,
        score,
        units: scoredUnits,
      },
    },
    score,
  };
}

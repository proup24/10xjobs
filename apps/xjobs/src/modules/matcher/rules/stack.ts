import type { Requirement, TechStack } from 'src/modules/processor/schema';
import { MIN_STACK_SCORE } from '../config/matcher.config';
import type { Check, Confidence, MatchSkill } from './types';

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
 * `confidence` is the tech stack fact's own: an unsure fact makes any outcome rest on it.
 * Otherwise a failure is unsure when a main or must unit that decided it has an unsure member.
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
  const scoredUnits: {
    unit: string;
    importance: number;
    mastery: number | null;
  }[] = [];
  let earned = 0;
  let total = 0;
  for (const u of scored) {
    const m = coveredMastery(u);
    scoredUnits.push({ unit: label(u), importance: u.importance, mastery: m });
    total += u.importance;
    if (m === null) uncovered.push(label(u));
    else {
      covered.push(label(u));
      earned += u.importance * (m / 10);
    }
  }
  const score = Math.round((earned / total) * 1000) / 1000;

  const mainUnits = scored.filter((u) => u.kind === 'main');
  const noMainCovered =
    mainUnits.length > 0 && mainUnits.every((u) => coveredMastery(u) === null);

  let outcome: Check['outcome'] = 'pass';
  let reason = `job stack covered at ${score}: ${covered.join(', ') || 'none'}`;
  // The units the outcome rests on: the covered ones for a pass, the missing ones for a fail.
  let deciding = scored.filter((u) => coveredMastery(u) !== null);
  if (noMainCovered) {
    outcome = 'fail';
    reason = `none of the job's main technologies are in your stack: ${mainUnits.map(label).join(', ')}`;
    deciding = mainUnits;
  } else if (score < MIN_STACK_SCORE) {
    outcome = 'fail';
    reason =
      uncovered.length > 0
        ? `stack coverage ${score} is below ${MIN_STACK_SCORE}; missing ${uncovered.join(', ')}`
        : `stack coverage ${score} is below ${MIN_STACK_SCORE}; every technology is covered but your mastery is low`;
    const missing = scored.filter((u) => coveredMastery(u) === null);
    deciding = missing.length > 0 ? missing : scored;
  }
  const unsure = confidence === 'unsure' || deciding.some((u) => u.unsure);

  return {
    check: {
      rule: 'stack',
      outcome,
      jobValue: scored.map(label),
      profileValue,
      reason,
      unsure,
      unsureField: unsure ? 'techStack' : null,
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

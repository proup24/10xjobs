import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence } from '../models/types';
import type { SKILL_DOMAINS } from '../schema/shared';

/** Golden labels drafted by a model, which count once a human reviews them. */
export type LabelKey =
  | 'arrangement'
  | 'contractType'
  | 'isSoftwareEngineeringRole'
  | 'engagement';
/**
 * `requirements` marks the requirements' `domain` and `years` as not yet
 * labeled (the conversion set them to null); its value is unused.
 */
export type DraftedKey = LabelKey | 'requirements';

export type GoldenPlace =
  | { kind: 'worldwide' }
  | { kind: 'region'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'city'; name: string; countryCode: string | null };

export interface GoldenTerm {
  text: string;
  code: string | null;
}

export type SkillDomain = (typeof SKILL_DOMAINS)[number];
export type RequirementKind = 'main' | 'must' | 'nice';
export interface GoldenRange {
  min: number | null;
  max: number | null;
}

/** One technology the posting asks for; members of one `group` are alternatives. */
export interface GoldenRequirement {
  text: string;
  /** Null when the term is not in the vocabulary; scoring counts codes only. */
  code: string | null;
  kind: RequirementKind;
  domain: SkillDomain | null;
  years: GoldenRange | null;
  group: string | null;
}

/** The values (no envelopes) of the spec section 5 facts, in xjobs codes. */
export interface GoldenFacts {
  roleKind: string;
  seniority: string;
  yearsRequired: GoldenRange | null;
  contractMonths: number | null;
  openings: {
    arrangements: string[];
    places: GoldenPlace[];
    placeStrictness: string;
  }[];
  requirements: GoldenRequirement[];
  groups: { id: string; min: number }[];
  requiredLanguages: { lang: string; level: string }[];
  sponsorship: 'yes' | 'no' | 'unstated';
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: string;
  } | null;
  junkFlags: string[];
  // Not in career-hub's golden values: drafted, then reviewed by a human.
  arrangement: string;
  contractType: string;
  isSoftwareEngineeringRole: boolean;
  engagement: string;
}

export interface GoldenCase {
  id: string;
  input: {
    title: string;
    companyName: string;
    description: string;
    evidence: Evidence;
  };
  expected: Partial<GoldenFacts>;
  /** A drafted value counts only once a human sets `reviewed: true`. */
  drafted: Partial<Record<DraftedKey, { value: unknown; reviewed: boolean }>>;
}

export const GOLDEN_CASES_DIR = join(__dirname, 'cases');

/** Every case in `cases/`, ordered by file name. */
export function loadGolden(dir: string = GOLDEN_CASES_DIR): GoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenCase);
}

/** career-hub's stack sections, and the requirement kind each becomes. */
const V1_STACKS = [
  ['mainStack', 'main'],
  ['mustHaves', 'must'],
  ['niceToHaves', 'nice'],
] as const;

type V1Group = { anyOf: GoldenTerm[] };

/**
 * career-hub's anyOf groups as requirements: a one-option group is a
 * standalone requirement, a group of several becomes a group with `min: 1`.
 * `domain` and `years` stay null until a human labels them.
 */
export function requirementsFromGroups(
  stacks: Partial<Record<RequirementKind, V1Group[]>>,
): Pick<GoldenFacts, 'requirements' | 'groups'> {
  const requirements: GoldenRequirement[] = [];
  const groups: GoldenFacts['groups'] = [];
  for (const [, kind] of V1_STACKS)
    for (const g of stacks[kind] ?? []) {
      const id = g.anyOf.length > 1 ? `g${groups.length + 1}` : null;
      if (id) groups.push({ id, min: 1 });
      for (const t of g.anyOf)
        requirements.push({
          text: t.text,
          code: t.code,
          kind,
          domain: null,
          years: null,
          group: id,
        });
    }
  return { requirements, groups };
}

/** Whole years to a range: 3 -> `{ min: 3, max: null }`. */
export const yearsRange = (n: number | null): GoldenRange | null =>
  n === null ? null : { min: n, max: null };

/**
 * Moves a case to the requirements shape (generate-then-verify spec section
 * 5a): `mainStack`/`mustHaves`/`niceToHaves` become `requirements` and
 * `groups`, and a whole `yearsRequired` becomes a range. Idempotent: an
 * already-converted case comes back unchanged.
 */
export function convertGoldenCase(raw: unknown): GoldenCase {
  const c = raw as GoldenCase;
  const old = c.expected as Record<string, unknown>;
  const isStack = (key: string) => V1_STACKS.some(([k]) => k === key);
  const hasStack = Object.keys(old).some(isStack);
  const stack = requirementsFromGroups(
    Object.fromEntries(
      V1_STACKS.map(([k, kind]) => [kind, (old[k] ?? []) as V1Group[]]),
    ),
  );
  const expected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(old)) {
    if (key === 'yearsRequired')
      expected[key] = typeof value === 'number' ? yearsRange(value) : value;
    // The requirements take the place of the first stack section.
    else if (isStack(key)) Object.assign(expected, stack);
    else expected[key] = value;
  }
  const drafted = { ...c.drafted };
  if (hasStack && !drafted.requirements)
    drafted.requirements = { value: null, reviewed: false };
  return { ...c, expected: expected as Partial<GoldenFacts>, drafted };
}

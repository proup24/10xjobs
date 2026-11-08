import { z } from 'zod';
import { confidenceSchema } from './fact';

export const PLACE_STRICTNESS = [
  'limit',
  'label',
  'mention',
  'unstated',
] as const;

export const utcOffset = z.number().min(-12).max(14);

export const timezoneSchema = z.strictObject({
  fromUtc: utcOffset,
  toUtc: utcOffset,
  label: z.string().min(1),
});

export const termSchema = z.strictObject({
  text: z.string().min(1),
  code: z.string().nullable(),
});

/** The contract's `SkillDomain` codes, the same values `ProfileSkill.domain` uses. */
export const SKILL_DOMAINS = [
  'backend',
  'frontend',
  'fullstack',
  'mobile',
  'devops',
  'data',
  'ml',
  'security',
  'qa',
] as const;

/** The importance a requirement of each kind may have, inclusive. */
export const IMPORTANCE_BANDS = {
  main: [8, 10],
  must: [5, 9],
  nice: [1, 4],
} as const;

/** "3+ years" -> `{ min: 3, max: null }`; "3-5 years" -> `{ min: 3, max: 5 }`. */
export const rangeSchema = z.strictObject({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
});

/** One technology the posting asks for. Requirements sharing a `group` are alternatives. */
export const requirementSchema = z.strictObject({
  technology: termSchema,
  kind: z.enum(['main', 'must', 'nice']),
  importance: z.number().int().min(1).max(10),
  domain: z.enum(SKILL_DOMAINS).nullable(),
  years: rangeSchema.nullable(),
  quote: z.string(),
  confidence: confidenceSchema,
  group: z.string().min(1).nullable(),
});

/** A group is satisfied when `min` of its members are. */
export const requirementGroupSchema = z.strictObject({
  id: z.string().min(1),
  min: z.number().int().min(1),
});

export const techStackSchema = z.strictObject({
  requirements: z.array(requirementSchema),
  groups: z.array(requirementGroupSchema),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type RequirementGroup = z.infer<typeof requirementGroupSchema>;
export type TechStack = z.infer<typeof techStackSchema>;

export const languageSchema = z.strictObject({
  lang: z.string().regex(/^[a-z]{2}$/),
  level: z.enum(['native', 'fluent', 'working']),
  quote: z.string(),
});

export const salarySchema = z.strictObject({
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(['hour', 'day', 'month', 'year']),
});

export const workAuthorizationSchema = z.strictObject({
  requirements: z.array(
    z.strictObject({
      kind: z.enum(['work-permit', 'citizenship', 'residency', 'clearance']),
      place: z.string().min(1),
    }),
  ),
  sponsorship: z.enum(['yes', 'no', 'unstated']),
});

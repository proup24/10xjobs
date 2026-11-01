import { z } from 'zod';

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

export const groupSchema = z.strictObject({
  anyOf: z.array(termSchema).min(1),
});

export const mustHaveSchema = groupSchema.extend({
  min: z.number().int().min(1),
});

export const languageSchema = z.strictObject({
  lang: z.string().regex(/^[a-z]{2}$/),
  level: z.enum(['native', 'fluent', 'working']),
  quote: z.string(),
});

export const salarySchema = z.strictObject({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().min(1),
  period: z.enum(['hour', 'day', 'month', 'year']),
});

export const workAuthorizationSchema = z.strictObject({
  requirements: z.array(
    z.strictObject({ kind: z.string().min(1), place: z.string().min(1) }),
  ),
  sponsorship: z.enum(['yes', 'no', 'unstated']),
});

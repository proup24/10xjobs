import { z } from 'zod';
import { stackIssues } from '../rules/stack';
import { LIST_NAMES } from '../vocab/lists';
import { confidenceSchema, decidedBySchema } from './fact';
import {
  PLACE_STRICTNESS,
  languageSchema,
  rangeSchema,
  salarySchema,
  techStackSchema,
  timezoneSchema,
  workAuthorizationSchema,
} from './shared';

/**
 * The extraction document as stored at schema version 3, kept to read
 * `job_extractions.data` rows written before version 4 dropped Jev's
 * verification. Nothing writes this shape any more.
 */

/** Jev's check of one closed fact: its verdict, score and own pick, after `rounds` rounds. */
export const verificationSchema = z.strictObject({
  verdict: z.enum(['confirmed', 'unconfirmed', 'rejected']),
  score: z.number().min(0).max(1).nullable(),
  jevPick: z.string().nullable(),
  rounds: z.number().int().min(1),
});

export type Verification = z.infer<typeof verificationSchema>;
export type Verdict = Verification['verdict'];

const factSchema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    decidedBy: decidedBySchema,
    score: z.number().min(0).max(1).nullable(),
    quote: z.string(),
    model: z.string().nullable(),
    verification: verificationSchema.nullable(),
  });

const placeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('worldwide') }),
  z.strictObject({ kind: z.literal('region'), code: z.string().min(1) }),
  z.strictObject({ kind: z.literal('country'), code: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('city'),
    name: z.string().min(1),
    countryCode: z.string().nullable(),
    cityId: z.string().nullable(),
  }),
]);

const openingSchema = z.strictObject({
  arrangements: z.array(z.string().min(1)).min(1),
  places: z.array(placeSchema),
  placeStrictness: z.enum(PLACE_STRICTNESS),
  timezones: z.array(timezoneSchema),
  quote: z.string(),
  confidence: confidenceSchema,
  decidedBy: decidedBySchema,
});

const unmatchedSchema = z.strictObject({
  list: z.enum([...LIST_NAMES, 'cities']),
  text: z.string(),
  at: z.string(),
});

/** How the verification went: rounds used, and per finally-rejected field what was dropped. */
const documentVerificationSchema = z.strictObject({
  rounds: z.number().int().min(1),
  regenerationInvalid: z.boolean(),
  dropped: z.array(
    z.strictObject({
      field: z.string(),
      generatorValue: z.unknown(),
      jevPick: z.string().nullable(),
    }),
  ),
  missedJunkFlags: z.array(z.string()),
});

export const extractionDocumentV3Schema = z
  .strictObject({
    position: factSchema(
      z.strictObject({ roleKind: z.string().min(1), title: z.string() }),
    ),
    isSoftwareEngineeringRole: factSchema(z.boolean()),
    seniority: factSchema(z.string().min(1)),
    yearsRequired: factSchema(rangeSchema),
    arrangement: factSchema(z.string().min(1)),
    openings: z.array(openingSchema).min(1),
    contractType: factSchema(z.string().min(1)),
    engagement: factSchema(z.string().min(1)),
    contractMonths: factSchema(z.number().positive()),
    salary: factSchema(salarySchema),
    techStack: factSchema(techStackSchema),
    requiredLanguages: factSchema(z.array(languageSchema)),
    workAuthorization: factSchema(workAuthorizationSchema),
    junkFlags: factSchema(
      z.array(z.strictObject({ code: z.string().min(1), quote: z.string() })),
    ),
    unmatched: z.array(unmatchedSchema),
    truncated: z.boolean(),
    verification: documentVerificationSchema,
    models: z.strictObject({
      verifier: z.string().nullable(),
      generator: z.string().min(1),
    }),
  })
  .superRefine((doc, ctx) => {
    const years = doc.yearsRequired.value;
    if (years?.min != null && years.max != null && years.max < years.min) {
      ctx.addIssue({
        code: 'custom',
        path: ['yearsRequired', 'value', 'max'],
        message: 'max must be >= min',
      });
    }
    if (doc.techStack.value) {
      for (const issue of stackIssues(doc.techStack.value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['techStack', 'value', ...issue.path],
          message: issue.message,
        });
      }
    }
    doc.openings.forEach((o, i) => {
      for (const issue of openingIssues(o)) {
        ctx.addIssue({ ...issue, path: ['openings', i, ...issue.path] });
      }
    });
  });

/** An opening's cross-field problems, with paths relative to the opening. */
function openingIssues(o: {
  places: readonly unknown[];
  placeStrictness: string;
  timezones: readonly { fromUtc: number; toUtc: number }[];
}): { code: 'custom'; path: (string | number)[]; message: string }[] {
  const issues: {
    code: 'custom';
    path: (string | number)[];
    message: string;
  }[] = [];
  if ((o.placeStrictness === 'unstated') !== (o.places.length === 0)) {
    issues.push({
      code: 'custom',
      path: ['placeStrictness'],
      message: 'placeStrictness is unstated exactly when places is empty',
    });
  }
  o.timezones.forEach((tz, j) => {
    if (tz.fromUtc > tz.toUtc) {
      issues.push({
        code: 'custom',
        path: ['timezones', j, 'fromUtc'],
        message: 'fromUtc must be <= toUtc',
      });
    }
  });
  return issues;
}

export type ExtractionDocumentV3 = z.infer<typeof extractionDocumentV3Schema>;
export type DocumentVerification = z.infer<typeof documentVerificationSchema>;

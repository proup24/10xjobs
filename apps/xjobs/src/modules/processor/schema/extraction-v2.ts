import { z } from 'zod';
import { stackIssues } from '../rules/stack';
import { LIST_NAMES } from '../vocab/lists';
import { verificationSchema } from './extraction-v3';
import { confidenceSchema } from './fact';
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
 * The extraction document as stored at schema version 2, kept to read
 * `job_extractions.data` rows written before version 3. Nothing writes this
 * shape any more: it carries the ingest provenance (`conflicts`, an
 * `ingest` decider) that version 3 dropped.
 */

const decidedByV2Schema = z.enum(['ingest', 'generator']);

const factV2Schema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    decidedBy: decidedByV2Schema,
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
  decidedBy: decidedByV2Schema,
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

export const extractionDocumentV2Schema = z
  .strictObject({
    position: factV2Schema(
      z.strictObject({ roleKind: z.string().min(1), title: z.string() }),
    ),
    isSoftwareEngineeringRole: factV2Schema(z.boolean()),
    seniority: factV2Schema(z.string().min(1)),
    yearsRequired: factV2Schema(rangeSchema),
    arrangement: factV2Schema(z.string().min(1)),
    openings: z.array(openingSchema).min(1),
    contractType: factV2Schema(z.string().min(1)),
    engagement: factV2Schema(z.string().min(1)),
    contractMonths: factV2Schema(z.number().positive()),
    salary: factV2Schema(salarySchema),
    techStack: factV2Schema(techStackSchema),
    requiredLanguages: factV2Schema(z.array(languageSchema)),
    workAuthorization: factV2Schema(workAuthorizationSchema),
    junkFlags: factV2Schema(
      z.array(z.strictObject({ code: z.string().min(1), quote: z.string() })),
    ),
    conflicts: z.array(
      z.strictObject({
        field: z.string().min(1),
        ingestValue: z.unknown(),
        extractedValue: z.unknown(),
      }),
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
      if ((o.placeStrictness === 'unstated') !== (o.places.length === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['openings', i, 'placeStrictness'],
          message: 'placeStrictness is unstated exactly when places is empty',
        });
      }
      o.timezones.forEach((tz, j) => {
        if (tz.fromUtc > tz.toUtc) {
          ctx.addIssue({
            code: 'custom',
            path: ['openings', i, 'timezones', j, 'fromUtc'],
            message: 'fromUtc must be <= toUtc',
          });
        }
      });
    });
  });

export type ExtractionDocumentV2 = z.infer<typeof extractionDocumentV2Schema>;

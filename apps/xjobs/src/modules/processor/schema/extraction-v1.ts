import { z } from 'zod';
import { confidenceSchema } from './fact';
import {
  PLACE_STRICTNESS,
  languageSchema,
  salarySchema,
  termSchema,
  timezoneSchema,
  workAuthorizationSchema,
} from './shared';

/**
 * The extraction document as stored before schema version 2, kept only to
 * read old `job_extractions.data` rows. Nothing writes this shape any more.
 */

const decidedByV1Schema = z.enum(['ingest', 'jev', 'opus']);

const factV1Schema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    decidedBy: decidedByV1Schema,
    score: z.number().min(0).max(1).nullable(),
    quote: z.string(),
    model: z.string().nullable(),
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
  decidedBy: decidedByV1Schema,
});

/** The list names v1 rows were written with, frozen: the live lists may change. */
const V1_LIST_NAMES = [
  'techTags',
  'regions',
  'countries',
  'roleKinds',
  'seniorities',
  'arrangements',
  'contractTypes',
  'engagements',
  'junkFlags',
  'cities',
] as const;

const unmatchedSchema = z.strictObject({
  list: z.enum(V1_LIST_NAMES),
  text: z.string(),
  at: z.string(),
});

const groupSchema = z.strictObject({
  anyOf: z.array(termSchema).min(1),
});

const mustHaveSchema = groupSchema.extend({
  min: z.number().int().min(1),
});

const techStackSchema = z.strictObject({
  mainStack: z.array(groupSchema),
  mustHaves: z.array(mustHaveSchema),
  niceToHaves: z.array(termSchema),
});

export const extractionDocumentV1Schema = z
  .strictObject({
    position: factV1Schema(
      z.strictObject({ roleKind: z.string().min(1), title: z.string() }),
    ),
    isSoftwareEngineeringRole: factV1Schema(z.boolean()),
    seniority: factV1Schema(z.string().min(1)),
    yearsRequired: factV1Schema(z.number().nonnegative()),
    arrangement: factV1Schema(z.string().min(1)),
    openings: z.array(openingSchema).min(1),
    contractType: factV1Schema(z.string().min(1)),
    engagement: factV1Schema(z.string().min(1)),
    contractMonths: factV1Schema(z.number().positive()),
    salary: factV1Schema(salarySchema),
    techStack: factV1Schema(techStackSchema),
    requiredLanguages: factV1Schema(z.array(languageSchema)),
    workAuthorization: factV1Schema(workAuthorizationSchema),
    junkFlags: factV1Schema(
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
    models: z.strictObject({
      decision: z.string().nullable(),
      extraction: z.string().min(1),
    }),
  })
  .superRefine((doc, ctx) => {
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

export type ExtractionDocumentV1 = z.infer<typeof extractionDocumentV1Schema>;

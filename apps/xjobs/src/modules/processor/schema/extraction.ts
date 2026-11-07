import { z } from 'zod';
import { LIST_NAMES } from '../vocab/lists';
import { confidenceSchema, decidedBySchema, factSchema } from './fact';
import {
  PLACE_STRICTNESS,
  groupSchema,
  languageSchema,
  mustHaveSchema,
  salarySchema,
  termSchema,
  timezoneSchema,
  workAuthorizationSchema,
} from './shared';

/** Bump on any change to the document shape. Stored with each extraction. */
export const EXTRACTION_SCHEMA_VERSION = 2;

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

const techStackSchema = z.strictObject({
  mainStack: z.array(groupSchema),
  mustHaves: z.array(mustHaveSchema),
  niceToHaves: z.array(termSchema),
});

export const extractionDocumentSchema = z
  .strictObject({
    position: factSchema(
      z.strictObject({ roleKind: z.string().min(1), title: z.string() }),
    ),
    isSoftwareEngineeringRole: factSchema(z.boolean()),
    seniority: factSchema(z.string().min(1)),
    yearsRequired: factSchema(z.number().nonnegative()),
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

export type ExtractionDocument = z.infer<typeof extractionDocumentSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Term = z.infer<typeof termSchema>;
export type UnmatchedTerm = z.infer<typeof unmatchedSchema>;

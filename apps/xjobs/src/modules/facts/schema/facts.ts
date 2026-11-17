import { z } from 'zod';
import { stackIssues } from '../../processor/rules/stack';
import {
  openingIssues,
  openingSchema,
  type Place,
} from '../../processor/schema/extraction';
import { confidenceSchema } from '../../processor/schema/fact';
import {
  type PLACE_STRICTNESS,
  languageSchema,
  rangeSchema,
  salarySchema,
  techStackSchema,
  timezoneSchema,
  workAuthorizationSchema,
} from '../../processor/schema/shared';

export type FactSource = 'description' | 'linkedin';
export type PlaceStrictness = (typeof PLACE_STRICTNESS)[number];
export type Timezone = z.infer<typeof timezoneSchema>;
/** A processor place: a city carries `{ name, countryCode | null, cityId | null }`. */
export type ResolvedPlaceOrCity = Place;

export interface SourcedFact<T> {
  value: T | null;
  confidence: 'sure' | 'unsure';
  source: FactSource;
  quote: string;
}

const factSourceSchema = z.enum(['description', 'linkedin']);

const sourcedFactSchema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    source: factSourceSchema,
    quote: z.string(),
  });

/**
 * The processor opening, with where each part came from in place of who decided it:
 * its arrangement and its places can come from different sources. `confidence` describes
 * the description-sourced parts; a part from LinkedIn is sure.
 */
const factOpeningSchema = openingSchema.omit({ decidedBy: true }).extend({
  arrangementSource: factSourceSchema,
  placesSource: factSourceSchema,
});

/** The processor's work authorization; a requirement may be derived by code from no sponsorship. */
export const factWorkAuthorizationSchema = workAuthorizationSchema.extend({
  requirements: z.array(
    workAuthorizationSchema.shape.requirements.element.extend({
      derived: z.literal('no-sponsorship').optional(),
    }),
  ),
});

/** A salary whose currency may be unknown (dropped by `cleanCurrency`); amounts are kept. */
const factSalarySchema = salarySchema.extend({
  currency: salarySchema.shape.currency.nullable(),
});

export const jobFactsDocumentSchema = z
  .strictObject({
    version: z.number().int().positive(),
    position: sourcedFactSchema(
      z.strictObject({ roleKind: z.string().min(1), title: z.string() }),
    ),
    isSoftwareEngineeringRole: sourcedFactSchema(z.boolean()),
    seniority: sourcedFactSchema(z.string().min(1)),
    yearsRequired: sourcedFactSchema(rangeSchema),
    contractType: sourcedFactSchema(z.string().min(1)),
    /** Display only: the matcher never reads it. */
    engagement: sourcedFactSchema(z.string().min(1)),
    /** Display only: the matcher never reads it. */
    contractMonths: sourcedFactSchema(z.number().positive()),
    requiredLanguages: sourcedFactSchema(z.array(languageSchema)),
    workAuthorization: sourcedFactSchema(factWorkAuthorizationSchema),
    techStack: sourcedFactSchema(techStackSchema),
    arrangement: sourcedFactSchema(z.string().min(1)),
    openings: z.array(factOpeningSchema).min(1),
    salary: sourcedFactSchema(factSalarySchema),
    closed: z.boolean(),
    /** Detected from the description text by code; never from a model. */
    postingLanguages: z.strictObject({
      /** ISO 639-1. */
      codes: z.array(z.string().length(2)),
      /** Sets of close relatives the detector could not tell apart, each sorted. */
      closeCalls: z.array(z.array(z.string().length(2)).min(1)).default([]),
      confident: z.boolean(),
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

/** The facts the matcher reads, combined from the description and the LinkedIn listing. */
export type JobFactsDocument = z.infer<typeof jobFactsDocumentSchema>;
export type FactOpening = z.infer<typeof factOpeningSchema>;
export type FactSalary = z.infer<typeof factSalarySchema>;
export type FactWorkAuthorization = z.infer<typeof factWorkAuthorizationSchema>;

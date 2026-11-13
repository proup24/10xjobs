import { z } from 'zod';
import { stackIssues } from '../rules/stack';
import { LIST_NAMES } from '../vocab/lists';
import {
  type ExtractionDocumentV3,
  extractionDocumentV3Schema,
} from './extraction-v3';
import {
  type ExtractionDocumentV1,
  extractionDocumentV1Schema,
} from './extraction-v1';
import {
  type ExtractionDocumentV2,
  extractionDocumentV2Schema,
} from './extraction-v2';
import { confidenceSchema, decidedBySchema, factSchema } from './fact';
import {
  PLACE_STRICTNESS,
  languageSchema,
  rangeSchema,
  salarySchema,
  techStackSchema,
  termSchema,
  timezoneSchema,
  workAuthorizationSchema,
} from './shared';

/** Bump on any change to the document shape. Stored with each extraction. */
export const EXTRACTION_SCHEMA_VERSION = 4;

export const placeSchema = z.discriminatedUnion('kind', [
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

export const openingSchema = z.strictObject({
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

export const extractionDocumentSchema = z
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
    models: z.strictObject({ generator: z.string().min(1) }),
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
export function openingIssues(o: {
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

export type ExtractionDocument = z.infer<typeof extractionDocumentSchema>;

/** A stored `job_extractions.data`, read as the version it was written in. */
export type StoredDocument =
  | { version: 4; document: ExtractionDocument }
  | { version: 3; document: ExtractionDocumentV3 }
  | { version: 2; document: ExtractionDocumentV2 }
  | { version: 1; document: ExtractionDocumentV1 };

/** Reads stored `data` as v4, then v3, v2 and v1 for old rows; null when none reads it. */
export function parseStoredDocument(data: unknown): StoredDocument | null {
  const v4 = extractionDocumentSchema.safeParse(data);
  if (v4.success) return { version: 4, document: v4.data };
  const v3 = extractionDocumentV3Schema.safeParse(data);
  if (v3.success) return { version: 3, document: v3.data };
  const v2 = extractionDocumentV2Schema.safeParse(data);
  if (v2.success) return { version: 2, document: v2.data };
  const v1 = extractionDocumentV1Schema.safeParse(data);
  if (v1.success) return { version: 1, document: v1.data };
  return null;
}
export type Place = z.infer<typeof placeSchema>;
export type Opening = z.infer<typeof openingSchema>;
export type Term = z.infer<typeof termSchema>;
export type { Requirement, RequirementGroup, TechStack } from './shared';
export type UnmatchedTerm = z.infer<typeof unmatchedSchema>;

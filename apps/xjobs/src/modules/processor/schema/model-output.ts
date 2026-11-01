import { z } from 'zod';
import type { DecisionQuestion } from '../models/types';
import type { ListName } from '../vocab/lists';
import { confidenceSchema } from './fact';
import {
  PLACE_STRICTNESS,
  groupSchema,
  languageSchema,
  mustHaveSchema,
  salarySchema,
  termSchema,
  utcOffset,
  workAuthorizationSchema,
} from './shared';

/** Approved codes per list. */
export type ListOptions = Record<ListName, string[]>;

export interface ModelFact<T> {
  value: T | null;
  quote: string;
  confidence: 'sure' | 'unsure';
}

/** What Opus returns; structurally checked here, codes are enums of the approved options. */
export interface ModelOutput {
  position: ModelFact<{ roleKind: string; title: string }>;
  isSoftwareEngineeringRole: ModelFact<boolean>;
  seniority: ModelFact<string>;
  yearsRequired: ModelFact<number>;
  arrangement: ModelFact<string>;
  openings: unknown[];
  contractType: ModelFact<string>;
  engagement: ModelFact<string>;
  contractMonths: ModelFact<number>;
  salary: ModelFact<z.infer<typeof salarySchema>>;
  techStack: ModelFact<unknown>;
  requiredLanguages: ModelFact<z.infer<typeof languageSchema>[]>;
  workAuthorization: ModelFact<z.infer<typeof workAuthorizationSchema>>;
  junkFlags: ModelFact<{ code: string; quote: string }[]>;
  fallback: Record<string, ModelFact<string | boolean>>;
}

/** A non-empty string enum; an empty option list admits nothing but null (use a literal that cannot match). */
const codeEnum = (values: string[]) =>
  values.length > 0 ? z.enum(values as [string, ...string[]]) : z.never();

const modelFact = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    quote: z.string(),
    confidence: confidenceSchema,
  });

export function modelOutputSchema(
  options: ListOptions,
  fallback: DecisionQuestion[],
): z.ZodType<ModelOutput> {
  const place = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('worldwide') }),
    z.strictObject({
      kind: z.literal('region'),
      code: codeEnum(options.regions),
    }),
    z.strictObject({
      kind: z.literal('country'),
      code: codeEnum(options.countries),
    }),
    z.strictObject({
      kind: z.literal('city'),
      name: z.string().min(1),
      countryCode: z.string().nullable(),
    }),
  ]);
  const opening = z.strictObject({
    arrangements: z.array(codeEnum(options.arrangements)).min(1),
    places: z.array(place),
    placeStrictness: z.enum(PLACE_STRICTNESS),
    timezones: z.array(
      z.strictObject({
        fromUtc: utcOffset,
        toUtc: utcOffset,
        label: z.string().min(1),
      }),
    ),
    quote: z.string(),
    confidence: confidenceSchema,
  });

  const fallbackShape: Record<string, z.ZodType> = {};
  for (const q of fallback) {
    fallbackShape[q.key] = modelFact(
      q.kind === 'choice' ? codeEnum(q.options) : z.boolean(),
    );
  }

  const schema = z.strictObject({
    position: modelFact(
      z.strictObject({
        roleKind: codeEnum(options.roleKinds),
        title: z.string(),
      }),
    ),
    isSoftwareEngineeringRole: modelFact(z.boolean()),
    seniority: modelFact(codeEnum(options.seniorities)),
    yearsRequired: modelFact(z.number().nonnegative()),
    arrangement: modelFact(codeEnum(options.arrangements)),
    openings: z.array(opening).min(1),
    contractType: modelFact(codeEnum(options.contractTypes)),
    engagement: modelFact(codeEnum(options.engagements)),
    contractMonths: modelFact(z.number().positive()),
    salary: modelFact(salarySchema),
    techStack: modelFact(
      z.strictObject({
        mainStack: z.array(groupSchema),
        mustHaves: z.array(mustHaveSchema),
        niceToHaves: z.array(termSchema),
      }),
    ),
    requiredLanguages: modelFact(z.array(languageSchema)),
    workAuthorization: modelFact(workAuthorizationSchema),
    junkFlags: modelFact(
      z.array(
        z.strictObject({
          code: codeEnum(options.junkFlags),
          quote: z.string(),
        }),
      ),
    ),
    fallback: z.strictObject(fallbackShape),
  });
  return schema as unknown as z.ZodType<ModelOutput>;
}

/**
 * OpenRouter strict mode may reject parts of the JSON Schema; see models/SPIKE.md.
 * Identity until the spike says what must be flattened.
 */
export function flattenForStrict(schema: object): object {
  return schema;
}

export function modelOutputJsonSchema(
  options: ListOptions,
  fallback: DecisionQuestion[],
): object {
  return flattenForStrict(z.toJSONSchema(modelOutputSchema(options, fallback)));
}

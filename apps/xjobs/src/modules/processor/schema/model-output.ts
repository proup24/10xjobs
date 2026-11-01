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

/** An enum of the approved codes of one list. An empty list is a programming error. */
function codeEnum(list: string, values: string[]): z.ZodType<string> {
  if (values.length === 0) throw new Error(`no approved options for ${list}`);
  return z.enum(values as [string, ...string[]]);
}

const modelFact = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    quote: z.string(),
    confidence: confidenceSchema,
  });

function buildModelOutput(options: ListOptions, fallback: DecisionQuestion[]) {
  const place = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('worldwide') }),
    z.strictObject({
      kind: z.literal('region'),
      code: codeEnum('regions', options.regions),
    }),
    z.strictObject({
      kind: z.literal('country'),
      code: codeEnum('countries', options.countries),
    }),
    z.strictObject({
      kind: z.literal('city'),
      name: z.string().min(1),
      countryCode: z.string().nullable(),
    }),
  ]);
  const opening = z.strictObject({
    arrangements: z
      .array(codeEnum('arrangements', options.arrangements))
      .min(1),
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

  const fallbackShape: Record<
    string,
    ReturnType<typeof modelFact<z.ZodType<string | boolean>>>
  > = {};
  for (const q of fallback) {
    fallbackShape[q.key] = modelFact(
      q.kind === 'choice'
        ? codeEnum(`fallback ${q.key}`, q.options)
        : z.boolean(),
    );
  }

  return z.strictObject({
    position: modelFact(
      z.strictObject({
        roleKind: codeEnum('roleKinds', options.roleKinds),
        title: z.string(),
      }),
    ),
    isSoftwareEngineeringRole: modelFact(z.boolean()),
    seniority: modelFact(codeEnum('seniorities', options.seniorities)),
    yearsRequired: modelFact(z.number().nonnegative()),
    arrangement: modelFact(codeEnum('arrangements', options.arrangements)),
    openings: z.array(opening).min(1),
    contractType: modelFact(codeEnum('contractTypes', options.contractTypes)),
    engagement: modelFact(codeEnum('engagements', options.engagements)),
    contractMonths: modelFact(z.number().positive()),
    salary: modelFact(salarySchema),
    // Term codes stay free strings: unmatched terms are resolved to approved codes afterwards (Task 5).
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
          code: codeEnum('junkFlags', options.junkFlags),
          quote: z.string(),
        }),
      ),
    ),
    fallback: z.strictObject(fallbackShape),
  });
}

/** What Opus returns; structurally checked here, codes are enums of the approved options. */
export type ModelOutput = z.infer<ReturnType<typeof buildModelOutput>>;

export function modelOutputSchema(
  options: ListOptions,
  fallback: DecisionQuestion[],
) {
  return buildModelOutput(options, fallback);
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

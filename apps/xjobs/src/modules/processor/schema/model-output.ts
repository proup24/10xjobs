import { z } from 'zod';
import type { ListName } from '../vocab/lists';
import { confidenceSchema } from './fact';
import {
  PLACE_STRICTNESS,
  languageSchema,
  rangeSchema,
  salarySchema,
  techStackSchema,
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

function buildModelOutput(options: ListOptions) {
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
      countryCode: codeEnum('countries', options.countries).nullable(),
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
    /** Set when the place came from the listing metadata because the posting says nothing about it. */
    fromListing: z.boolean().optional(),
  });

  return z.strictObject({
    position: modelFact(
      z.strictObject({
        roleKind: codeEnum('roleKinds', options.roleKinds),
        title: z.string(),
      }),
    ),
    isSoftwareEngineeringRole: modelFact(z.boolean()),
    seniority: modelFact(codeEnum('seniorities', options.seniorities)),
    yearsRequired: modelFact(rangeSchema),
    arrangement: modelFact(codeEnum('arrangements', options.arrangements)),
    openings: z.array(opening).min(1),
    contractType: modelFact(codeEnum('contractTypes', options.contractTypes)),
    engagement: modelFact(codeEnum('engagements', options.engagements)),
    contractMonths: modelFact(z.number().positive()),
    salary: modelFact(salarySchema),
    // Term codes stay free strings: unmatched terms are resolved to approved codes afterwards (Task 5).
    techStack: modelFact(techStackSchema),
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
  });
}

/** What the generator returns; structurally checked here, codes are enums of the approved options. */
export type ModelOutput = z.infer<ReturnType<typeof buildModelOutput>>;

export function modelOutputSchema(options: ListOptions) {
  return buildModelOutput(options);
}

/**
 * Keywords strict structured output does not accept everywhere. They only
 * constrain values, and the full zod schema still validates every answer
 * locally, so dropping them from the sent schema loses no checking: a
 * violation goes to the schema-fix retry instead of failing the call.
 */
const VALIDATION_ONLY = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
]);

/**
 * Makes a zod-generated JSON Schema acceptable to strict structured output:
 * every object lists all its properties as `required` and allows no others
 * (an optional zod field is then always sent, which zod still accepts),
 * `oneOf` becomes `anyOf`, and validation-only keywords are dropped.
 */
export function flattenForStrict(schema: object): object {
  return strictNode(schema) as object;
}

function strictNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (VALIDATION_ONLY.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, prop]) => [name, strictNode(prop)]),
      );
      continue;
    }
    out[key === 'oneOf' ? 'anyOf' : key] = strictNode(value);
  }
  if (out.type === 'object' && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

export function modelOutputJsonSchema(options: ListOptions): object {
  return flattenForStrict(z.toJSONSchema(modelOutputSchema(options)));
}

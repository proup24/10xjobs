import { z } from 'zod';
import { flattenForStrict } from '../schema/model-output';
import type { PostingInput } from './types';

/** The posting as the user message. */
export function postingText(input: PostingInput): string {
  return [
    input.title && `Title: ${input.title}`,
    input.truncated && 'Note: the description was truncated.',
    input.description,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The retry message: the previous try's validation errors, to fix. */
export function retryText(errors: string[]): string {
  return `Your previous answer was invalid. Fix these problems and answer again:\n${errors.map((e) => `- ${e}`).join('\n')}`;
}

const jsonSchemas = new WeakMap<z.ZodType, object>();

/** The JSON Schema made acceptable to strict structured output, cached per schema. */
export function strictJsonSchema(schema: z.ZodType): object {
  let out = jsonSchemas.get(schema);
  if (!out) {
    out = flattenForStrict(z.toJSONSchema(schema)) as object;
    jsonSchemas.set(schema, out);
  }
  return out;
}

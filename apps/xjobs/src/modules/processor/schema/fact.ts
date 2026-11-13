import { z } from 'zod';

/** Who set a fact's value. Only the generator since schema version 3; kept so the score code reads it unchanged. */
export type DecidedBy = 'generator';
export type Confidence = 'sure' | 'unsure';

export const confidenceSchema = z.enum(['sure', 'unsure']);
export const decidedBySchema = z.enum(['generator']);

/**
 * The envelope every fact carries. A null value means the posting does not
 * establish it.
 */
export const factSchema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    decidedBy: decidedBySchema,
    score: z.number().min(0).max(1).nullable(),
    quote: z.string(),
    model: z.string().nullable(),
  });

export type Fact<T> = {
  value: T | null;
  confidence: Confidence;
  decidedBy: DecidedBy;
  score: number | null;
  quote: string;
  model: string | null;
};

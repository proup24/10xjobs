import { z } from 'zod';

/** Who set a fact's value: the generator model, or the LinkedIn ingest evidence. */
export type DecidedBy = 'ingest' | 'generator';
export type Confidence = 'sure' | 'unsure';
/** Jev's final verdict on a verified fact. */
export type Verdict = 'confirmed' | 'unconfirmed' | 'rejected';

export const confidenceSchema = z.enum(['sure', 'unsure']);
export const decidedBySchema = z.enum(['ingest', 'generator']);

/** Jev's check of one closed fact: its verdict, score and own pick, after `rounds` rounds. */
export const verificationSchema = z.strictObject({
  verdict: z.enum(['confirmed', 'unconfirmed', 'rejected']),
  score: z.number().min(0).max(1).nullable(),
  jevPick: z.string().nullable(),
  rounds: z.number().int().min(1),
});

export type Verification = z.infer<typeof verificationSchema>;

/**
 * The envelope every fact carries. A null value means the posting does not
 * establish it. `verification` is null for open-ended and ingest facts.
 */
export const factSchema = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: confidenceSchema,
    decidedBy: decidedBySchema,
    score: z.number().min(0).max(1).nullable(),
    quote: z.string(),
    model: z.string().nullable(),
    verification: verificationSchema.nullable(),
  });

export type Fact<T> = {
  value: T | null;
  confidence: Confidence;
  decidedBy: DecidedBy;
  score: number | null;
  quote: string;
  model: string | null;
  verification: Verification | null;
};

import type { z } from 'zod';
import type { FieldVerdict } from '../rules/verify';

export type ClosedQuestionKey =
  | 'arrangement'
  | 'seniority'
  | 'roleKind'
  | 'contractType'
  | 'engagement'
  | 'isSoftwareEngineeringRole'
  | 'sponsorshipOffered'
  | `junk:${string}`;

export type DecisionQuestion =
  | {
      key: ClosedQuestionKey;
      kind: 'choice';
      options: string[];
      instructions: string;
    }
  | { key: ClosedQuestionKey; kind: 'yesno'; instructions: string };

export interface DecisionAnswer {
  key: ClosedQuestionKey;
  value: string | boolean | null;
  score: number;
}

export interface PostingInput {
  jobId: string;
  title: string | null;
  description: string;
  truncated: boolean;
}

export interface JobForProcessing {
  id: string;
  closed: boolean;
  title: string | null;
  descriptionText: string | null;
}

export interface ModelCallMeta {
  model: string;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/** Closed questions, answered by the decision model (Jev). */
export abstract class DecisionModel {
  abstract decide(
    input: PostingInput,
    questions: DecisionQuestion[],
  ): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta }>;
}

/** One generation request: the whole document, closed fields included. */
export interface GenerateRequest {
  systemPrompt: string;
  /** The model output schema, built from the approved list rows. */
  schema: z.ZodType;
  /** The previous try's validation errors, to fix. */
  retryErrors?: string[];
  /** The fields Jev rejected in the previous round, to re-read. */
  feedback?: FieldVerdict[];
}

/** The generator (Opus or DeepSeek): writes the whole structured document. */
export abstract class ExtractionModel {
  /**
   * One model call, never retried here. Output that does not match
   * `req.schema` throws `ModelOutputError` listing the issues.
   */
  abstract generate(
    input: PostingInput,
    req: GenerateRequest,
  ): Promise<{ output: unknown; meta: ModelCallMeta }>;
}

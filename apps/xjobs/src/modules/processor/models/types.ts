import type { z } from 'zod';
import type { PostDetail } from '../../ingest/normalize/record';

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
  kind: 'job' | 'post';
  /** A post job's sources (`normalized_jobs.postSources.sources`); null on a listing job. */
  postSources: PostDetail[] | null;
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

/** One generation request: the whole document, closed fields included. */
export interface GenerateRequest {
  systemPrompt: string;
  /** The model output schema, built from the approved list rows. */
  schema: z.ZodType;
  /** The previous try's validation errors, to fix. */
  retryErrors?: string[];
}

/** The generator: writes the whole structured document. */
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

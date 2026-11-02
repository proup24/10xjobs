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

export interface Evidence {
  location: string | null;
  contractType: string | null;
  experienceLevel: string | null;
  salary: {
    text: string | null;
    min: number | null;
    max: number | null;
    currency: string | null;
    period: string | null;
  } | null;
}

export interface PostingInput {
  jobId: string;
  title: string | null;
  companyName: string | null;
  description: string;
  truncated: boolean;
  evidence: Evidence;
}

export interface JobForProcessing {
  id: string;
  closed: boolean;
  title: string | null;
  companyName: string | null;
  descriptionText: string | null;
  evidence: Evidence;
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

/** Open-ended structured extraction (Opus). */
export abstract class ExtractionModel {
  abstract extract(
    input: PostingInput,
    req: { systemPrompt: string; jsonSchema: object; retryErrors?: string[] },
  ): Promise<{ output: unknown; meta: ModelCallMeta }>;
}

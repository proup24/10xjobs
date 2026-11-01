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

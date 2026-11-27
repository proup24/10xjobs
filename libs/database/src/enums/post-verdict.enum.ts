/**
 * A LinkedIn post's verdict and its reason codes. Stored in
 * `job_extractions.verdict` and `"verdictReason"` on post rows; the engine's
 * post schema and prompt read these lists, and the owner's verdict list
 * filters on them.
 */
export const VERDICTS = ['hiring', 'not_hiring', 'junk'] as const;
export const NOT_HIRING_REASONS = [
  'open_to_work',
  'advice_or_commentary',
  'course_or_training_ad',
  'job_digest',
  'role_filled',
  'other',
] as const;
export const JUNK_REASONS = [
  'no_clear_employer',
  'many_roles_across_companies',
  'funnel',
  'messaging_group',
  'other',
] as const;

export type Verdict = (typeof VERDICTS)[number];

/** The verdicts the owner's verdict list shows: all but hiring. */
export const LISTED_VERDICTS = VERDICTS.filter(
  (v): v is Exclude<Verdict, 'hiring'> => v !== 'hiring',
);
export type ListedVerdict = (typeof LISTED_VERDICTS)[number];

export type PostVerdictReason =
  | (typeof NOT_HIRING_REASONS)[number]
  | (typeof JUNK_REASONS)[number];

/** Every not-hiring and junk reason code once (`other` is in both). */
export const POST_VERDICT_REASONS: readonly PostVerdictReason[] = [
  ...new Set<PostVerdictReason>([...NOT_HIRING_REASONS, ...JUNK_REASONS]),
];

/** Short words for each reason code, for the users' Junk tab. */
export const POST_VERDICT_REASON_LABELS: Record<PostVerdictReason, string> = {
  open_to_work: 'Open to work',
  advice_or_commentary: 'Advice or commentary',
  course_or_training_ad: 'Course or training ad',
  job_digest: 'Job digest',
  role_filled: 'Role filled',
  no_clear_employer: 'No clear employer',
  many_roles_across_companies: 'Many roles across companies',
  funnel: 'Sells to job seekers',
  messaging_group: 'Join a group to apply',
  other: 'Other',
};

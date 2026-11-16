/**
 * Why a user marked a job "Not for me". Stored in `job_decisions.reason`; the
 * `job_decisions_reason` check constraint lists the same codes. The first eight line up
 * with the matcher's rules.
 */
export const DISMISS_REASONS = [
  'role',
  'seniority',
  'location',
  'stack',
  'salary',
  'contract',
  'languages',
  'work_authorization',
  'company',
  'other',
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  role: 'Not the role I want',
  seniority: 'Wrong seniority',
  location: 'Location or arrangement',
  stack: 'Tech stack',
  salary: 'Salary',
  contract: 'Contract type or engagement',
  languages: 'Language requirements',
  work_authorization: 'Work authorization',
  company: 'The company',
  other: 'Something else',
};

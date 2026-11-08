/** The setup steps in order; `Steps` shows them, the next-step rule picks one. */
export const SETUP_STEPS = [
  { id: 'about', label: 'About you' },
  { id: 'eligibility', label: 'Where you can work' },
  { id: 'job', label: 'The job you want' },
  { id: 'terms', label: 'Location and terms' },
  { id: 'resume', label: 'Resume' },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

export function stepPath(id: SetupStepId | 'review'): string {
  return `/setup/${id}`;
}

/** The steps of the new-profile flow, in order; `StepFrame` takes them as its flow. */
export const NEW_PROFILE_STEPS = [
  { id: 'job', label: 'The job you want' },
  { id: 'terms', label: 'Location and terms' },
  { id: 'resume', label: 'Resume' },
] as const;

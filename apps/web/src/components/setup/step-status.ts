/** What a frame needs from a step form: the save is running, and the form-level error. */
export type StepStatus = { pending: boolean; formError?: string };

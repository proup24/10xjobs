import type { ZodError } from 'zod';

/** The first message per field path ("links.0.value"); a top-level issue goes under `_form`. */
export function issueErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    errors[key] ??= issue.message;
  }
  return errors;
}

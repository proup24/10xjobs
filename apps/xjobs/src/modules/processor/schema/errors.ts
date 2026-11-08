import type { z } from 'zod';

/** Each Zod issue as `path: message`, for logs and the schema-fix retry. */
export const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

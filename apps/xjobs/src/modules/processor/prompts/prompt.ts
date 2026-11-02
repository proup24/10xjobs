import { createHash } from 'node:crypto';
import type { DecisionQuestion } from '../models/types';
import { SYSTEM_PROMPT } from './system.prompt';

export function systemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * Identifies the prompt and question wording. Options are excluded: a new
 * approved code must not invalidate earlier extractions.
 */
export function promptHash(questions: DecisionQuestion[]): string {
  const hash = createHash('sha256').update(SYSTEM_PROMPT);
  for (const q of questions) {
    hash.update(`\n${q.key}\u0000${q.kind}\u0000${q.instructions}`);
  }
  return hash.digest('hex');
}

import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT } from './system.prompt';

export function systemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * Identifies the prompt. Options are excluded: a new approved code must not
 * invalidate earlier extractions.
 */
export function promptHash(): string {
  return createHash('sha256').update(SYSTEM_PROMPT).digest('hex');
}

import { createHash } from 'node:crypto';
import { POST_PROMPT_HEAD } from './post-system.prompt';
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

/** The post prompt: the post head, then the listing prompt for each role's facts. */
export function postSystemPrompt(): string {
  return `${POST_PROMPT_HEAD}\n\n${SYSTEM_PROMPT}`;
}

/** Identifies the post prompt, as promptHash does the listing one. */
export function postPromptHash(): string {
  return createHash('sha256').update(postSystemPrompt()).digest('hex');
}

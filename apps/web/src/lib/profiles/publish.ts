import type { EngineClient } from '@xjobs/engine-client';

export type PublishOutcome =
  | { status: 'published'; href: string }
  | { status: 'failed'; message: string };

export const INCOMPLETE_MESSAGE =
  'Set your country of residence and answer the visa sponsorship question in Eligibility, then finish again.';
export const PUBLISH_FAILED_MESSAGE =
  "Couldn't publish the profile. It's saved; try Finish again.";

/**
 * Publishes a draft through the engine. Already published (another tab, a double
 * press) counts as published, so the user still lands on the matches view.
 */
export async function publishProfile(
  engine: Pick<EngineClient, 'publishProfile'>,
  profileId: string,
): Promise<PublishOutcome> {
  const result = await engine.publishProfile(profileId);
  if (
    result.kind === 'ok' ||
    (result.kind === 'conflict' && result.reason === 'already-published')
  ) {
    return { status: 'published', href: `/?profile=${profileId}` };
  }
  if (result.kind === 'conflict' && result.reason === 'incomplete') {
    return { status: 'failed', message: INCOMPLETE_MESSAGE };
  }
  return { status: 'failed', message: PUBLISH_FAILED_MESSAGE };
}

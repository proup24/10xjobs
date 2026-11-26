import { POST_MAX_AGE_DAYS } from '../config/matcher.config';
import { restsOn, type Check, type PostContext } from './types';

/** Whether the post is hiring: an unsure verdict goes to review. */
export function checkHiringVerdict(post: PostContext): Check {
  const base = {
    rule: 'hiringVerdict' as const,
    jobValue: post.verdictConfidence,
    profileValue: null,
  };
  if (post.verdictConfidence === 'unsure')
    return {
      ...base,
      outcome: 'fail',
      reason: "the post's hiring verdict is unsure",
      ...restsOn('verdict'),
    };
  return {
    ...base,
    outcome: 'pass',
    reason: 'the post is hiring',
    ...restsOn(null),
  };
}

/** Fails when any author of the post (original or sharer) is one the user blocked. */
export function checkBlockedAuthor(
  post: PostContext,
  blocked: string[],
): Check {
  const hits = post.authors.filter((a) => blocked.includes(a.key));
  // Only the matched keys are stored on the profile side, not the user's whole blocked
  // list, so a row's checks stay small.
  const base = {
    rule: 'blockedAuthor' as const,
    profileValue: hits.map((a) => a.key),
    ...restsOn(null),
  };
  if (hits.length > 0)
    return {
      ...base,
      outcome: 'fail',
      jobValue: hits.map((a) => a.key),
      reason: `you blocked ${hits.map((a) => a.name || a.key).join(', ')}`,
    };
  return {
    ...base,
    outcome: 'pass',
    jobValue: post.authors.map((a) => a.key),
    reason: 'no author you blocked',
  };
}

/**
 * Fails when the post is more than `POST_MAX_AGE_DAYS` old (30.0 days passes, 30.01 fails),
 * so a role re-decided at the sweep's 30-day mark comes out rejected; unknown when its date
 * is. A negative age (clock skew) counts as 0.
 */
export function checkPostAge(post: PostContext): Check {
  const age = post.ageDays === null ? null : Math.max(0, post.ageDays);
  const base = {
    rule: 'postAge' as const,
    jobValue: age === null ? null : Math.round(age * 100) / 100,
    profileValue: POST_MAX_AGE_DAYS,
    ...restsOn(null),
  };
  if (age === null)
    return {
      ...base,
      outcome: 'unknown',
      reason: "the post's date is unknown",
    };
  return {
    ...base,
    outcome: age > POST_MAX_AGE_DAYS ? 'fail' : 'pass',
    reason: `posted ${Math.floor(age)} days ago`,
  };
}

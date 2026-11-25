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
  const base = {
    rule: 'blockedAuthor' as const,
    profileValue: blocked,
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

/** Fails when the post is older than `POST_MAX_AGE_DAYS`; unknown when its date is. */
export function checkPostAge(post: PostContext): Check {
  const base = {
    rule: 'postAge' as const,
    jobValue: post.ageDays,
    profileValue: POST_MAX_AGE_DAYS,
    ...restsOn(null),
  };
  if (post.ageDays === null)
    return {
      ...base,
      outcome: 'unknown',
      reason: "the post's date is unknown",
    };
  const days = Math.floor(post.ageDays);
  return {
    ...base,
    outcome: days > POST_MAX_AGE_DAYS ? 'fail' : 'pass',
    reason: `posted ${days} days ago`,
  };
}

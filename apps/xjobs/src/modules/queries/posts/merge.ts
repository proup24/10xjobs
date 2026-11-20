import { postKeyword, type PostSearchWords } from './keyword';

interface PostMember {
  params: Record<string, unknown>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function union(lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

/**
 * The words of builders searched together: the first member's hiring word and
 * remote flag, the union of position words and of spellings in first-seen order.
 */
export function postMemberWords(
  queries: readonly PostMember[],
): PostSearchWords {
  const first = queries[0]?.params ?? {};
  return {
    hiringWord: typeof first.hiringWord === 'string' ? first.hiringWord : '',
    positionWords: union(queries.map((q) => strings(q.params.positionWords))),
    spellings: union(queries.map((q) => strings(q.params.spellings))),
    remote: first.remote === true,
  };
}

export function mergedPostKeyword(queries: readonly PostMember[]): string {
  return postKeyword(postMemberWords(queries));
}

/** What post builders share to be searched together: language, position, remote. */
export function postSegmentKey(params: Record<string, unknown>): string {
  return `linkedin_posts|${String(params.language)}|${String(params.position)}|${
    params.remote === true ? 'remote' : 'any'
  }`;
}

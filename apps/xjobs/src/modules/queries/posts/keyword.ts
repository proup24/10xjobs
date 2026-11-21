import { keywordTerm } from '../channels/linkedin_keyword';

export const POST_MAX_OPERATORS = 5;
export const POST_MAX_KEYWORD_CHARS = 500;

export interface PostSearchWords {
  hiringWord: string;
  positionWords: string[];
  spellings: string[];
  remote: boolean;
}

function group(terms: readonly string[]): string {
  const written = terms.map(keywordTerm);
  return written.length === 1 ? written[0] : `(${written.join(' OR ')})`;
}

/** `hiring <(position words)> <(spellings)> [remote]`, terms in the given order. */
export function postKeyword(words: PostSearchWords): string {
  return [
    words.hiringWord,
    group(words.positionWords),
    group(words.spellings),
    ...(words.remote ? ['remote'] : []),
  ].join(' ');
}

/** The `OR` count of the keyword. */
export function postOperators(
  words: Pick<PostSearchWords, 'positionWords' | 'spellings'>,
): number {
  return (
    Math.max(words.positionWords.length - 1, 0) +
    Math.max(words.spellings.length - 1, 0)
  );
}

export function postKeywordFits(words: PostSearchWords): boolean {
  return (
    postOperators(words) <= POST_MAX_OPERATORS &&
    postKeyword(words).length <= POST_MAX_KEYWORD_CHARS
  );
}

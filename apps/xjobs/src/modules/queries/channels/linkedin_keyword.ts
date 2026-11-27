/**
 * LinkedIn silently degrades a long keyword: a 398-character, 34-term
 * superset of the 319-character, 25-term dev keyword returned 51 jobs against
 * 430. Stay within both limits (docs/actors/linkedin-region-test.md §10).
 */
export const LINKEDIN_KEYWORD_MAX_CHARS = 319;
export const LINKEDIN_KEYWORD_MAX_TERMS = 25;

/**
 * Appended to remote searches' keywords. LinkedIn ignores the remote filter
 * (since about 2026-11-18): on 2026-11-27, a Europe remote search returned 25%
 * remote-tagged rows without the word and 97% with it, over the same 24 hours.
 */
export const REMOTE_KEYWORD_SUFFIX = ' AND remote';

export interface KeywordOptions {
  /** Append {@link REMOTE_KEYWORD_SUFFIX}. */
  remote?: boolean;
}

/** Lowercased; quoted when it contains a space or one of `.#+`. */
export function keywordTerm(term: string): string {
  const lower = term.trim().toLowerCase();
  return /[ .#+]/.test(lower) ? `"${lower}"` : lower;
}

function side(words: readonly string[], name: string): string[] {
  const terms = [...new Set(words.map(keywordTerm))].sort();
  if (terms.length === 0) throw new Error(`LinkedIn keyword needs ${name}`);
  return terms;
}

/**
 * `(<roles> OR ...) AND (<spellings> OR ...)`, each side deduped and sorted,
 * then ` AND remote` when `remote` is set.
 */
export function linkedinKeyword(
  roleWords: readonly string[],
  spellings: readonly string[],
  { remote = false }: KeywordOptions = {},
): string {
  const roles = side(roleWords, 'role words');
  const spelled = side(spellings, 'spellings');
  const keyword = `(${roles.join(' OR ')}) AND (${spelled.join(' OR ')})`;
  return remote ? `${keyword}${REMOTE_KEYWORD_SUFFIX}` : keyword;
}

/** True when the keyword stays within LinkedIn's character and term limits. */
export function linkedinKeywordFits(
  roleWords: readonly string[],
  spellings: readonly string[],
  options: KeywordOptions = {},
): boolean {
  const terms = new Set([...roleWords, ...spellings].map(keywordTerm));
  const extra = options.remote ? 1 : 0;
  return (
    terms.size + extra <= LINKEDIN_KEYWORD_MAX_TERMS &&
    linkedinKeyword(roleWords, spellings, options).length <=
      LINKEDIN_KEYWORD_MAX_CHARS
  );
}

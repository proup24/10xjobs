/**
 * LinkedIn silently degrades a long keyword: a 398-character, 34-term
 * superset of the 319-character, 25-term dev keyword returned 51 jobs against
 * 430. Stay within both limits (docs/actors/linkedin-region-test.md §10).
 */
export const LINKEDIN_KEYWORD_MAX_CHARS = 319;
export const LINKEDIN_KEYWORD_MAX_TERMS = 25;

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

/** `(<roles> OR ...) AND (<spellings> OR ...)`, each side deduped and sorted. */
export function linkedinKeyword(
  roleWords: readonly string[],
  spellings: readonly string[],
): string {
  const roles = side(roleWords, 'role words');
  const spelled = side(spellings, 'spellings');
  return `(${roles.join(' OR ')}) AND (${spelled.join(' OR ')})`;
}

/** True when the keyword stays within LinkedIn's character and term limits. */
export function linkedinKeywordFits(
  roleWords: readonly string[],
  spellings: readonly string[],
): boolean {
  const terms = new Set([...roleWords, ...spellings].map(keywordTerm));
  return (
    terms.size <= LINKEDIN_KEYWORD_MAX_TERMS &&
    linkedinKeyword(roleWords, spellings).length <= LINKEDIN_KEYWORD_MAX_CHARS
  );
}

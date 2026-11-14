import { TECHNOLOGY_TERMS } from './keywords';

/**
 * Spellings searched per technology when it differs from the single
 * `TECHNOLOGY_TERMS` wording. The evidence is
 * `docs/actors/linkedin-region-test.md` section 10. Any change here bumps
 * `QUERY_SEARCH_RECIPE_VERSION`.
 */
export const SEARCH_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  nodejs: ['nodejs', 'node.js'],
  nextjs: ['nextjs', 'next.js'],
  nestjs: ['nestjs', 'nest.js'],
};

/** The spellings to search for a technology; throws if it is not searchable. */
export function searchSpellings(technology: string): string[] {
  const entry = Object.hasOwn(SEARCH_SPELLINGS, technology)
    ? SEARCH_SPELLINGS[technology]
    : undefined;
  if (entry) return entry.map((spelling) => spelling.toLowerCase());
  if (!Object.hasOwn(TECHNOLOGY_TERMS, technology)) {
    throw new Error(`Technology "${technology}" is not searchable`);
  }
  return [TECHNOLOGY_TERMS[technology].toLowerCase()];
}

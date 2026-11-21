import { TECHNOLOGY_TERMS } from './keywords';

const OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  nodejs: ['nodejs', 'node.js'],
  nextjs: ['nextjs', 'next.js'],
  nestjs: ['nestjs', 'nest.js'],
  llm: ['llm', 'llms'],
};

/**
 * Spellings searched per technology: every key of `TECHNOLOGY_TERMS`, with its
 * single term unless overridden above. The evidence is
 * `docs/actors/linkedin-region-test.md` section 10. Any change here bumps
 * `QUERY_SEARCH_RECIPE_VERSION`.
 */
export const SEARCH_SPELLINGS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    ...Object.fromEntries(
      Object.entries(TECHNOLOGY_TERMS).map(([key, term]) => [key, [term]]),
    ),
    ...OVERRIDES,
  });

/** The spellings to search for a technology; throws if it is not searchable. */
export function searchSpellings(technology: string): string[] {
  if (!Object.hasOwn(SEARCH_SPELLINGS, technology)) {
    throw new Error(`Technology "${technology}" is not searchable`);
  }
  return SEARCH_SPELLINGS[technology].map((spelling) => spelling.toLowerCase());
}

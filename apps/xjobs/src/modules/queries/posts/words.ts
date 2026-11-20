import { SEARCH_SPELLINGS } from '../builders/search-spellings';

export const POST_LANGUAGES = ['en', 'fr'] as const;
export type PostLanguage = (typeof POST_LANGUAGES)[number];

export const POST_HIRING_WORDS: Readonly<Record<PostLanguage, string>> = {
  en: 'hiring',
  fr: 'recrute',
};

/** Short post phrases per position: 1-2 lowercase words. */
export const POST_POSITION_WORDS: Readonly<Record<string, readonly string[]>> =
  {
    backend_engineer: ['backend', 'back end'],
    frontend_engineer: ['frontend', 'front end'],
    fullstack_engineer: ['fullstack', 'full stack'],
    mobile_engineer: ['mobile developer', 'mobile engineer'],
    devops_engineer: ['devops'],
    site_reliability_engineer: ['sre', 'site reliability'],
    platform_engineer: ['platform engineer'],
    cloud_engineer: ['cloud engineer'],
    security_engineer: ['security engineer'],
    data_engineer: ['data engineer'],
    ml_engineer: ['machine learning engineer', 'ml engineer'],
    ai_engineer: ['ai engineer', 'llm engineer'],
    qa_engineer: ['qa engineer', 'test automation'],
    embedded_engineer: ['embedded engineer', 'embedded software'],
    software_architect: ['software architect'],
    tech_lead: ['tech lead'],
    engineering_manager: ['engineering manager'],
  };

/** Spellings added for posts only; the job board must not change. */
const POST_ONLY: Readonly<Record<string, readonly string[]>> = {
  react: ['reactjs'],
};

const dotless = (spelling: string): string =>
  spelling.replace(/(?<=\w)\.(?=\w)/g, '');

const hasWord = (spelling: string, word: string): boolean =>
  spelling.split(/\s+/).includes(word);

/**
 * Spellings to search in posts per technology, in the given order. Dot
 * variants collapse to the first spelling; a technology whose every spelling
 * contains a kept spelling as a whole word is dropped (react native for react).
 * Throws for a technology that is not searchable, as the job board does.
 */
export function postSpellings(
  technologies: readonly string[],
): { technology: string; spellings: string[] }[] {
  const kept: { technology: string; spellings: string[] }[] = [];
  for (const technology of technologies) {
    if (!Object.hasOwn(SEARCH_SPELLINGS, technology)) {
      throw new Error(`Technology "${technology}" is not searchable`);
    }
    const seen = new Set<string>();
    const spellings: string[] = [];
    for (const raw of [
      ...SEARCH_SPELLINGS[technology],
      ...(POST_ONLY[technology] ?? []),
    ]) {
      const spelling = raw.toLowerCase();
      const key = dotless(spelling);
      if (seen.has(key)) continue;
      seen.add(key);
      spellings.push(spelling);
    }
    const covered = spellings.every((spelling) =>
      kept.some((k) => k.spellings.some((s) => hasWord(spelling, s))),
    );
    if (!covered) kept.push({ technology, spellings });
  }
  return kept;
}

import { POSITION_TITLES } from './keywords';

export type RoleFamily =
  | 'engineer'
  | 'devops'
  | 'architect'
  | 'tech_lead'
  | 'engineering_manager';

const OVERRIDES: Readonly<Record<string, RoleFamily>> = {
  devops_engineer: 'devops',
  site_reliability_engineer: 'devops',
  software_architect: 'architect',
  tech_lead: 'tech_lead',
  engineering_manager: 'engineering_manager',
};

/** The role family of every position in `POSITION_TITLES`; most are `engineer`. */
export const POSITION_ROLE_FAMILY: Readonly<Record<string, RoleFamily>> =
  Object.fromEntries(
    Object.keys(POSITION_TITLES).map((position) => [
      position,
      OVERRIDES[position] ?? 'engineer',
    ]),
  );

const ENGINEER_WORDS: Readonly<Record<string, readonly string[]>> = {
  en: [
    'engineer',
    'developer',
    'engineering',
    'architect',
    'programmer',
    'tech lead',
    'technical lead',
  ],
  fr: ['ingénieur', 'développeur', 'architecte'],
  es: ['ingeniero', 'desarrollador'],
  de: ['entwickler', 'ingenieur'],
  pt: ['engenheiro', 'desenvolvedor', 'programador', 'arquiteto'],
  pl: ['programista', 'inżynier', 'architekt'],
};

/**
 * Role words per family and ISO 639-1 language, lowercase and unquoted. The
 * evidence is `docs/actors/linkedin-region-test.md` section 10. Any change
 * here bumps `QUERY_SEARCH_RECIPE_VERSION`.
 */
export const ROLE_WORDS: Readonly<
  Record<RoleFamily, Readonly<Partial<Record<string, readonly string[]>>>>
> = {
  engineer: ENGINEER_WORDS,
  devops: {
    ...ENGINEER_WORDS,
    en: [...ENGINEER_WORDS.en, 'devops', 'sre'],
  },
  architect: {
    en: ['architect'],
    fr: ['architecte'],
    es: ['arquitecto'],
    de: ['architekt'],
    pt: ['arquiteto'],
    pl: ['architekt'],
  },
  tech_lead: {
    en: ['tech lead', 'technical lead', 'lead developer'],
    fr: ['lead technique', 'lead dev'],
    es: ['líder técnico'],
    pt: ['líder técnico'],
  },
  engineering_manager: {
    en: ['engineering manager', 'head of engineering'],
  },
};

/** English plus each listed language that has a column: lowercased, deduped, sorted. */
export function roleWords(
  position: string,
  languages: readonly string[],
): string[] {
  const family = POSITION_ROLE_FAMILY[position];
  if (!family) throw new Error(`No role family for position "${position}"`);
  const table = ROLE_WORDS[family];
  const words = ['en', ...languages].flatMap((lang) => table[lang] ?? []);
  return [...new Set(words.map((word) => word.toLowerCase()))].sort();
}

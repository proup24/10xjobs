import { Arrangement, Channel } from 'src/common/enums';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash } from '../builders';
import { topSkills } from '../sets/technology';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { postKeyword, postKeywordFits, type PostSearchWords } from './keyword';
import {
  POST_HIRING_WORDS,
  POST_LANGUAGES,
  POST_POSITION_WORDS,
  postSpellings,
  type PostLanguage,
} from './words';

const isPostLanguage = (language: string): language is PostLanguage =>
  (POST_LANGUAGES as readonly string[]).includes(language);

/**
 * The profile's LinkedIn post searches: per post language (English only for a
 * profile with a remote place), its top technologies packed greedily in rank
 * order into the fewest groups whose keyword fits the operator limits. A
 * technology's spellings are never split across groups.
 */
export function postRecipes(
  input: QuerySearchProfileInput,
): QuerySearchRecipe[] {
  const positionWords = [...(POST_POSITION_WORDS[input.position] ?? [])];
  if (positionWords.length === 0) return [];
  const ranked = topSkills(input.skills);
  if (ranked.length === 0) return [];
  const domains = new Map(
    ranked.map((skill) => [skill.technology, skill.domain]),
  );
  const kept = postSpellings(ranked.map((skill) => skill.technology));
  const hasRemote = input.locations.remote.length > 0;
  const languages = [...new Set(['en', ...input.languages])].filter(
    (language): language is PostLanguage =>
      isPostLanguage(language) && (language !== 'en' || hasRemote),
  );

  const recipes: QuerySearchRecipe[] = [];
  for (const language of languages) {
    const remote = language === 'en';
    const words = (spellings: string[]): PostSearchWords => ({
      hiringWord: POST_HIRING_WORDS[language],
      positionWords,
      spellings,
      remote,
    });
    const groups: { technologies: string[]; spellings: string[] }[] = [];
    for (const { technology, spellings } of kept) {
      const last = groups.at(-1);
      if (last && postKeywordFits(words([...last.spellings, ...spellings]))) {
        last.technologies.push(technology);
        last.spellings.push(...spellings);
      } else {
        groups.push({ technologies: [technology], spellings: [...spellings] });
      }
    }
    for (const group of groups) {
      const search = words(group.spellings);
      const recipe = {
        channel: Channel.LINKEDIN_POSTS,
        position: input.position,
        location: 'any',
        experience: 'unstated',
        type: remote ? Arrangement.remote : Arrangement.unstated,
        technologies: group.technologies,
        domain: domains.get(group.technologies[0])!,
        languages: input.languages,
        version: QUERY_SEARCH_RECIPE_VERSION,
        keyword: postKeyword(search),
        params: { language, position: input.position, ...search },
      };
      recipes.push({ ...recipe, hash: recipeHash(recipe) });
    }
  }
  return recipes;
}

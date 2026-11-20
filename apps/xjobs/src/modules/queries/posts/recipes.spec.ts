import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash } from '../builders';
import { QuerySearchService } from '../services/queries.service';
import { FakeQuerySearchRepository } from '../testing/fakes';
import type { QuerySearchProfileInput } from '../types';
import { postRecipes } from './recipes';

const skill = (technology: string, mastery: number) => ({
  technology,
  domain: SkillDomain.fullstack,
  importance: 5,
  mastery,
});

/** The owner's profile: fullstack, English and French, remote plus Morocco. */
const owner: QuerySearchProfileInput = {
  position: 'fullstack_engineer',
  seniorities: ['senior'],
  languages: ['en', 'fr'],
  locations: {
    remote: ['EMEA', 'European Union'],
    hybrid: ['Morocco'],
    onsite: ['Morocco'],
  },
  skills: [
    skill('typescript', 10),
    skill('nodejs', 10),
    skill('react', 10),
    skill('react_native', 10),
    skill('nextjs', 10),
    skill('nestjs', 10),
    skill('aws', 8),
    skill('postgresql', 8),
  ],
};

// Order follows topSkills: equal importance and mastery sort by name.
const keywords = (input: QuerySearchProfileInput) =>
  postRecipes(input).map((recipe) => recipe.keyword);

// Captured from expand(owner) at 28dee17, before post recipes existed.
const BASE_HASHES: string[] = [
  '26b4baf50c09185c533f96ed62af6caa13adabdd126b7ad25f36fc5f6e9c2fe2',
  '28d8329c73fc2b9e56ef6fde0da6a39fec076dc470c0e6bfb905a7d542b97392',
  '2974421729794d7787e11753c528dccc58a8eeffc24a0d39b7a34e96d622b314',
  '2ac5a7a830902f8b8bbbcc26107b468dda2acde1c12cbb9dce9ba07f77225eb4',
  '2f07449b4041eca1882a8322f4b04c347023866ad2d474a8035ccbba44117373',
  '3887252d64b5c39bf37ea64613ad0aca8cca314ab6c175447aef6e90d5ca63a3',
  '47ecc8db5768e9969cbfb7b0b8714ff23a73c8160b3d8d480215b0b7b0decdea',
  '5d01f2252170bf2555ae3f8e034e8f6cab7b4fcba71638d92ddda9975afb3378',
  'a3dbdcac8cb5fd0d488995656fca80d26e73dec475e1eaaf48a2c63233f1db2f',
  'ade139a970128348f2edab78a018fd91b632da87e9f81994ed7f49fa49a6d85f',
  'dc8051d51bee083943fa91d9d74ec01363570fae611dfe34e3de43aea93f2c22',
  'e34ff418229d44663ac3edb3d5af36c0160194d9fa818b129b6c002464746c3e',
  'ee26e197e923ca694c861c23644dcfd90c5b08bfa1d851ebb4890a0662959f29',
  'ef599746d4eb6ba41ac669421943f1c43c0b7d49794bb76fcd422c78fe392513',
  'fd54f399bd3fa4e3c4c8df30e67bfe2ff834b6a36b54dcbd4bb087e15602b54c',
];

describe('postRecipes', () => {
  it("gives the owner's profile four searches", () => {
    expect(keywords(owner)).toEqual([
      'hiring (fullstack OR "full stack") (nestjs OR nextjs OR nodejs OR react OR reactjs) remote',
      'hiring (fullstack OR "full stack") (typescript OR aws OR postgresql) remote',
      'recrute (fullstack OR "full stack") (nestjs OR nextjs OR nodejs OR react OR reactjs)',
      'recrute (fullstack OR "full stack") (typescript OR aws OR postgresql)',
    ]);
  });

  it('fills the columns and params of a post recipe', () => {
    const [english, , french] = postRecipes(owner);
    expect(english).toMatchObject({
      channel: Channel.LINKEDIN_POSTS,
      location: 'any',
      experience: 'unstated',
      type: Arrangement.remote,
      technologies: ['nestjs', 'nextjs', 'nodejs', 'react'],
      domain: SkillDomain.fullstack,
      version: QUERY_SEARCH_RECIPE_VERSION,
      params: {
        language: 'en',
        position: 'fullstack_engineer',
        hiringWord: 'hiring',
        positionWords: ['fullstack', 'full stack'],
        spellings: ['nestjs', 'nextjs', 'nodejs', 'react', 'reactjs'],
        remote: true,
      },
    });
    expect(french).toMatchObject({
      type: Arrangement.unstated,
      params: { language: 'fr', hiringWord: 'recrute', remote: false },
    });
    for (const recipe of postRecipes(owner))
      expect(recipe.hash).toBe(recipeHash(recipe));
    expect(new Set(postRecipes(owner).map((r) => r.hash)).size).toBe(4);
  });

  it('searches English only for remote', () => {
    const onsite = {
      ...owner,
      locations: { remote: [], hybrid: ['Morocco'], onsite: ['Morocco'] },
    };
    expect(keywords(onsite)).toEqual([
      'recrute (fullstack OR "full stack") (nestjs OR nextjs OR nodejs OR react OR reactjs)',
      'recrute (fullstack OR "full stack") (typescript OR aws OR postgresql)',
    ]);
    expect(keywords({ ...onsite, languages: ['en'] })).toEqual([]);
  });

  it('ignores languages without hiring words', () => {
    const recipes = postRecipes({ ...owner, languages: ['en', 'es'] });
    expect(recipes).toHaveLength(2);
    expect(recipes.every((r) => r.params.language === 'en')).toBe(true);
  });

  it('keeps job-board hashes', () => {
    const service = new QuerySearchService(new FakeQuerySearchRepository());
    expect(
      service
        .expand(owner)
        .map((recipe) => recipe.hash)
        .sort(),
    ).toEqual(BASE_HASHES);
  });
});

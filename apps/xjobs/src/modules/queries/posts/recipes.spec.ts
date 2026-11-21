import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import { QUERY_SEARCH_RECIPE_VERSION, recipeHash } from '../builders';
import { QuerySearchService } from '../services/queries.service';
import { FakeQuerySearchRepository } from '../testing/fakes';
import type { QuerySearchProfileInput } from '../types';
import { postKeywordFits } from './keyword';
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

// Captured from expand(owner) at 28dee17, before post recipes existed; re-captured for recipe version 14.
const BASE_HASHES: string[] = [
  '16c06679ead7026e32148b18c16a434f20a780ccef6e46e98f7967cd6ba5deba',
  '2b366ecd50dd0b2d64739b607be5942a5a7b4d915088be47a172cbe1e3917ccf',
  '4a0181e9b6fd2f59f2876d7df1b248601edab48ca9f346a82d5874e5438cb290',
  '5bfe8be3bc3303f8517e676e6a0ac4210013abe625e3bc1cd23a62e81d9c79e9',
  '8896493c78c0216561cc6454cd31596c7c19849c3eabed307e847376beb8408e',
  '8975d2c75297b2e20a623e42146d55accf8c19ebf367135f7a6dd92aa59d6329',
  '9619017d8142b778355d913ba227cd43e351b650a6b51ab7529cc7187e804ea3',
  '9619128b95ea97e19469e957933b8c28c6c190413863eab277054747048b9689',
  'a1973a823598f7ae83c31cfcc9e56900f33f0ee8b212499b7671472e3d0e4976',
  'a88b2944a952fae7839f6906d342e2f3303513396e626e49fe0e43ae2346c031',
  'cadcf3a89b06a2a59d768259a70e8d0fd619cb9ad4f545582ccad0a129240833',
  'e0e2785db4dae5af7d8baf85dc8027ad51588e3be7746933d79f9583d46acfc4',
  'e93f172349ac1a283dcc9537b482b0b371f1edf796b094f777e55dcc3b30bec9',
  'ebb1f10e6c49ace1a4cbc0e70947ae72dd65446b19dbf8423a088ade70f6679b',
  'f8199f96df54fb3af6a5f82c2c744e64fb21b2a5e2921cc42174a67f63369702',
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

  it("llm's two spellings count toward the operator limit", () => {
    const profile = {
      ...owner,
      languages: ['en'],
      skills: [
        skill('llm', 10),
        skill('typescript', 9),
        skill('nodejs', 8),
        skill('aws', 7),
        skill('postgresql', 6),
        skill('docker', 5),
      ],
    };
    const recipes = postRecipes(profile);
    expect(recipes.length).toBeGreaterThan(1);
    for (const recipe of recipes) {
      expect(
        postKeywordFits({
          hiringWord: 'hiring',
          positionWords: ['fullstack', 'full stack'],
          spellings: recipe.keyword
            .match(/\b[a-z.]+\b/g)!
            .filter((w) =>
              [
                'llm',
                'llms',
                'typescript',
                'nodejs',
                'node.js',
                'aws',
                'postgresql',
                'docker',
              ].includes(w),
            ),
          remote: true,
        }),
      ).toBe(true);
    }
    const withLlm = recipes.filter((r) => /\bllm\b/.test(r.keyword));
    expect(withLlm).toHaveLength(1);
    expect(withLlm[0].keyword).toMatch(/\bllms\b/);
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

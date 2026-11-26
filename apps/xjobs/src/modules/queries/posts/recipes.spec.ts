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

// Captured from expand(owner) at 28dee17, before post recipes existed; re-captured for recipe version 15.
const BASE_HASHES: string[] = [
  '10af5f2c0cb94df1ea0fc4ec0876aa96ebf44bc7be1ea90a5e573796e5a6cea9',
  '164cb2a089a6d47576bc1657f93cfc89ce46ed19bcb7065c05f1cc4177243fe9',
  '1a8e4fb0681ff72c4dc5304b7764699dca2f61fbcedb88a9d8744b548f261673',
  '2582e7a0178b3da610423cd645ce48d936bd86832f4e91f8d61d794e1d5f49bb',
  '3d96842075d37dce9b9fe95c1b4a741cb0555873c6082ec9a329cc6474187c96',
  '431d26b421756a8acfbd53683e72843c959460d7609d5ddc867cacadfa4949c6',
  '441d37420459c0306bc7667fa284706ce37b3fd13859db4e06d98e2284e22dd3',
  '60948768e6a1da69ed7a2ca070405f5260e6d393e1b95ede15a13f3b9af375e3',
  '966dbd081d39e45c8ce243245316d20dcd48c96c1950a6ad901475965a976cb7',
  '96df482a7e0e07969c73fb9b1c958e59d9fdc891cae624d2389787695a9534e1',
  'b04ceda95c5aab5cc8b8890970290628770364cc42e92d4ee071f01f4d1fc8e7',
  'ce6c99191acffb3e09908d0e180053c2dc347f94cacdcc5b9bed8eb2f0926ada',
  'e124de51b49c6d60e62b8b683955bd67b4aceb553b919b5ee9f10e46020f836e',
  'e7ded773d0e6a6104d008ddc6eefc73fb0e1cbb4828d1c435b1b0af4a775f6af',
  'ee15061c7468260751c5a1d8dc8f90f7269c7503d8518c47bb19bdd30ee45b18',
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

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
  '050db5fbfd3852d1e4dc3a2fe8f60c1888a8acd50ab518ee396eb805d1dd49fe',
  '14495dd770334a88d0de433c49a50b8cdd82ce8ebf43005182694dbc2687a416',
  '14e99d4bc094d6f981a32ba25dd7dc05da9f1e0addddddab05f28985279e3cfa',
  '3783a71e42c2fa8e7e131bd2cf1af6c14ea64370954f8311f7ad5421575bd531',
  '3c08f71376c44e73e543cf3286d5dadd545f648f452388d21fa6fbd4e5f58403',
  '3d81123a62faabf1dc46f3eaca0688d8e11f593c619dee8fffb6a226e9855e48',
  '4e380e8f23f0876a8ce3b1a31535657f4b936591710e66b64aefcdb303d8f48a',
  '5c4f61addde2a59716e598e66b8c3d28a66672db0661aeb30577e27d36ff88d4',
  '61d913e0a0f190f259676294f933ef7f33c0482d28d4b44e9531fb3eccf997eb',
  '8e65883fc2dd03afec6a1a02355336117da7d635d50833ce927c2f8d6a1e96b3',
  'a284af619f1e4374e811faa43e66f321e2957a78458edf91f3826f9636fdf88f',
  'a49e300bbe9f646c7bd1c48521d14122e4b965d7738f22233cfbe1290ba95a68',
  'b1057f6557fe16e46054e930de28edf907f0dc3b587bb2f74c4c174af8ae57a8',
  'b37d6f0885943567faeb053d197d798db106a1d62f248d1b8969e8b98054ed87',
  'b59195279f6761e3f11c06bc6ab915140f40de36cc38b18f49186b7321ec41ac',
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

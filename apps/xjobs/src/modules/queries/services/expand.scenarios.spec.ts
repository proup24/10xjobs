import { BadRequestException } from '@nestjs/common';
import {
  Arrangement,
  Channel,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import {
  LOCATIONS_REQUIRED,
  SENIORITIES_REQUIRED,
  SKILLS_REQUIRED,
} from '../steps';
import { FakeQuerySearchRepository } from '../testing/fakes';
import { MOCK_PROFILES, summarize } from '../testing/profiles.fixture';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { QuerySearchService } from './queries.service';

// These specs cover every channel's builder, inactive ones included.
vi.mock('src/common/enums', async (importOriginal) => {
  const enums = await importOriginal<typeof import('src/common/enums')>();
  return { ...enums, ACTIVE_CHANNELS: Object.values(enums.Channel) };
});

const service = new QuerySearchService(new FakeQuerySearchRepository());
const expand = (input: QuerySearchProfileInput) => service.expand(input);
const on = (recipes: QuerySearchRecipe[], channel: Channel) =>
  recipes.filter((recipe) => recipe.channel === channel);
const keywords = (recipes: QuerySearchRecipe[], channel: Channel) =>
  [...new Set(on(recipes, channel).map((recipe) => recipe.keyword))].sort();
const ofType = (recipes: QuerySearchRecipe[], type: Arrangement) =>
  recipes.filter((recipe) => recipe.type === type);
const hashSet = (recipes: QuerySearchRecipe[]) =>
  new Set(recipes.map((recipe) => recipe.hash));
const empty = { remote: [], hybrid: [], onsite: [] };

describe('expand scenarios over mock profiles', () => {
  it('remote backend in two locations: top 2 technologies alone, one search per location', () => {
    const recipes = expand(MOCK_PROFILES.remoteBackendMa);
    expect(recipes).toHaveLength(16);
    expect(hashSet(recipes).size).toBe(16);
    expect(recipes.every((r) => r.type === Arrangement.remote)).toBe(true);
    expect(recipes.every((r) => r.technologies.length === 1)).toBe(true);
    expect(
      recipes.some((r) => r.technologies.includes(Technology.postgresql)),
    ).toBe(false);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      'nestjs',
      'typescript',
    ]);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.params),
    ).toEqual([
      { location: 'emea', experienceLevel: '4', workType: '2' },
      { location: 'emea', experienceLevel: '4', workType: '2' },
      { location: 'european union', experienceLevel: '4', workType: '2' },
      { location: 'european union', experienceLevel: '4', workType: '2' },
    ]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") nestjs senior remote emea',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") nestjs senior remote european union',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") typescript senior remote emea',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") typescript senior remote european union',
    ]);
  });

  it('onsite frontend in Paris: one location, on every channel', () => {
    const recipes = expand(MOCK_PROFILES.onsiteFrontendParis);
    expect(recipes).toHaveLength(8);
    for (const recipe of recipes) {
      expect(recipe).toMatchObject({
        type: Arrangement.onsite,
        location: 'paris, france',
      });
    }
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => [r.keyword, r.params]),
    ).toEqual([
      [
        'react',
        { location: 'paris, france', experienceLevel: '3,4', workType: '1' },
      ],
      [
        'next js',
        { location: 'paris, france', experienceLevel: '3,4', workType: '1' },
      ],
    ]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("frontend engineer" OR "frontend developer" OR "front end engineer") "next.js" paris, france',
      'hiring ("frontend engineer" OR "frontend developer" OR "front end engineer") react paris, france',
    ]);
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY]) {
      for (const recipe of on(recipes, channel)) {
        expect(recipe.params).toEqual({ remote: false });
        expect(recipe.keyword).toMatch(/ "paris, france"$/);
      }
    }
  });

  it('hybrid + remote devops: each arrangement in its own location, ties broken by mastery then name', () => {
    const recipes = expand(MOCK_PROFILES.hybridAndRemoteDevops);
    expect(recipes).toHaveLength(16);
    const hybrid = ofType(recipes, Arrangement.hybrid);
    const remote = ofType(recipes, Arrangement.remote);
    expect(hybrid).toHaveLength(8);
    expect(remote).toHaveLength(8);
    expect(hybrid.every((r) => r.location === 'austin, united states')).toBe(
      true,
    );
    expect(remote.every((r) => r.location === 'north america')).toBe(true);
    expect(recipes.some((r) => r.technologies.includes(Technology.aws))).toBe(
      false,
    );
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      'kubernetes',
      'terraform',
    ]);
    expect(
      on(hybrid, Channel.LINKEDIN_JOB_BOARD).every(
        (r) => r.params.workType === '3',
      ),
    ).toBe(true);
  });

  it('golden: hybrid + remote devops output', () => {
    expect(summarize(expand(MOCK_PROFILES.hybridAndRemoteDevops)))
      .toMatchInlineSnapshot(`
      [
        "ASHBY | devops | hybrid | austin, united states | ("devops engineer" OR "devops") kubernetes staff "austin, united states" | {"remote":false}",
        "ASHBY | devops | hybrid | austin, united states | ("devops engineer" OR "devops") terraform staff "austin, united states" | {"remote":false}",
        "ASHBY | devops | remote | north america | ("devops engineer" OR "devops") kubernetes staff "remote" "north america" | {"remote":true}",
        "ASHBY | devops | remote | north america | ("devops engineer" OR "devops") terraform staff "remote" "north america" | {"remote":true}",
        "GREEN_HOUSE | devops | hybrid | austin, united states | ("devops engineer" OR "devops") kubernetes staff "austin, united states" | {"remote":false}",
        "GREEN_HOUSE | devops | hybrid | austin, united states | ("devops engineer" OR "devops") terraform staff "austin, united states" | {"remote":false}",
        "GREEN_HOUSE | devops | remote | north america | ("devops engineer" OR "devops") kubernetes staff "remote" "north america" | {"remote":true}",
        "GREEN_HOUSE | devops | remote | north america | ("devops engineer" OR "devops") terraform staff "remote" "north america" | {"remote":true}",
        "LINKEDIN_JOB_BOARD | devops | hybrid | austin, united states | kubernetes | {"experienceLevel":"4,5","location":"austin, united states","workType":"3"}",
        "LINKEDIN_JOB_BOARD | devops | hybrid | austin, united states | terraform | {"experienceLevel":"4,5","location":"austin, united states","workType":"3"}",
        "LINKEDIN_JOB_BOARD | devops | remote | north america | kubernetes | {"experienceLevel":"4,5","location":"north america","workType":"2"}",
        "LINKEDIN_JOB_BOARD | devops | remote | north america | terraform | {"experienceLevel":"4,5","location":"north america","workType":"2"}",
        "LINKEDIN_POSTS | devops | hybrid | austin, united states | hiring ("devops engineer" OR "devops") kubernetes staff austin, united states | {}",
        "LINKEDIN_POSTS | devops | hybrid | austin, united states | hiring ("devops engineer" OR "devops") terraform staff austin, united states | {}",
        "LINKEDIN_POSTS | devops | remote | north america | hiring ("devops engineer" OR "devops") kubernetes staff remote north america | {}",
        "LINKEDIN_POSTS | devops | remote | north america | hiring ("devops engineer" OR "devops") terraform staff remote north america | {}",
      ]
    `);
  });

  it('unstated seniority: no seniority word or level', () => {
    const recipes = expand(MOCK_PROFILES.unstatedSeniority);
    expect(recipes).toHaveLength(4);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => [r.keyword, r.params]),
    ).toEqual([['python', { location: 'asia pacific', workType: '2' }]]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("data engineer" OR "data platform engineer") python remote asia pacific',
    ]);
  });

  describe('seniorities', () => {
    const base = MOCK_PROFILES.remoteBackendMa;
    const { senior, staff, unstated } = Seniority;
    const levels = (recipes: QuerySearchRecipe[]) =>
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map(
        (r) => r.params.experienceLevel,
      );

    it('one search per seniority, shared across profiles', () => {
      const a = expand({ ...base, seniorities: [senior, staff] });
      const b = expand({ ...base, seniorities: [staff] });
      expect(a).toHaveLength(2 * b.length);
      expect([...hashSet(b)].every((hash) => hashSet(a).has(hash))).toBe(true);
      const counts = levels(a).reduce<Record<string, number>>(
        (acc, level) => ({
          ...acc,
          [String(level)]: (acc[String(level)] ?? 0) + 1,
        }),
        {},
      );
      expect(counts).toEqual({ '4': 4, '4,5': 4 });
    });

    it('the same set in another order gives the same recipes', () => {
      expect(
        hashSet(expand({ ...base, seniorities: [staff, senior] })),
      ).toEqual(hashSet(expand({ ...base, seniorities: [senior, staff] })));
    });

    it('duplicate seniorities do not duplicate recipes', () => {
      expect(expand({ ...base, seniorities: [senior, senior] })).toHaveLength(
        expand({ ...base, seniorities: [senior] }).length,
      );
    });

    it('unstated alongside a level: only the unstated searches drop the level', () => {
      const recipes = expand({ ...base, seniorities: [unstated, senior] });
      const ofLevel = (level: Seniority) =>
        recipes.filter((r) => r.experience === level);
      expect(ofLevel(unstated)).toHaveLength(recipes.length / 2);
      expect(ofLevel(senior)).toHaveLength(recipes.length / 2);
      expect(
        on(ofLevel(unstated), Channel.LINKEDIN_JOB_BOARD).every(
          (r) => !('experienceLevel' in r.params),
        ),
      ).toBe(true);
      expect(
        keywords(ofLevel(unstated), Channel.LINKEDIN_POSTS).every(
          (k) => !/\bsenior\b/.test(k),
        ),
      ).toBe(true);
      expect(
        on(ofLevel(senior), Channel.LINKEDIN_JOB_BOARD).every(
          (r) => r.params.experienceLevel === '4',
        ),
      ).toBe(true);
      expect(
        keywords(ofLevel(senior), Channel.LINKEDIN_POSTS).every((k) =>
          /\bsenior\b/.test(k),
        ),
      ).toBe(true);
    });

    const searchKey = (r: QuerySearchRecipe) =>
      JSON.stringify([
        r.channel,
        r.type,
        r.location,
        r.technologies,
        r.domain,
        r.keyword,
        Object.entries(r.params).sort(),
      ]);

    it('levels that build the same search run it once, kept at the lowest level', () => {
      const { lead, principal } = Seniority;
      const recipes = expand({
        ...base,
        seniorities: [senior, staff, lead, principal],
      });
      const keys = recipes.map(searchKey);
      expect(new Set(keys).size).toBe(keys.length);
      // staff, lead and principal share f_E 4,5 and the title-free keyword.
      expect(
        on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.experience),
      ).not.toContain(lead);
      expect(
        on(recipes, Channel.LINKEDIN_JOB_BOARD).filter(
          (r) => r.experience === staff,
        ),
      ).toHaveLength(4);
      // The other channels name each level, so every level keeps its search.
      expect(
        on(recipes, Channel.LINKEDIN_POSTS).filter(
          (r) => r.experience === lead,
        ),
      ).toHaveLength(4);
    });

    it('mid and unstated build the same keyword search once', () => {
      const { mid } = Seniority;
      const recipes = expand({ ...base, seniorities: [mid, unstated] });
      const keys = recipes.map(searchKey);
      expect(new Set(keys).size).toBe(keys.length);
      expect(
        on(recipes, Channel.LINKEDIN_POSTS).map((r) => r.experience),
      ).not.toContain(unstated);
    });

    it('rejects an empty seniority set', () => {
      expect(() => expand({ ...base, seniorities: [] })).toThrow(
        new BadRequestException(SENIORITIES_REQUIRED),
      );
    });
  });

  it('onsite only: only onsite builders, in that location', () => {
    const recipes = expand(MOCK_PROFILES.onsiteOnlyCasablanca);
    expect(recipes).toHaveLength(8);
    expect(ofType(recipes, Arrangement.onsite)).toHaveLength(8);
    expect(recipes.every((r) => r.location === 'casablanca, morocco')).toBe(
      true,
    );
  });

  it('remote worldwide: LinkedIn searches worldwide, keyword channels add no place', () => {
    const recipes = expand(MOCK_PROFILES.remoteWorldwide);
    expect(recipes).toHaveLength(8);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).every(
        (r) => r.params.location === 'worldwide',
      ),
    ).toBe(true);
    for (const channel of [
      Channel.LINKEDIN_POSTS,
      Channel.GREEN_HOUSE,
      Channel.ASHBY,
    ])
      for (const recipe of on(recipes, channel))
        expect(recipe.keyword).not.toContain('worldwide');
  });

  it('no locations: publish is rejected, nothing generated', () => {
    const run = () => expand(MOCK_PROFILES.noLocations);
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(LOCATIONS_REQUIRED);
  });

  it('no ranked skills: publish is rejected, nothing generated', () => {
    const run = () => expand(MOCK_PROFILES.noRankedSkills);
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(SKILLS_REQUIRED);
  });

  it('techs without search wording only (saas, microservices): rejected like no skills, nothing generated', () => {
    const run = () => expand(MOCK_PROFILES.conceptTagsOnly);
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(SKILLS_REQUIRED);
  });

  it('every recipe carries the domain of its technology', () => {
    const recipes = expand(MOCK_PROFILES.remoteBackendMa);
    for (const recipe of recipes) {
      expect(recipe.domain).toBe(
        recipe.technologies[0] === Technology.nestjs
          ? SkillDomain.backend
          : SkillDomain.fullstack,
      );
    }
  });

  it('lead tech lead: the seniority word is not repeated', () => {
    const recipes = expand(MOCK_PROFILES.leadTechLead);
    expect(recipes).toHaveLength(4);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      'typescript',
    ]);
  });

  it('ties and duplicates: best rank wins, importance 0 dropped, locations deduped', () => {
    const recipes = expand(MOCK_PROFILES.tiesAndDuplicates);
    expect(recipes).toHaveLength(8);
    expect(hashSet(recipes).size).toBe(8);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.technologies),
    ).toEqual([[Technology.go], [Technology.rust]]);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.domain),
    ).toEqual([SkillDomain.backend, SkillDomain.backend]);
    expect(recipes.some((r) => r.technologies.includes(Technology.java))).toBe(
      false,
    );
  });

  it('messy location: same builders as the clean profile', () => {
    expect(hashSet(expand(MOCK_PROFILES.messyLocation))).toEqual(
      hashSet(
        expand({
          ...MOCK_PROFILES.messyLocation,
          locations: { ...empty, onsite: ['casablanca, morocco'] },
        }),
      ),
    );
  });

  it('same location in two arrangements: separate builders', () => {
    const recipes = expand(MOCK_PROFILES.sameLocationTwoArrangements);
    const hybrid = hashSet(ofType(recipes, Arrangement.hybrid));
    const onsite = hashSet(ofType(recipes, Arrangement.onsite));
    expect(hybrid.size).toBe(8);
    expect(onsite.size).toBe(8);
    expect([...hybrid].some((hash) => onsite.has(hash))).toBe(false);
  });

  describe('sharing across profiles', () => {
    it('same onsite location, different remote locations: identical onsite builders', () => {
      const paris = MOCK_PROFILES.onsiteFrontendParis;
      const onsite = (remote: string[]) =>
        hashSet(
          ofType(
            expand({ ...paris, locations: { ...paris.locations, remote } }),
            Arrangement.onsite,
          ),
        );
      expect(onsite(['Europe'])).toEqual(onsite(['EMEA', 'United Kingdom']));
    });

    it('same location typed differently: identical builders', () => {
      const paris = MOCK_PROFILES.onsiteFrontendParis;
      const at = (onsite: string) =>
        hashSet(
          expand({ ...paris, locations: { ...empty, onsite: [onsite] } }),
        );
      expect(at('paris, france')).toEqual(at(' PARIS,  France '));
      expect(at('paris, france')).toEqual(hashSet(expand(paris)));
    });

    it('same search under two domains: separate builders', () => {
      const backend = MOCK_PROFILES.remoteBackendMa;
      const fullstack = {
        ...backend,
        skills: backend.skills.map((skill) => ({
          ...skill,
          domain: SkillDomain.fullstack,
        })),
      };
      const a = expand(backend).filter(
        (r) => r.technologies[0] === Technology.nestjs,
      );
      const b = expand(fullstack).filter(
        (r) => r.technologies[0] === Technology.nestjs,
      );
      expect(a.map((r) => r.keyword)).toEqual(b.map((r) => r.keyword));
      expect([...hashSet(a)].some((hash) => hashSet(b).has(hash))).toBe(false);
    });

    it('different locations: no builder is shared', () => {
      const paris = expand(MOCK_PROFILES.onsiteFrontendParis);
      const lyon = expand({
        ...MOCK_PROFILES.onsiteFrontendParis,
        locations: { ...empty, onsite: ['Lyon, France'] },
      });
      expect([...hashSet(paris)].some((hash) => hashSet(lyon).has(hash))).toBe(
        false,
      );
    });
  });
});

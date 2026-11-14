import { BadRequestException } from '@nestjs/common';
import { Arrangement, Channel, Seniority, SkillDomain } from 'src/common/enums';
import {
  LOCATIONS_REQUIRED,
  SENIORITIES_REQUIRED,
  SKILLS_REQUIRED,
} from '../steps';
import { FakeQuerySearchRepository } from '../testing/fakes';
import { MOCK_PROFILES, summarize } from '../testing/profiles.fixture';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { roleWords } from '../builders/role-words';
import {
  linkedinKeyword,
  linkedinKeywordFits,
} from '../channels/linkedin_keyword';
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
const roles = (position: string) => roleWords(position, ['en']);
const BACKEND_ROLES = roles('backend_engineer');
const LEVEL_4 = { experienceLevel: '4', workType: '2' };
const notBoard = (recipes: QuerySearchRecipe[]) =>
  recipes.filter((recipe) => recipe.channel !== Channel.LINKEDIN_JOB_BOARD);

describe('expand scenarios over mock profiles', () => {
  it('remote backend in two locations: the board searches every technology once per search place, other channels one technology each', () => {
    const recipes = expand(MOCK_PROFILES.remoteBackendMa);
    // Other channels: 3 channels x 3 technologies x 2 locations = 18.
    // Board, one level (senior = 4): EMEA gives africa, europe and middle east,
    // European Union gives europe again (the same search), so 3. Total 21.
    expect(recipes).toHaveLength(21);
    expect(hashSet(recipes).size).toBe(21);
    expect(recipes.every((r) => r.type === Arrangement.remote)).toBe(true);
    expect(notBoard(recipes).every((r) => r.technologies.length === 1)).toBe(
      true,
    );
    const spellings = ['nest.js', 'nestjs', 'postgresql', 'typescript'];
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      linkedinKeyword(BACKEND_ROLES, spellings),
    ]);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.technologies),
    ).toEqual(Array(3).fill(['nestjs', 'typescript', 'postgresql']));
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.params),
    ).toEqual(
      [
        ['africa', '103537801'],
        ['europe', '100506914'],
        ['middle east', '91000001'],
      ].map(([location, geoId]) => ({
        location,
        geoId,
        ...LEVEL_4,
        roleWords: BACKEND_ROLES,
        spellings,
      })),
    );
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") nestjs senior remote emea',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") nestjs senior remote european union',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") postgresql senior remote emea',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") postgresql senior remote european union',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") typescript senior remote emea',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") typescript senior remote european union',
    ]);
  });

  it('onsite frontend in Paris: one location, on every channel', () => {
    const recipes = expand(MOCK_PROFILES.onsiteFrontendParis);
    // Other channels: 3 x 2 technologies = 6. Board: France, levels 3 and 4 = 2.
    expect(recipes).toHaveLength(8);
    for (const recipe of recipes) {
      expect(recipe).toMatchObject({
        type: Arrangement.onsite,
        location:
          recipe.channel === Channel.LINKEDIN_JOB_BOARD
            ? 'france'
            : 'paris, france',
      });
    }
    const frontend = roles('frontend_engineer');
    const spellings = ['next.js', 'nextjs', 'react'];
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => [r.keyword, r.params]),
    ).toEqual(
      ['3', '4'].map((experienceLevel) => [
        linkedinKeyword(frontend, spellings),
        {
          location: 'france',
          geoId: '105015875',
          experienceLevel,
          workType: '1',
          roleWords: frontend,
          spellings,
        },
      ]),
    );
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

  it('hybrid + remote devops: each arrangement in its own location', () => {
    const recipes = expand(MOCK_PROFILES.hybridAndRemoteDevops);
    // Other channels: 3 x 3 technologies = 9 per arrangement. Board, levels 4
    // and 5 (staff): hybrid Austin gives united states = 2; remote North America
    // gives canada and united states = 4. Total 11 hybrid + 13 remote.
    expect(recipes).toHaveLength(24);
    const hybrid = ofType(recipes, Arrangement.hybrid);
    const remote = ofType(recipes, Arrangement.remote);
    expect(hybrid).toHaveLength(11);
    expect(remote).toHaveLength(13);
    expect(
      notBoard(hybrid).every((r) => r.location === 'austin, united states'),
    ).toBe(true);
    expect(
      on(hybrid, Channel.LINKEDIN_JOB_BOARD).map((r) => r.location),
    ).toEqual(['united states', 'united states']);
    expect(notBoard(remote).every((r) => r.location === 'north america')).toBe(
      true,
    );
    expect(
      on(remote, Channel.LINKEDIN_JOB_BOARD).map(
        (r) => `${r.location}|${r.params.experienceLevel}`,
      ),
    ).toEqual(['canada|4', 'canada|5', 'united states|4', 'united states|5']);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      linkedinKeyword(roles('devops_engineer'), [
        'aws',
        'kubernetes',
        'terraform',
      ]),
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
          "ASHBY | devops | hybrid | austin, united states | ("devops engineer" OR "devops") aws staff "austin, united states" | {"remote":false}",
          "ASHBY | devops | hybrid | austin, united states | ("devops engineer" OR "devops") kubernetes staff "austin, united states" | {"remote":false}",
          "ASHBY | devops | hybrid | austin, united states | ("devops engineer" OR "devops") terraform staff "austin, united states" | {"remote":false}",
          "ASHBY | devops | remote | north america | ("devops engineer" OR "devops") aws staff "remote" "north america" | {"remote":true}",
          "ASHBY | devops | remote | north america | ("devops engineer" OR "devops") kubernetes staff "remote" "north america" | {"remote":true}",
          "ASHBY | devops | remote | north america | ("devops engineer" OR "devops") terraform staff "remote" "north america" | {"remote":true}",
          "GREEN_HOUSE | devops | hybrid | austin, united states | ("devops engineer" OR "devops") aws staff "austin, united states" | {"remote":false}",
          "GREEN_HOUSE | devops | hybrid | austin, united states | ("devops engineer" OR "devops") kubernetes staff "austin, united states" | {"remote":false}",
          "GREEN_HOUSE | devops | hybrid | austin, united states | ("devops engineer" OR "devops") terraform staff "austin, united states" | {"remote":false}",
          "GREEN_HOUSE | devops | remote | north america | ("devops engineer" OR "devops") aws staff "remote" "north america" | {"remote":true}",
          "GREEN_HOUSE | devops | remote | north america | ("devops engineer" OR "devops") kubernetes staff "remote" "north america" | {"remote":true}",
          "GREEN_HOUSE | devops | remote | north america | ("devops engineer" OR "devops") terraform staff "remote" "north america" | {"remote":true}",
          "LINKEDIN_JOB_BOARD | devops | hybrid | united states | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"4","geoId":"103644278","location":"united states","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"3"}",
          "LINKEDIN_JOB_BOARD | devops | hybrid | united states | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"5","geoId":"103644278","location":"united states","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"3"}",
          "LINKEDIN_JOB_BOARD | devops | remote | canada | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"4","geoId":"101174742","location":"canada","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"2"}",
          "LINKEDIN_JOB_BOARD | devops | remote | canada | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"5","geoId":"101174742","location":"canada","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"2"}",
          "LINKEDIN_JOB_BOARD | devops | remote | united states | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"4","geoId":"103644278","location":"united states","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"2"}",
          "LINKEDIN_JOB_BOARD | devops | remote | united states | ("tech lead" OR "technical lead" OR architect OR developer OR devops OR engineer OR engineering OR programmer OR sre) AND (aws OR kubernetes OR terraform) | {"experienceLevel":"5","geoId":"103644278","location":"united states","roleWords":["architect","developer","devops","engineer","engineering","programmer","sre","tech lead","technical lead"],"spellings":["aws","kubernetes","terraform"],"workType":"2"}",
          "LINKEDIN_POSTS | devops | hybrid | austin, united states | hiring ("devops engineer" OR "devops") aws staff austin, united states | {}",
          "LINKEDIN_POSTS | devops | hybrid | austin, united states | hiring ("devops engineer" OR "devops") kubernetes staff austin, united states | {}",
          "LINKEDIN_POSTS | devops | hybrid | austin, united states | hiring ("devops engineer" OR "devops") terraform staff austin, united states | {}",
          "LINKEDIN_POSTS | devops | remote | north america | hiring ("devops engineer" OR "devops") aws staff remote north america | {}",
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
    ).toEqual([
      [
        linkedinKeyword(roles('data_engineer'), ['python']),
        {
          location: 'asia pacific',
          workType: '2',
          roleWords: roles('data_engineer'),
          spellings: ['python'],
        },
      ],
    ]);
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
      // Other channels: 18 per seniority. Board: 3 places x levels {4, 5} = 6
      // for senior + staff (4 is shared), and the same 6 for staff alone.
      expect(a).toHaveLength(2 * 18 + 6);
      expect(b).toHaveLength(18 + 6);
      expect(
        [...hashSet(notBoard(b))].every((hash) =>
          hashSet(notBoard(a)).has(hash),
        ),
      ).toBe(true);
      const counts = levels(a).reduce<Record<string, number>>(
        (acc, level) => ({
          ...acc,
          [String(level)]: (acc[String(level)] ?? 0) + 1,
        }),
        {},
      );
      expect(counts).toEqual({ '4': 3, '5': 3 });
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
      // senior keeps level 4 and staff level 5, over three search places each.
      expect(
        on(recipes, Channel.LINKEDIN_JOB_BOARD).filter(
          (r) => r.experience === staff,
        ),
      ).toHaveLength(3);
      expect(
        on(recipes, Channel.LINKEDIN_JOB_BOARD).filter(
          (r) => r.experience === senior,
        ),
      ).toHaveLength(3);
      // The other channels name each level, so every level keeps its search.
      expect(
        on(recipes, Channel.LINKEDIN_POSTS).filter(
          (r) => r.experience === lead,
        ),
      ).toHaveLength(6);
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
    // Other channels search the city; the board searches Morocco, levels 1 and 2.
    expect(
      notBoard(recipes).every((r) => r.location === 'casablanca, morocco'),
    ).toBe(true);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map(
        (r) => `${r.location}|${r.params.experienceLevel}`,
      ),
    ).toEqual(['morocco|1', 'morocco|2']);
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
        recipe.technologies[0] === 'typescript'
          ? SkillDomain.fullstack
          : SkillDomain.backend,
      );
    }
  });

  it('lead tech lead: the seniority word is not repeated', () => {
    const recipes = expand(MOCK_PROFILES.leadTechLead);
    // Other channels: 3. Board: united kingdom, levels 4 and 5 = 2.
    expect(recipes).toHaveLength(5);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      linkedinKeyword(roles('tech_lead'), ['typescript']),
    ]);
  });

  it('ties and duplicates: best rank wins, importance 0 dropped, locations deduped', () => {
    const recipes = expand(MOCK_PROFILES.tiesAndDuplicates);
    // Other channels: 3 x 2 technologies = 6. Board: one set, europe, level 4 = 1.
    expect(recipes).toHaveLength(7);
    expect(hashSet(recipes).size).toBe(7);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.technologies),
    ).toEqual([['go', 'rust']]);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.domain),
    ).toEqual([SkillDomain.backend]);
    expect(recipes.some((r) => r.technologies.includes('java'))).toBe(false);
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
    // 9 for the other channels plus the board's france, level 4.
    expect(hybrid.size).toBe(10);
    expect(onsite.size).toBe(10);
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
      const a = expand(backend).filter((r) => r.technologies[0] === 'nestjs');
      const b = expand(fullstack).filter((r) => r.technologies[0] === 'nestjs');
      expect(a.map((r) => r.keyword)).toEqual(b.map((r) => r.keyword));
      expect([...hashSet(a)].some((hash) => hashSet(b).has(hash))).toBe(false);
    });

    it('different locations: no builder is shared', () => {
      const paris = expand(MOCK_PROFILES.onsiteFrontendParis);
      const lyon = expand({
        ...MOCK_PROFILES.onsiteFrontendParis,
        locations: { ...empty, onsite: ['Lyon, France'] },
      });
      expect(
        [...hashSet(notBoard(paris))].some((hash) =>
          hashSet(notBoard(lyon)).has(hash),
        ),
      ).toBe(false);
      // The board searches the country, so Paris and Lyon share its builders.
      expect(hashSet(on(paris, Channel.LINKEDIN_JOB_BOARD))).toEqual(
        hashSet(on(lyon, Channel.LINKEDIN_JOB_BOARD)),
      );
    });
  });

  describe('LinkedIn job board keyword length', () => {
    const skill = (technology: string, importance: number) => ({
      technology,
      domain: SkillDomain.backend,
      importance,
      mastery: 5,
    });
    const profileWith = (
      technologies: string[],
      languages: string[],
    ): QuerySearchProfileInput => ({
      position: 'fullstack_engineer',
      seniorities: [Seniority.senior],
      languages,
      locations: { ...empty, remote: ['Europe'], onsite: ['Morocco'] },
      skills: technologies.map((t, i) => skill(t, 20 - i)),
    });
    const fits = (recipe: QuerySearchRecipe) => {
      const params = recipe.params as { roleWords: string[]; spellings: string[] };
      return linkedinKeywordFits(params.roleWords, params.spellings);
    };
    /** Board recipes per search place x work type x level. */
    const perSearch = (recipes: QuerySearchRecipe[]) => {
      const groups = new Map<string, QuerySearchRecipe[]>();
      for (const recipe of on(recipes, Channel.LINKEDIN_JOB_BOARD)) {
        const key = `${recipe.type}|${recipe.location}|${String(recipe.params.experienceLevel)}`;
        groups.set(key, [...(groups.get(key) ?? []), recipe]);
      }
      return groups;
    };

    it('the dev profile (8 technologies, en and fr) gives one search per place, type and level, with all 8', () => {
      const dev = [
        'typescript',
        'react',
        'react_native',
        'aws',
        'postgresql',
        'nodejs',
        'nextjs',
        'nestjs',
      ];
      const groups = perSearch(expand(profileWith(dev, ['en', 'fr'])));
      // Europe remote and Morocco onsite, senior = level 4 only.
      expect(groups.size).toBe(2);
      for (const recipes of groups.values()) {
        expect(recipes).toHaveLength(1);
        expect([...recipes[0].technologies].sort()).toEqual([...dev].sort());
        expect(fits(recipes[0])).toBe(true);
      }
    });

    it('12 technologies with en and es: several builders per search, each keyword within the limit', () => {
      const twelve = [
        'typescript',
        'javascript',
        'react_native',
        'kubernetes',
        'postgresql',
        'nodejs',
        'nextjs',
        'nestjs',
        'elasticsearch',
        'terraform',
        'graphql',
        'rabbitmq',
      ];
      const recipes = expand(profileWith(twelve, ['en', 'es']));
      const groups = perSearch(recipes);
      expect(groups.size).toBe(2);
      for (const members of groups.values()) {
        expect(members.length).toBeGreaterThan(1);
        for (const recipe of members) expect(fits(recipe)).toBe(true);
        // The sets are disjoint and together hold every technology.
        const all = members.flatMap((recipe) => recipe.technologies);
        expect(new Set(all).size).toBe(all.length);
        expect([...all].sort()).toEqual([...twelve].sort());
      }
      expect(hashSet(recipes).size).toBe(recipes.length);
    });
  });
});

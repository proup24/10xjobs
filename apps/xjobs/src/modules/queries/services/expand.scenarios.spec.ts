import { BadRequestException } from '@nestjs/common';
import {
  Arrangement,
  Channel,
  Region,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import { CITY_REQUIRED, SKILLS_REQUIRED } from '../steps';
import { FakeQuerySearchRepository } from '../testing/fakes';
import { MOCK_PROFILES, summarize } from '../testing/profiles.fixture';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { QuerySearchService } from './queries.service';

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

describe('expand scenarios over mock profiles', () => {
  it('remote backend in two regions: top 2 technologies alone, one search per region', () => {
    const recipes = expand(MOCK_PROFILES.remoteBackendMa);
    expect(recipes).toHaveLength(16);
    expect(hashSet(recipes).size).toBe(16);
    expect(recipes.every((r) => r.type === Arrangement.remote)).toBe(true);
    expect(recipes.every((r) => r.country === null && r.city === null)).toBe(
      true,
    );
    expect(recipes.every((r) => r.technologies.length === 1)).toBe(true);
    expect(
      recipes.some((r) => r.technologies.includes(Technology.postgresql)),
    ).toBe(false);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      '("backend engineer" OR "backend developer" OR "backend software engineer") AND nestjs',
      '("backend engineer" OR "backend developer" OR "backend software engineer") AND typescript',
    ]);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => r.params),
    ).toEqual([
      { location: 'EMEA', experienceLevel: '4', workType: '2' },
      { location: 'EMEA', experienceLevel: '4', workType: '2' },
      { location: 'European Union', experienceLevel: '4', workType: '2' },
      { location: 'European Union', experienceLevel: '4', workType: '2' },
    ]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") nestjs senior remote',
      'hiring ("backend engineer" OR "backend developer" OR "backend software engineer") typescript senior remote',
    ]);
  });

  it('onsite frontend in Paris: city-bound, no region, on every channel', () => {
    const recipes = expand(MOCK_PROFILES.onsiteFrontendParis);
    expect(recipes).toHaveLength(8);
    for (const recipe of recipes) {
      expect(recipe).toMatchObject({
        type: Arrangement.onsite,
        locationRegion: null,
        country: 'FR',
        city: 'Paris',
      });
    }
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => [r.keyword, r.params]),
    ).toEqual([
      [
        '("frontend engineer" OR "frontend developer" OR "front end engineer") AND react',
        { location: 'Paris, FR', experienceLevel: '3', workType: '1' },
      ],
      [
        '("frontend engineer" OR "frontend developer" OR "front end engineer") AND "next.js"',
        { location: 'Paris, FR', experienceLevel: '3', workType: '1' },
      ],
    ]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("frontend engineer" OR "frontend developer" OR "front end engineer") "next.js" paris',
      'hiring ("frontend engineer" OR "frontend developer" OR "front end engineer") react paris',
    ]);
    for (const channel of [Channel.GREEN_HOUSE, Channel.ASHBY]) {
      for (const recipe of on(recipes, channel)) {
        expect(recipe.params).toEqual({ remote: false, countryCode: 'fr' });
      }
    }
  });

  it('hybrid + remote devops: hybrid in Austin, remote in the region, ties broken by mastery then name', () => {
    const recipes = expand(MOCK_PROFILES.hybridAndRemoteDevops);
    expect(recipes).toHaveLength(16);
    const hybrid = ofType(recipes, Arrangement.hybrid);
    const remote = ofType(recipes, Arrangement.remote);
    expect(hybrid).toHaveLength(8);
    expect(remote).toHaveLength(8);
    expect(hybrid.every((r) => r.city === 'Austin' && r.country === 'US')).toBe(
      true,
    );
    expect(remote.every((r) => r.locationRegion === Region.NORTH_AMERICA)).toBe(
      true,
    );
    expect(recipes.some((r) => r.technologies.includes(Technology.aws))).toBe(
      false,
    );
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      '("devops engineer" OR "devops") AND kubernetes',
      '("devops engineer" OR "devops") AND terraform',
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
          "ASHBY | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") kubernetes staff "austin" | {"countryCode":"us","remote":false}",
          "ASHBY | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") terraform staff "austin" | {"countryCode":"us","remote":false}",
          "ASHBY | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") kubernetes staff "remote" | {"remote":true}",
          "ASHBY | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") terraform staff "remote" | {"remote":true}",
          "GREEN_HOUSE | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") kubernetes staff "austin" | {"countryCode":"us","remote":false}",
          "GREEN_HOUSE | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") terraform staff "austin" | {"countryCode":"us","remote":false}",
          "GREEN_HOUSE | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") kubernetes staff "remote" | {"remote":true}",
          "GREEN_HOUSE | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") terraform staff "remote" | {"remote":true}",
          "LINKEDIN_JOB_BOARD | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") AND kubernetes | {"experienceLevel":"4","location":"Austin, US","workType":"3"}",
          "LINKEDIN_JOB_BOARD | devops | hybrid | - | Austin, US | ("devops engineer" OR "devops") AND terraform | {"experienceLevel":"4","location":"Austin, US","workType":"3"}",
          "LINKEDIN_JOB_BOARD | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") AND kubernetes | {"experienceLevel":"4","location":"North America","workType":"2"}",
          "LINKEDIN_JOB_BOARD | devops | remote | NORTH_AMERICA | -, - | ("devops engineer" OR "devops") AND terraform | {"experienceLevel":"4","location":"North America","workType":"2"}",
          "LINKEDIN_POSTS | devops | hybrid | - | Austin, US | hiring ("devops engineer" OR "devops") kubernetes staff austin | {}",
          "LINKEDIN_POSTS | devops | hybrid | - | Austin, US | hiring ("devops engineer" OR "devops") terraform staff austin | {}",
          "LINKEDIN_POSTS | devops | remote | NORTH_AMERICA | -, - | hiring ("devops engineer" OR "devops") kubernetes staff remote | {}",
          "LINKEDIN_POSTS | devops | remote | NORTH_AMERICA | -, - | hiring ("devops engineer" OR "devops") terraform staff remote | {}",
        ]
      `);
  });

  it('unstated only: searched as remote, no seniority word or level', () => {
    const recipes = expand(MOCK_PROFILES.unstatedOnly);
    expect(recipes).toHaveLength(4);
    expect(
      recipes.every(
        (r) =>
          r.type === Arrangement.remote && r.locationRegion === Region.APAC,
      ),
    ).toBe(true);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).map((r) => [r.keyword, r.params]),
    ).toEqual([
      [
        '("data engineer" OR "data platform engineer") AND python',
        { location: 'Asia Pacific', workType: '2' },
      ],
    ]);
    expect(keywords(recipes, Channel.LINKEDIN_POSTS)).toEqual([
      'hiring ("data engineer" OR "data platform engineer") python remote',
    ]);
  });

  it('unstated next to onsite: adds remote searches, never an unstated one', () => {
    const recipes = expand(MOCK_PROFILES.unstatedWithOnsite);
    expect(recipes).toHaveLength(16);
    expect(ofType(recipes, Arrangement.unstated)).toHaveLength(0);
    expect(
      ofType(recipes, Arrangement.remote).every(
        (r) => r.locationRegion === Region.MENA,
      ),
    ).toBe(true);
    expect(
      ofType(recipes, Arrangement.onsite).every(
        (r) => r.city === 'Rabat' && r.country === 'MA',
      ),
    ).toBe(true);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      '("backend engineer" OR "backend developer" OR "backend software engineer") AND "node.js"',
      '("backend engineer" OR "backend developer" OR "backend software engineer") AND golang',
    ]);
  });

  it('no regions: remote searches GLOBAL', () => {
    const recipes = expand(MOCK_PROFILES.noRegionsRemote);
    expect(recipes).toHaveLength(8);
    expect(recipes.every((r) => r.locationRegion === Region.GLOBAL)).toBe(true);
    expect(
      on(recipes, Channel.LINKEDIN_JOB_BOARD).every(
        (r) => r.params.location === 'Worldwide',
      ),
    ).toBe(true);
    expect(keywords(recipes, Channel.LINKEDIN_JOB_BOARD)).toEqual([
      '("machine learning engineer" OR "ml engineer" OR "mlops engineer") AND python',
      '("machine learning engineer" OR "ml engineer" OR "mlops engineer") AND pytorch',
    ]);
  });

  it('no ranked skills: publish is rejected, nothing generated', () => {
    const run = () => expand(MOCK_PROFILES.noRankedSkills);
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
      '("tech lead" OR "technical lead" OR "engineering lead") AND typescript',
    ]);
  });

  it('ties and duplicates: best rank wins, importance 0 dropped, regions deduped', () => {
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
          country: 'MA',
          city: 'Casablanca',
        }),
      ),
    );
  });

  it('missing city: onsite is rejected, nothing generated', () => {
    const run = () => expand(MOCK_PROFILES.missingCity);
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(CITY_REQUIRED);
  });

  describe('sharing across profiles', () => {
    it('same city, different regions: identical onsite builders', () => {
      const paris = MOCK_PROFILES.onsiteFrontendParis;
      expect(hashSet(expand({ ...paris, regions: [Region.EUROPE] }))).toEqual(
        hashSet(expand({ ...paris, regions: [Region.EU, Region.UK] })),
      );
    });

    it('same remote setup, different city: identical remote builders', () => {
      const backend = MOCK_PROFILES.remoteBackendMa;
      expect(hashSet(expand({ ...backend, city: 'Tangier' }))).toEqual(
        hashSet(expand(backend)),
      );
    });

    it('same city typed differently: identical onsite builders', () => {
      const paris = MOCK_PROFILES.onsiteFrontendParis;
      expect(hashSet(expand({ ...paris, city: 'paris' }))).toEqual(
        hashSet(expand({ ...paris, city: ' PARIS ' })),
      );
      expect(hashSet(expand({ ...paris, city: 'paris' }))).toEqual(
        hashSet(expand(paris)),
      );
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

    it('different cities: no onsite builder is shared', () => {
      const paris = expand(MOCK_PROFILES.onsiteFrontendParis);
      const lyon = expand({
        ...MOCK_PROFILES.onsiteFrontendParis,
        city: 'Lyon',
      });
      expect([...hashSet(paris)].some((hash) => hashSet(lyon).has(hash))).toBe(
        false,
      );
    });
  });
});

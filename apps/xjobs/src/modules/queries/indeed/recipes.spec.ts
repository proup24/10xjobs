import { Arrangement, Channel, SkillDomain } from 'src/common/enums';
import type { QuerySearchProfileInput } from '../types';
import type { IndeedMarket } from './markets';
import { indeedPlaces, indeedRecipes } from './recipes';

const market = (
  site: string,
  mainRemote: boolean,
  remoteLocation = 'Remote',
): IndeedMarket => ({
  site,
  countryCode: site.toUpperCase(),
  mainRemote,
  remoteLocation,
});

const MARKETS: IndeedMarket[] = [
  market('us', true),
  market('br', true, 'Remoto'),
  market('pl', true),
  market('uk', true),
  market('ca', true),
  market('ma', false),
  market('fr', false),
];

const country = (countryCode: string, city: string | null = null) => ({
  countryCode,
  city,
});

const input = (
  overrides: Partial<QuerySearchProfileInput> & {
    remote?: string[];
    countries?: Partial<
      Record<'remote' | 'hybrid' | 'onsite', ReturnType<typeof country>[]>
    >;
  } = {},
): QuerySearchProfileInput => {
  const { remote = [], countries = {}, ...rest } = overrides;
  return {
    position: 'backend_engineer',
    seniorities: ['senior'],
    languages: ['en'],
    locations: { remote, hybrid: [], onsite: [] },
    skills: [
      {
        technology: 'nestjs',
        domain: SkillDomain.backend,
        importance: 9,
        mastery: 8,
      },
    ],
    placeCountries: {
      remote: [],
      hybrid: [],
      onsite: [],
      ...countries,
    },
    indeedMarkets: MARKETS,
    ...rest,
  };
};

const remoteMain = ['br', 'ca', 'pl', 'uk', 'us'];

describe('indeedPlaces', () => {
  it('searches every main market remote for a profile wanting remote', () => {
    const places = indeedPlaces(input({ remote: ['EMEA'] }));
    expect(places.map((p) => p.site)).toEqual(remoteMain);
    expect(places.every((p) => p.type === Arrangement.remote)).toBe(true);
    expect(places.find((p) => p.site === 'br')!.location).toBe('Remoto');
    expect(places.find((p) => p.site === 'us')!.location).toBe('Remote');
  });

  it("searches a named remote country's whole site", () => {
    const places = indeedPlaces(
      input({ remote: ['Morocco'], countries: { remote: [country('MA')] } }),
    );
    expect(places.map((p) => p.site)).toEqual([
      'br',
      'ca',
      'ma',
      'pl',
      'uk',
      'us',
    ]);
    expect(places.find((p) => p.site === 'ma')).toEqual({
      site: 'ma',
      location: '',
      type: Arrangement.unstated,
    });
  });

  it('adds nothing for a main market named only for remote', () => {
    const places = indeedPlaces(
      input({ remote: ['US'], countries: { remote: [country('US')] } }),
    );
    expect(places.map((p) => p.site)).toEqual(remoteMain);
  });

  it('one search per country whatever its arrangements', () => {
    const places = indeedPlaces(
      input({
        remote: ['Morocco'],
        countries: {
          remote: [country('MA')],
          onsite: [country('MA')],
          hybrid: [country('MA')],
        },
      }),
    );
    expect(places.filter((p) => p.site === 'ma')).toEqual([
      { site: 'ma', location: '', type: Arrangement.unstated },
    ]);
  });

  it("searches a city on its country's site", () => {
    expect(
      indeedPlaces(input({ countries: { onsite: [country('FR', 'Paris')] } })),
    ).toEqual([{ site: 'fr', location: 'Paris', type: Arrangement.unstated }]);
  });

  it('drops a city whose country has a whole-site search', () => {
    expect(
      indeedPlaces(
        input({
          countries: {
            onsite: [country('MA', 'Casablanca')],
            hybrid: [country('MA')],
          },
        }),
      ),
    ).toEqual([{ site: 'ma', location: '', type: Arrangement.unstated }]);
  });

  it('searches the whole site for a remote city in a non-main market', () => {
    const places = indeedPlaces(
      input({
        remote: ['Casablanca, Morocco'],
        countries: { remote: [country('MA', 'Casablanca')] },
      }),
    );
    expect(places.map((p) => p.site)).toEqual([
      'br',
      'ca',
      'ma',
      'pl',
      'uk',
      'us',
    ]);
    expect(places.find((p) => p.site === 'ma')).toEqual({
      site: 'ma',
      location: '',
      type: Arrangement.unstated,
    });
  });

  it('adds nothing for a remote city in a main market', () => {
    const places = indeedPlaces(
      input({
        remote: ['Austin, United States'],
        countries: { remote: [country('US', 'Austin')] },
      }),
    );
    expect(places.map((p) => p.site)).toEqual(remoteMain);
  });

  it('builds nothing for a profile with only region places', () => {
    const regionOnly = input({
      countries: { onsite: [] },
      locations: { remote: [], hybrid: [], onsite: ['Europe'] },
    });
    expect(indeedPlaces(regionOnly)).toEqual([]);
    expect(indeedRecipes(regionOnly)).toEqual([]);
  });

  it('builds nothing without market rows', () => {
    expect(
      indeedPlaces(input({ remote: ['EMEA'], indeedMarkets: undefined })),
    ).toEqual([]);
    expect(
      indeedRecipes(input({ remote: ['EMEA'], indeedMarkets: undefined })),
    ).toEqual([]);
  });

  it('ignores a country without a market row', () => {
    expect(
      indeedPlaces(input({ countries: { onsite: [country('DE', 'Berlin')] } })),
    ).toEqual([]);
  });
});

describe('indeedRecipes', () => {
  it('builds one INDEED recipe per place', () => {
    const recipes = indeedRecipes(
      input({ remote: ['Morocco'], countries: { remote: [country('MA')] } }),
    );
    expect(recipes).toHaveLength(6);
    const ma = recipes.find((r) => r.params.site === 'ma')!;
    expect(ma).toMatchObject({
      channel: Channel.INDEED,
      position: 'backend_engineer',
      location: 'ma:*',
      experience: 'unstated',
      type: Arrangement.unstated,
      technologies: ['nestjs'],
      domain: SkillDomain.backend,
      languages: ['en'],
      params: { site: 'ma', location: '' },
    });
    expect(ma.params.roleWords).toContain('developer');
    expect(ma.hash).toMatch(/^[0-9a-f]{64}$/);
    const us = recipes.find((r) => r.params.site === 'us')!;
    expect(us.location).toBe('us:remote');
    expect(us.type).toBe(Arrangement.remote);
  });

  it('lowercases a city location', () => {
    const [recipe] = indeedRecipes(
      input({ countries: { onsite: [country('FR', 'Paris')] } }),
    );
    expect(recipe.location).toBe('fr:paris');
    expect(recipe.params.location).toBe('Paris');
  });

  it('two profiles with the same words share recipe hashes', () => {
    const a = indeedRecipes(
      input({ remote: ['EMEA'], seniorities: ['senior'] }),
    );
    const b = indeedRecipes(
      input({ remote: ['Europe'], seniorities: ['junior'] }),
    );
    expect(a.map((r) => r.hash)).toEqual(b.map((r) => r.hash));
  });

  it('the hash changes with the location', () => {
    const [paris] = indeedRecipes(
      input({ countries: { onsite: [country('FR', 'Paris')] } }),
    );
    const [lyon] = indeedRecipes(
      input({ countries: { onsite: [country('FR', 'Lyon')] } }),
    );
    expect(paris.hash).not.toBe(lyon.hash);
  });

  it('recipes carry no seniority', () => {
    for (const recipe of indeedRecipes(input({ remote: ['EMEA'] }))) {
      expect(recipe.keyword).not.toContain('senior');
      expect(recipe.experience).toBe('unstated');
    }
  });

  it('builds nothing without skills', () => {
    expect(indeedRecipes(input({ remote: ['EMEA'], skills: [] }))).toEqual([]);
  });
});

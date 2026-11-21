import type { QuerySearchProfileInput } from 'src/modules/queries';
import type { PlaceLabels } from './place-labels';
import { regeneratePublished } from './profiles.service';

const noLabels = async (): Promise<PlaceLabels> => ({
  regions: new Map(),
  countries: new Map(),
  cities: new Map(),
});

describe('regeneratePublished', () => {
  it('regenerates every published profile, then retires outdated builders', async () => {
    const calls: string[] = [];
    const locations = { remote: [], hybrid: [], onsite: [] };
    const published = [
      { id: 'p1', locations },
      { id: 'p2', locations },
    ] as never[];
    const result = await regeneratePublished(
      {
        postsAllowed: () => false,
        profiles: {
          listPublished: async () => published,
          placeLabels: noLabels,
        },
        querySearch: {
          recipesFor: () => [{}] as never,
          replace: async (id: string) => {
            calls.push(`replace:${id}`);
            return { created: 0, existing: 0, released: 0 };
          },
          retireOutdated: async () => {
            calls.push('retire');
            return 3;
          },
        },
      },
      () => ({}) as never,
    );

    expect(calls).toEqual(['replace:p1', 'replace:p2', 'retire']);
    expect(result).toEqual({
      profiles: 2,
      retired: 3,
      postsKept: 0,
      postsDropped: 0,
    });
  });

  it('looks up place labels, so a city place searches as "<name>, <country label>"', async () => {
    const onsite = [{ kind: 'city', id: 'c1' }];
    const published = [
      {
        id: 'p1',
        position: 'backend_engineer',
        seniorities: ['senior'],
        languages: [{ lang: 'en', level: 'fluent' }],
        locations: { remote: [], hybrid: [], onsite },
        techStack: [
          {
            technology: 'go',
            domain: 'backend',
            importance: 8,
            mastery: 7,
          },
        ],
      },
    ] as never[];
    const asked: unknown[] = [];
    const inputs: QuerySearchProfileInput[] = [];
    await regeneratePublished({
      postsAllowed: () => false,
      profiles: {
        listPublished: async () => published,
        placeLabels: async (places) => {
          asked.push(places);
          return {
            regions: new Map(),
            countries: new Map([['FR', 'France']]),
            cities: new Map([['c1', { name: 'Paris', countryCode: 'FR' }]]),
          };
        },
      },
      querySearch: {
        recipesFor: (input) => {
          inputs.push(input);
          return [{}] as never;
        },
        replace: async () => ({ created: 1, existing: 0, released: 0 }),
        retireOutdated: async () => 0,
      },
    });

    expect(asked).toEqual([onsite]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].locations).toEqual({
      remote: [],
      hybrid: [],
      onsite: ['Paris, France'],
    });
  });

  it('regenerate sets searchesVersion', async () => {
    const locations = { remote: [], hybrid: [], onsite: [] };
    const published = [{ id: 'p1', locations, matchVersion: 7 }] as never[];
    const versions: number[] = [];
    await regeneratePublished(
      {
        postsAllowed: () => false,
        profiles: {
          listPublished: async () => published,
          placeLabels: noLabels,
        },
        querySearch: {
          recipesFor: () => [{}] as never,
          replace: async (_id, _recipes, version) => {
            versions.push(version);
            return { created: 0, existing: 0, released: 0 };
          },
          retireOutdated: async () => 0,
        },
      },
      () => ({}) as never,
    );
    expect(versions).toEqual([7]);
  });
});

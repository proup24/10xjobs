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
          detach: async (id: string) => {
            calls.push(`detach:${id}`);
            return 1;
          },
          generate: async (id: string) => {
            calls.push(`generate:${id}`);
            return {} as never;
          },
          retireOutdated: async () => {
            calls.push('retire');
            return 3;
          },
        },
      },
      () => ({}) as never,
    );

    expect(calls).toEqual([
      'detach:p1',
      'generate:p1',
      'detach:p2',
      'generate:p2',
      'retire',
    ]);
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
        detach: async () => 0,
        generate: async (_id, input) => {
          inputs.push(input);
          return { created: 1, existing: 0 };
        },
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
});

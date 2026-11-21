import { Logger } from '@nestjs/common';
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
            return { created: 0, existing: 0, released: 0, skipped: null };
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
      failed: 0,
      skipped: 0,
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
        replace: async () => ({
          created: 1,
          existing: 0,
          released: 0,
          skipped: null,
        }),
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
          replace: async (_id, _recipes, { searchesVersion }) => {
            versions.push(searchesVersion);
            return { created: 0, existing: 0, released: 0, skipped: null };
          },
          retireOutdated: async () => 0,
        },
      },
      () => ({}) as never,
    );
    expect(versions).toEqual([7]);
  });

  it('keeps going past a profile that throws, and still retires', async () => {
    const calls: string[] = [];
    const locations = { remote: [], hybrid: [], onsite: [] };
    const published = [
      { id: 'p1', locations },
      { id: 'p2', locations },
      { id: 'p3', locations },
    ] as never[];
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
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
            if (id === 'p2')
              throw Object.assign(new Error('secret'), { code: '40001' });
            return {
              created: 0,
              existing: 0,
              released: 0,
              skipped: id === 'p3' ? ('post_search_changed' as const) : null,
            };
          },
          retireOutdated: async () => {
            calls.push('retire');
            return 1;
          },
        },
      },
      () => ({}) as never,
    );

    expect(calls).toEqual(['replace:p1', 'replace:p2', 'replace:p3', 'retire']);
    expect(result).toMatchObject({
      profiles: 3,
      failed: 1,
      skipped: 1,
      retired: 1,
    });
    expect(error).toHaveBeenCalledWith('Regenerate failed profile=p2: 40001');
    error.mockRestore();
  });
});

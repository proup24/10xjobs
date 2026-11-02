import { regeneratePublished } from './profiles.service';

describe('regeneratePublished', () => {
  it('regenerates every published profile, then retires outdated builders', async () => {
    const calls: string[] = [];
    const published = [{ id: 'p1' }, { id: 'p2' }] as never[];
    const result = await regeneratePublished(
      {
        profiles: { listPublished: async () => published },
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
    expect(result).toEqual({ profiles: 2, retired: 3 });
  });
});

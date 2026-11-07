import { MemoryVocabRepository } from './fakes';

describe('MemoryVocabRepository snapshot', () => {
  it('holds the 17 seeded engineering role kinds', async () => {
    const { engineeringRoleKinds } =
      await new MemoryVocabRepository().snapshot();
    expect(engineeringRoleKinds.size).toBe(17);
    expect(engineeringRoleKinds.has('backend_engineer')).toBe(true);
    expect(engineeringRoleKinds.has('support')).toBe(false);
  });
});

describe('MemoryVocabRepository approve and reject', () => {
  it('report whether anything changed', async () => {
    const vocab = new MemoryVocabRepository();
    await vocab.propose([{ list: 'techTags', text: 'Bun' }]);
    expect(await vocab.approve('techTags', 'bun')).toBe(true);
    expect(await vocab.approve('techTags', 'bun')).toBe(false);
    expect(await vocab.approve('techTags', 'nope')).toBe(false);
    expect(await vocab.reject('techTags', 'react')).toBe(false);
    await vocab.propose([{ list: 'techTags', text: 'Deno' }]);
    expect(await vocab.reject('techTags', 'deno')).toBe(true);
    expect(await vocab.reject('techTags', 'deno')).toBe(false);
  });

  it('city approve and reject report changes; a city in use is not rejected', async () => {
    const vocab = new MemoryVocabRepository();
    const ids = await vocab.upsertCities([
      { name: 'Berlin', countryCode: 'DE' },
      { name: 'Paris', countryCode: 'FR' },
    ]);
    const berlin = ids.get('Berlin|DE')!;
    const paris = ids.get('Paris|FR')!;
    vocab.citiesInUse.add(paris);
    expect(await vocab.rejectCity(paris)).toBe(false);
    expect(await vocab.approveCity(berlin)).toBe(true);
    expect(await vocab.approveCity(berlin)).toBe(false);
    expect(await vocab.rejectCity(berlin)).toBe(false);
    expect(await vocab.rejectCity('missing')).toBe(false);
    vocab.citiesInUse.clear();
    expect(await vocab.rejectCity(paris)).toBe(true);
  });
});

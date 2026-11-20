import type { ListingRow } from 'src/modules/facts/rules/listing';
import type { JobFactsDocument } from 'src/modules/facts/schema/facts';
import { MemoryFactsRepository } from 'src/modules/facts/testing/memory-facts.repository';
import { MemoryVocabRepository } from 'src/modules/processor/testing/fakes';
import { changeCity } from './vocab-cities';

const listing = (countryCode: string | null): ListingRow => ({
  workplaceType: null,
  countryCode,
  regionCode: null,
  city: null,
  geoId: null,
  location: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryProvidedByEmployer: null,
  experienceLevel: null,
  contractType: null,
  expiresAt: null,
});

/** A facts row for `jobId`, listed in `country`, whose openings name `places`. */
async function stored(
  facts: MemoryFactsRepository,
  jobId: string,
  country: string | null,
  places: Record<string, unknown>[] = [],
): Promise<void> {
  facts.inputs.set(jobId, {
    extractionId: `e-${jobId}`,
    extraction: {},
    schemaVersion: 3,
    extractedAt: new Date(0),
    jobUpdatedAt: new Date(0),
    descriptionText: null,
    listing: listing(country),
  });
  await facts.save({
    jobId,
    extractionId: `e-${jobId}`,
    builtAt: new Date(0),
    factsVersion: 1,
    factsHash: 'h',
    facts: { openings: [{ places }] } as unknown as JobFactsDocument,
    closed: false,
    conflicts: [],
  });
}

async function setup() {
  const vocab = new MemoryVocabRepository();
  const facts = new MemoryFactsRepository();
  const ids = await vocab.upsertCities([
    { name: 'Lyon', countryCode: 'FR' },
    { name: 'Fes', countryCode: 'MA' },
  ]);
  await stored(facts, 'fr-listing', 'FR');
  await stored(facts, 'fr-description', 'DE', [
    { kind: 'city', name: 'Lyon', countryCode: 'FR', cityId: null },
  ]);
  await stored(facts, 'de', 'DE', [{ kind: 'country', code: 'DE' }]);
  const deps = {
    vocab,
    facts,
    cityCountry: (id: string) =>
      Promise.resolve(
        vocab.cities.find((c) => c.id === id)?.countryCode ?? null,
      ),
  };
  const stale = () =>
    [...facts.rows]
      .filter(([, r]) => r.builtAt === Number.NEGATIVE_INFINITY)
      .map(([id]) => id)
      .sort();
  const id = (key: string) => {
    const found = ids.get(key);
    if (!found) throw new Error(`no city ${key}`);
    return found;
  };
  return { deps, vocab, stale, lyon: id('Lyon|FR'), fes: id('Fes|MA') };
}

describe('changeCity', () => {
  it('approving a city marks facts stale in its country', async () => {
    const { deps, stale, lyon } = await setup();
    expect(await changeCity({ action: 'approve', code: lyon }, deps)).toEqual({
      changed: true,
      staleFacts: 2,
    });
    expect(stale()).toEqual(['fr-description', 'fr-listing']);
  });

  it('rejecting a city marks facts stale in its country', async () => {
    const { deps, stale, lyon } = await setup();
    expect(await changeCity({ action: 'reject', code: lyon }, deps)).toEqual({
      changed: true,
      staleFacts: 2,
    });
    expect(stale()).toEqual(['fr-description', 'fr-listing']);
  });

  it('aliasing a city marks facts stale in its country', async () => {
    const { deps, vocab, stale, lyon } = await setup();
    await vocab.approveCity(lyon);
    expect(
      await changeCity({ action: 'alias', code: lyon, spelling: 'Lion' }, deps),
    ).toEqual({ changed: true, staleFacts: 2 });
    expect(stale()).toEqual(['fr-description', 'fr-listing']);
  });

  it('a refused change marks nothing', async () => {
    const { deps, stale, fes } = await setup();
    // Not approved yet: an alias is refused.
    expect(
      await changeCity({ action: 'alias', code: fes, spelling: 'Fez' }, deps),
    ).toEqual({ changed: false, staleFacts: 0 });
    expect(
      await changeCity({ action: 'approve', code: 'missing' }, deps),
    ).toEqual({ changed: false, staleFacts: 0 });
    expect(stale()).toEqual([]);
  });
});

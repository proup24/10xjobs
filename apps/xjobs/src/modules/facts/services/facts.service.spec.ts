import { Logger } from '@nestjs/common';
import { fixtureDocument } from '../../processor/schema/fixture.testing';
import { FACTS_VERSION } from '../config/facts.config';
import { PlaceVocabularyRepository } from '../places/place-vocabulary.repository';
import type { PlaceVocabulary } from '../places/resolver';
import type { ListingRow } from '../rules/listing';
import { MemoryFactsRepository } from '../testing/memory-facts.repository';
import { FactsService } from './facts.service';

const vocab: PlaceVocabulary = {
  regions: new Set(['EMEA']),
  countries: new Set(['FR']),
  cities: new Map(),
  cityNames: new Map(),
  regionCountries: new Map([['EMEA', new Set(['FR'])]]),
};

class StubVocabulary extends PlaceVocabularyRepository {
  loads = 0;
  load(): Promise<PlaceVocabulary> {
    this.loads += 1;
    return Promise.resolve(vocab);
  }
}

const listing = (p: Partial<ListingRow> = {}): ListingRow => ({
  workplaceType: null,
  countryCode: null,
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
  ...p,
});

const JOB = '00000000-0000-4000-8000-000000000001';
const UPDATED_AT = new Date('2026-11-12T11:00:00Z');

function setup(
  over: {
    schemaVersion?: number;
    listing?: ListingRow;
    extraction?: unknown;
  } = {},
) {
  const repo = new MemoryFactsRepository();
  const vocabulary = new StubVocabulary();
  let now = new Date('2026-11-12T12:00:00Z');
  const service = new FactsService(repo, vocabulary, () => now);
  repo.inputs.set(JOB, {
    extractionId: 'e1',
    extraction: over.extraction ?? fixtureDocument(),
    schemaVersion: over.schemaVersion ?? 3,
    jobUpdatedAt: UPDATED_AT,
    descriptionText: null,
    listing: over.listing ?? listing({ workplaceType: 'onsite' }),
  });
  return {
    repo,
    vocabulary,
    service,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

describe('FactsService', () => {
  it('builds from a v3 extraction and saves conflicts', async () => {
    const { service, repo } = setup();
    const result = await service.build(JOB);
    expect(result).toMatchObject({
      status: 'built',
      changed: true,
      extractionId: 'e1',
    });
    const row = repo.rows.get(JOB);
    expect(row?.factsVersion).toBe(FACTS_VERSION);
    expect(row?.factsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.conflictsByJob.get(JOB)?.map((c) => c.field)).toEqual([
      'arrangement',
    ]);
  });

  it('skips a job whose extraction is v2', async () => {
    const { service, repo } = setup({ schemaVersion: 2 });
    expect(await service.build(JOB)).toEqual({
      status: 'skipped',
      reason: 'old_schema',
    });
    expect(repo.saves).toBe(0);
  });

  it('skips a v3 row whose document is invalid, and says which job', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { service, repo } = setup({ extraction: { version: 3, junk: true } });
    expect(await service.build(JOB)).toEqual({
      status: 'skipped',
      reason: 'invalid_document',
    });
    expect(repo.saves).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(JOB));
    warn.mockRestore();
  });

  it('skips a job without a current extraction', async () => {
    const { service } = setup();
    expect(await service.build('missing')).toEqual({
      status: 'skipped',
      reason: 'no_extraction',
    });
  });

  it('changed is false when the facts hash is unchanged', async () => {
    const { service } = setup();
    await service.build(JOB);
    const second = await service.build(JOB);
    expect(second).toMatchObject({ status: 'built', changed: false });
  });

  it("builtAt is the job's updatedAt at load, also on an unchanged rebuild", async () => {
    const { service, repo } = setup();
    await service.build(JOB);
    expect(repo.rows.get(JOB)!.builtAt).toBe(UPDATED_AT.getTime());
    const later = new Date('2026-11-12T11:30:00Z');
    repo.inputs.set(JOB, { ...repo.inputs.get(JOB)!, jobUpdatedAt: later });
    await service.build(JOB);
    expect(repo.saves).toBe(2);
    expect(repo.rows.get(JOB)!.builtAt).toBe(later.getTime());
  });

  it("rebuild replaces the job's conflicts", async () => {
    const { service, repo } = setup();
    await service.build(JOB);
    expect(repo.conflictsByJob.get(JOB)).toHaveLength(1);
    repo.inputs.set(JOB, {
      ...repo.inputs.get(JOB)!,
      listing: listing({ workplaceType: 'remote' }),
    });
    await service.build(JOB);
    expect(repo.conflictsByJob.get(JOB)).toEqual([]);
  });

  it('caches the vocabulary for 10 minutes', async () => {
    const { service, vocabulary, advance } = setup();
    await service.build(JOB);
    advance(9 * 60_000);
    await service.build(JOB);
    expect(vocabulary.loads).toBe(1);
    advance(2 * 60_000);
    await service.build(JOB);
    expect(vocabulary.loads).toBe(2);
  });
});

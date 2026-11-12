import { describe, expect, it } from 'vitest';
import { PlaceVocabularyRepository } from 'src/modules/facts/places/place-vocabulary.repository';
import type { PlaceVocabulary } from 'src/modules/facts/places/resolver';
import type { ListingRow } from 'src/modules/facts/rules/listing';
import { FactsService } from 'src/modules/facts/services/facts.service';
import { MemoryFactsRepository } from 'src/modules/facts/testing/memory-facts.repository';
import { fixtureDocument } from 'src/modules/processor/schema/fixture.testing';
import { MATCHER_VERSION } from '../config/matcher.config';
import { exampleProfile } from '../rules/fixtures.testing';
import { MemoryMatcherRepository } from '../testing/memory-matcher.repository';
import { MatcherService } from './matcher.service';

const vocab: PlaceVocabulary = {
  regions: new Set(),
  countries: new Set(),
  cities: new Map(),
  cityNames: new Map(),
  regionCountries: new Map(),
};

class StubVocabulary extends PlaceVocabularyRepository {
  load(): Promise<PlaceVocabulary> {
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

const NOW = new Date('2026-11-12T12:00:00Z');

function setup(
  over: {
    schemaVersion?: number;
    listing?: ListingRow;
    extraction?: unknown;
  } = {},
) {
  const repo = new MemoryMatcherRepository();
  const factsRepo = new MemoryFactsRepository();
  repo.candidates.set('job-1', { extractionId: 'ext-1', needsReview: false });
  factsRepo.inputs.set('job-1', {
    extractionId: 'ext-1',
    extraction: over.extraction ?? fixtureDocument(),
    schemaVersion: over.schemaVersion ?? 3,
    jobUpdatedAt: NOW,
    listing: over.listing ?? listing(),
  });
  repo.profiles = [
    exampleProfile(),
    { ...exampleProfile(), id: 'profile-2', userId: 'user-2' },
  ];
  const facts = new FactsService(factsRepo, new StubVocabulary(), () => NOW);
  let now = 1_000_000;
  const service = new MatcherService(repo, facts, () => now);
  const input = factsRepo.inputs.get('job-1');
  if (!input) throw new Error('no inputs');
  return {
    repo,
    factsRepo,
    input,
    service,
    advance: (ms: number) => (now += ms),
  };
}

describe('MatcherService', () => {
  it('reports not_matchable for an invalid v3 document, writing nothing', async () => {
    const { repo, factsRepo, service } = setup({
      extraction: { version: 3, junk: true },
    });
    expect(await service.matchJob('job-1')).toEqual({
      status: 'not_matchable',
    });
    expect(factsRepo.saves).toBe(0);
    expect(repo.rows).toEqual([]);
  });

  it('reports not_matchable without upserting', async () => {
    const { repo, service } = setup();
    expect(await service.matchJob('missing')).toEqual({
      status: 'not_matchable',
    });
    expect(repo.upserts).toHaveLength(0);
  });

  it('builds facts before deciding', async () => {
    const { repo, factsRepo, service } = setup();
    await service.matchJob('job-1');
    const built = factsRepo.rows.get('job-1');
    expect(built?.extractionId).toBe('ext-1');
    const rows = await repo.matchesForJob('job-1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.factsHash === built?.factsHash)).toBe(true);
  });

  it('skips a job whose extraction is v2', async () => {
    const { repo, factsRepo, service } = setup({ schemaVersion: 2 });
    expect(await service.matchJob('job-1')).toEqual({
      status: 'not_matchable',
    });
    expect(factsRepo.rows.has('job-1')).toBe(false);
    expect(repo.upserts).toHaveLength(0);
  });

  it('keeps rows of an expired job', async () => {
    const { repo, factsRepo, input, service } = setup();
    await service.matchJob('job-1');
    const before = await repo.matchesForJob('job-1');
    repo.upserts.length = 0;
    input.listing.expiresAt = new Date(NOW.getTime() - 1);
    expect(await service.matchJob('job-1', { force: true })).toEqual({
      status: 'closed',
    });
    expect(factsRepo.rows.get('job-1')?.closed).toBe(true);
    expect(repo.upserts).toEqual([]);
    expect(await repo.matchesForJob('job-1')).toEqual(before);
  });

  it('decides every stale profile and stores extractionId, factsHash and version', async () => {
    const { repo, service } = setup();
    const out = await service.matchJob('job-1');
    expect(out.status).toBe('matched');
    const rows = await repo.matchesForJob('job-1');
    expect(rows.map((r) => r.profileId).sort()).toEqual([
      'profile-1',
      'profile-2',
    ]);
    expect(rows.every((r) => r.extractionId === 'ext-1')).toBe(true);
    expect(repo.rows.every((r) => r.matcherVersion === MATCHER_VERSION)).toBe(
      true,
    );
  });

  it('skips current profiles unless forced', async () => {
    const { repo, service } = setup();
    await service.matchJob('job-1');
    const again = await service.matchJob('job-1');
    expect(again).toEqual({ status: 'matched', profiles: 0, qualified: 0 });
    const forced = await service.matchJob('job-1', { force: true });
    expect(forced).toMatchObject({ status: 'matched', profiles: 2 });
    expect(repo.upserts).toHaveLength(2);
  });

  it('decides again when the facts change', async () => {
    const { input, service } = setup();
    await service.matchJob('job-1');
    const doc = fixtureDocument();
    doc.seniority.value = 'junior';
    input.extraction = doc;
    expect(await service.matchJob('job-1')).toMatchObject({
      status: 'matched',
      profiles: 2,
    });
  });

  it('marks every row unverified when the extraction needs review', async () => {
    const { repo, service } = setup();
    repo.candidates.set('job-1', { extractionId: 'ext-1', needsReview: true });
    await service.matchJob('job-1');
    const rows = await repo.matchesForJob('job-1');
    expect(rows.every((r) => r.outcome === 'rejected' || r.unverified)).toBe(
      true,
    );
  });

  it('counts qualified rows', async () => {
    const { repo, service } = setup();
    const out = await service.matchJob('job-1');
    const stored = await repo.matchesForJob('job-1');
    expect(out).toEqual({
      status: 'matched',
      profiles: 2,
      qualified: stored.filter((r) => r.outcome === 'qualified').length,
    });
  });

  it('caches the context for ten minutes', async () => {
    const { repo, service, advance } = setup();
    await service.matchJob('job-1', { force: true });
    advance(9 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(1);
    advance(2 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(2);
  });
});

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
  countryNames: new Map(),
  cityCountries: new Map(),
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
/** The matcher clock's start. */
const START = 1_000_000;
const DAY = 86_400_000;

function setup(
  over: {
    schemaVersion?: number;
    listing?: ListingRow;
    extraction?: unknown;
  } = {},
) {
  const repo = new MemoryMatcherRepository();
  const factsRepo = new MemoryFactsRepository();
  repo.candidates.set('job-1', {
    extractionId: 'ext-1',
    needsReview: false,
    kind: 'job',
    post: null,
  });
  factsRepo.inputs.set('job-1', {
    extractionId: 'ext-1',
    extraction: over.extraction ?? fixtureDocument(),
    schemaVersion: over.schemaVersion ?? 3,
    extractedAt: NOW,
    jobUpdatedAt: NOW,
    descriptionText: null,
    listing: over.listing ?? listing(),
  });
  repo.profiles = [
    exampleProfile(),
    { ...exampleProfile(), id: 'profile-2', userId: 'user-2' },
  ];
  // A role job of a post, decided like a listing plus the post checks.
  repo.candidates.set('role-1', {
    extractionId: 'ext-r',
    needsReview: false,
    kind: 'post_role',
    post: {
      verdictConfidence: 'sure',
      authors: [{ key: 'profile:jane-doe', name: 'Jane Doe' }],
      postedAt: new Date(START - 2 * DAY),
    },
  });
  factsRepo.inputs.set('role-1', {
    extractionId: 'ext-r',
    extraction: fixtureDocument(),
    schemaVersion: 3,
    extractedAt: NOW,
    jobUpdatedAt: NOW,
    descriptionText: null,
    listing: listing(),
  });
  const facts = new FactsService(factsRepo, new StubVocabulary(), () => NOW);
  let now = START;
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
    expect(again).toEqual({
      status: 'matched',
      profiles: 0,
      qualified: 0,
      deliveryIds: [],
    });
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

  it("records the profile's matchVersion and the user's eligibility version it read", async () => {
    const { repo, service } = setup();
    repo.profiles[0] = {
      ...exampleProfile(),
      matchVersion: 7,
      eligibilityVersion: 4,
    };
    await service.matchJob('job-1');
    const [row] = (await repo.matchesForJob('job-1')).filter(
      (r) => r.profileId === 'profile-1',
    );
    expect(row).toMatchObject({ profileVersion: 7, eligibilityVersion: 4 });
  });

  it('decides again only the profile that was edited', async () => {
    const { repo, service } = setup();
    await service.matchJob('job-1');
    const edited = exampleProfile();
    edited.matchVersion += 1;
    repo.profiles[0] = edited;
    expect(await service.matchJob('job-1')).toMatchObject({ profiles: 1 });
    expect(await service.matchJob('job-1')).toMatchObject({ profiles: 0 });
  });

  it('decides again the profiles of a user whose eligibility changed', async () => {
    const { repo, service } = setup();
    await service.matchJob('job-1');
    repo.profiles[1] = {
      ...exampleProfile(),
      id: 'profile-2',
      userId: 'user-2',
      eligibilityVersion: 1,
    };
    expect(await service.matchJob('job-1')).toMatchObject({ profiles: 1 });
    expect(await service.matchJob('job-1')).toMatchObject({ profiles: 0 });
  });

  it('marks every row unverified when the extraction needs review', async () => {
    const { repo, service } = setup();
    repo.candidates.set('job-1', {
      extractionId: 'ext-1',
      needsReview: true,
      kind: 'job',
      post: null,
    });
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
      deliveryIds: [],
    });
  });

  it('returns the delivery ids the repository reports', async () => {
    const { repo, service } = setup();
    repo.deliveryIds = ['d1'];
    expect(await service.matchJob('job-1')).toMatchObject({
      deliveryIds: ['d1'],
    });
  });

  it('caches the context for ten minutes', async () => {
    const { repo, service, advance } = setup();
    repo.context.rates = new Map([['USD', 1]]);
    await service.matchJob('job-1', { force: true });
    advance(9 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(1);
    advance(2 * 60_000);
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(2);
  });

  it('does not cache a context without rates, so the next job loads them fresh', async () => {
    const { repo, service } = setup();
    await service.matchJob('job-1', { force: true });
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(2);
    repo.context.rates = new Map([['USD', 1]]);
    await service.matchJob('job-1', { force: true });
    await service.matchJob('job-1', { force: true });
    expect(repo.contextLoads).toBe(3);
  });

  describe('post role jobs', () => {
    it('a role job is decided only for postSearch profiles', async () => {
      const { repo, service } = setup();
      repo.profiles[1] = { ...repo.profiles[1], postSearch: true };
      expect(await service.matchJob('role-1')).toMatchObject({
        status: 'matched',
        profiles: 1,
      });
      expect(
        (await repo.matchesForJob('role-1')).map((r) => r.profileId),
      ).toEqual(['profile-2']);
      // Forced too: post search gates role jobs however they are decided.
      expect(await service.matchJob('role-1', { force: true })).toMatchObject({
        profiles: 1,
      });
      // Listings still go to every profile.
      expect(await service.matchJob('job-1')).toMatchObject({ profiles: 2 });
    });

    it('a role carries thirteen checks; a listing ten', async () => {
      const { repo, service } = setup();
      repo.profiles = repo.profiles.map((p) => ({ ...p, postSearch: true }));
      await service.matchJob('role-1');
      await service.matchJob('job-1');
      const [role] = await repo.matchesForJob('role-1');
      const [listingRow] = await repo.matchesForJob('job-1');
      expect(role.checks).toHaveLength(13);
      expect(role.checks.slice(10).map((c) => c.rule)).toEqual([
        'hiringVerdict',
        'blockedAuthor',
        'postAge',
      ]);
      expect(listingRow.checks).toHaveLength(10);
    });

    it('ageDays is computed from the matcher clock', async () => {
      const { repo, service, advance } = setup();
      repo.profiles = [{ ...exampleProfile(), postSearch: true }];
      const ageOf = async () =>
        (await repo.matchesForJob('role-1'))[0].checks.find(
          (c) => c.rule === 'postAge',
        );
      await service.matchJob('role-1');
      expect(await ageOf()).toMatchObject({ outcome: 'pass', jobValue: 2 });
      // postedAt + 31 days.
      advance(29 * DAY);
      await service.matchJob('role-1', { force: true });
      expect(await ageOf()).toMatchObject({ outcome: 'fail', jobValue: 31 });
      const [row] = await repo.matchesForJob('role-1');
      expect(row.outcome).toBe('rejected');
    });

    it('a role with no date has an unknown postAge', async () => {
      const { repo, service } = setup();
      repo.profiles = [{ ...exampleProfile(), postSearch: true }];
      const candidate = repo.candidates.get('role-1');
      if (!candidate?.post) throw new Error('no role');
      candidate.post.postedAt = null;
      await service.matchJob('role-1');
      const [row] = await repo.matchesForJob('role-1');
      expect(row.checks.find((c) => c.rule === 'postAge')).toMatchObject({
        outcome: 'unknown',
        jobValue: null,
      });
    });

    it("a blocked author rejects the role for that profile's user", async () => {
      const { repo, service } = setup();
      repo.profiles = [
        {
          ...exampleProfile(),
          postSearch: true,
          blockedAuthors: ['profile:jane-doe'],
        },
      ];
      await service.matchJob('role-1');
      const [row] = await repo.matchesForJob('role-1');
      expect(row.outcome).toBe('rejected');
      expect(row.checks.find((c) => c.rule === 'blockedAuthor')?.outcome).toBe(
        'fail',
      );
    });
  });
});

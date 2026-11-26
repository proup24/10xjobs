import { PREFILTER_VERSION } from '../config/prefilter.config';
import { MemoryPrefilterRepository } from '../testing/memory-prefilter';
import { PrefilterService } from './prefilter.service';

/** One onsite job in France; no profile below wants hybrid or onsite there. */
const onsiteFR = { workplaceType: 'onsite', countryCode: 'FR' } as const;

function setup() {
  const repo = new MemoryPrefilterRepository();
  // A published profile that wants hybrid only in Morocco.
  repo.profiles.push({
    locations: {
      remote: [{ kind: 'worldwide' }],
      hybrid: [{ kind: 'country', code: 'MA' }],
      onsite: [],
    },
  });
  return { repo, service: new PrefilterService(repo) };
}

describe('PrefilterService', () => {
  it('skips an onsite FR job nobody wants', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR });
    repo.addJob({ id: 'ma', workplaceType: 'onsite', countryCode: 'MA' });

    expect(await service.skipPending()).toEqual({ checked: 2, skipped: 1 });
    expect(repo.job('fr')).toMatchObject({
      processingStatus: 'skipped',
      processingRequestedAt: null,
    });
    expect(repo.job('ma').processingStatus).toBe('pending');
  });

  it('leaves a job with an extraction pending', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR, currentExtractionId: 'e1' });

    expect(await service.skipPending()).toEqual({ checked: 0, skipped: 0 });
    expect(repo.job('fr').processingStatus).toBe('pending');
  });

  it('leaves a joined job pending', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR, processingReason: 'joined' });

    expect(await service.skipPending()).toEqual({ checked: 0, skipped: 0 });
    expect(repo.job('fr').processingStatus).toBe('pending');
  });

  it('leaves a post pending', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'post', ...onsiteFR, kind: 'post' });
    repo.addJob({ id: 'role', ...onsiteFR, kind: 'post_role' });

    expect(await service.skipPending()).toEqual({ checked: 0, skipped: 0 });
    expect(repo.job('post').processingStatus).toBe('pending');
    expect(repo.job('role').processingStatus).toBe('pending');
  });

  it('leaves a job out of the processor scope pending', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'ashby', ...onsiteFR, linkedIn: false });
    repo.addJob({ id: 'merged', ...onsiteFR, status: 'merged' });

    expect(await service.skipPending()).toEqual({ checked: 0, skipped: 0 });
    expect(repo.job('ashby').processingStatus).toBe('pending');
    expect(repo.job('merged').processingStatus).toBe('pending');
  });

  it('records the reason with PREFILTER_VERSION', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', workplaceType: 'hybrid', countryCode: 'fr' });

    await service.skipPending();
    expect(repo.job('fr').processingSkip).toEqual({
      version: PREFILTER_VERSION,
      tag: 'hybrid',
      country: 'FR',
    });
  });

  it('a job that gained an extraction between list and mark is not skipped', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR });
    repo.beforeMark = (jobId: string) => {
      repo.job(jobId).currentExtractionId = 'e1';
    };

    expect(await service.skipPending()).toEqual({ checked: 1, skipped: 0 });
    expect(repo.job('fr')).toMatchObject({
      processingStatus: 'pending',
      processingSkip: null,
    });
  });

  it('a job that left pending between list and mark is not skipped', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR });
    repo.beforeMark = (jobId: string) => {
      repo.job(jobId).processingStatus = 'processing';
    };

    expect(await service.skipPending()).toEqual({ checked: 1, skipped: 0 });
    expect(repo.job('fr').processingStatus).toBe('processing');
  });

  it('loads the demand once per call', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'a', ...onsiteFR });
    repo.addJob({ id: 'b', ...onsiteFR });

    await service.skipPending();
    expect(repo.demandLoads).toBe(1);
  });

  it('checks at most `limit` jobs', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'a', ...onsiteFR });
    repo.addJob({ id: 'b', ...onsiteFR });

    expect(await service.skipPending(1)).toEqual({ checked: 1, skipped: 1 });
  });

  it('with no published profile, skips a tagged job without remote words', async () => {
    const { repo, service } = setup();
    repo.profiles.length = 0;
    repo.addJob({ id: 'fr', ...onsiteFR });
    repo.addJob({
      id: 'words',
      ...onsiteFR,
      descriptionText: 'Two days of télétravail a week.',
    });

    expect(await service.skipPending()).toEqual({ checked: 2, skipped: 1 });
    expect(repo.job('words').processingStatus).toBe('pending');
  });

  it('throws and skips nothing when the demand cannot be loaded', async () => {
    const { repo, service } = setup();
    repo.addJob({ id: 'fr', ...onsiteFR });
    repo.demandError = new Error('connection lost');

    await expect(service.skipPending()).rejects.toThrow('connection lost');
    expect(repo.job('fr').processingStatus).toBe('pending');
  });

  describe('skipJob', () => {
    it('skips the job when nobody wants it', async () => {
      const { repo, service } = setup();
      repo.addJob({ id: 'fr', ...onsiteFR });

      expect(await service.skipJob('fr')).toBe(true);
      expect(repo.job('fr').processingStatus).toBe('skipped');
    });

    it('leaves a wanted, posted or extracted job alone', async () => {
      const { repo, service } = setup();
      repo.addJob({ id: 'ma', workplaceType: 'hybrid', countryCode: 'MA' });
      repo.addJob({ id: 'post', ...onsiteFR, kind: 'post' });
      repo.addJob({ id: 'ex', ...onsiteFR, currentExtractionId: 'e1' });

      for (const id of ['ma', 'post', 'ex', 'missing'])
        expect(await service.skipJob(id)).toBe(false);
      expect(repo.job('ma').processingStatus).toBe('pending');
    });

    it('does not load the demand for a job that passes without it', async () => {
      const { repo, service } = setup();
      repo.addJob({ id: 'remote', workplaceType: 'remote', countryCode: 'FR' });
      repo.addJob({ id: 'post', ...onsiteFR, kind: 'post' });

      expect(await service.skipJob('remote')).toBe(false);
      expect(await service.skipJob('post')).toBe(false);
      expect(repo.demandLoads).toBe(0);
    });
  });
});

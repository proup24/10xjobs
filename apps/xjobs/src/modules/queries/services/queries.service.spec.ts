import { Arrangement, Channel, Seniority, SkillDomain } from 'src/common/enums';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LOCATIONS_REQUIRED, SKILLS_REQUIRED } from '../steps';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { FakeQuerySearchRepository } from '../testing/fakes';
import { MOCK_PROFILES } from '../testing/profiles.fixture';
import { QuerySearchService } from './queries.service';

// These specs cover every channel's builder, inactive ones included.
vi.mock('src/common/enums', async (importOriginal) => {
  const enums = await importOriginal<typeof import('src/common/enums')>();
  return { ...enums, ACTIVE_CHANNELS: Object.values(enums.Channel) };
});

const profile: QuerySearchProfileInput = {
  position: 'backend_engineer',
  locations: {
    remote: ['EMEA', 'MENA'],
    hybrid: [],
    onsite: ['Casablanca, Morocco'],
  },
  seniorities: [Seniority.senior],
  languages: ['en'],
  skills: [
    {
      technology: 'nestjs',
      domain: SkillDomain.backend,
      importance: 9,
      mastery: 5,
    },
    {
      technology: 'typescript',
      domain: SkillDomain.backend,
      importance: 8,
      mastery: 5,
    },
    {
      technology: 'postgresql',
      domain: SkillDomain.backend,
      importance: 7,
      mastery: 5,
    },
  ],
};

async function setup() {
  const repository = new FakeQuerySearchRepository();
  repository.owners.set('profile-1', 'user-1');
  repository.owners.set('profile-2', 'user-2');
  const service = new QuerySearchService(repository);
  return { service, repository, userId: 'user-1', profileId: 'profile-1' };
}

const counts = (repository: FakeQuerySearchRepository) =>
  repository.rows.map((row) => row.associatedProfiles);

const hashes = (recipes: QuerySearchRecipe[]) =>
  recipes.map((recipe) => recipe.hash);

describe('QuerySearchService', () => {
  describe('expand', () => {
    it('expands each arrangement by its own locations', async () => {
      const { service } = await setup();
      const recipes = service.expand(profile);
      // Other channels: 3 channels x 3 technologies x 3 locations = 27.
      // LinkedIn job board, one level (senior = 4): remote EMEA gives africa, europe
      // and middle east, remote MENA gives mena, onsite Casablanca, Morocco gives
      // morocco, so 5.
      expect(recipes).toHaveLength(32);
      expect(new Set(hashes(recipes)).size).toBe(32);
      expect(recipes.filter((r) => r.type === Arrangement.onsite)).toHaveLength(
        10,
      );
    });

    it('creates only onsite recipes for an onsite-only profile', async () => {
      const { service } = await setup();
      const recipes = service.expand(MOCK_PROFILES.onsiteOnlyCasablanca);
      expect(recipes.length).toBeGreaterThan(0);
      for (const recipe of recipes) {
        expect(recipe.type).toBe(Arrangement.onsite);
        // LinkedIn searches the country; the other channels the city.
        expect(recipe.location).toBe(
          recipe.channel === Channel.LINKEDIN_JOB_BOARD
            ? 'morocco'
            : 'casablanca, morocco',
        );
      }
    });

    it('searches an onsite region as given, with no city', async () => {
      const { service } = await setup();
      const recipes = service.expand({
        ...profile,
        locations: { remote: [], hybrid: [], onsite: ['Europe'] },
      });
      expect(recipes.every((r) => r.location === 'europe')).toBe(true);
    });

    it('rejects a profile with no location', async () => {
      const { service } = await setup();
      const expand = () =>
        service.expand({
          ...profile,
          locations: { remote: [], hybrid: [], onsite: [] },
        });
      expect(expand).toThrow(BadRequestException);
      expect(expand).toThrow(LOCATIONS_REQUIRED);
    });

    it('languages change the recipe hash', async () => {
      const { service } = await setup();
      const board = (languages: string[]) =>
        service
          .expand({ ...profile, languages })
          .filter((r) => r.channel === Channel.LINKEDIN_JOB_BOARD)
          .map((r) => r.hash);
      const en = board(['en']);
      const enEs = board(['en', 'es']);
      expect(en.length).toBeGreaterThan(0);
      expect(en.some((hash) => enEs.includes(hash))).toBe(false);
    });

    it('rejects a profile with no skill above importance 0', async () => {
      const { service } = await setup();
      const expand = () =>
        service.expand({
          ...profile,
          skills: profile.skills.map((skill) => ({ ...skill, importance: 0 })),
        });
      expect(expand).toThrow(BadRequestException);
      expect(expand).toThrow(SKILLS_REQUIRED);
    });

    it('leaves remote hashes unchanged when only onsite locations change', async () => {
      const { service } = await setup();
      const remote = (input: QuerySearchProfileInput) =>
        hashes(
          service
            .expand(input)
            .filter((recipe) => recipe.type === Arrangement.remote),
        );
      expect(
        remote({
          ...profile,
          locations: { ...profile.locations, onsite: ['Rabat, Morocco'] },
        }),
      ).toEqual(remote(profile));
    });

    it('normalizes location formatting', async () => {
      const { service } = await setup();
      const messy = service.expand({
        ...profile,
        locations: {
          remote: [' emea ', 'Mena'],
          hybrid: [],
          onsite: ['  CASABLANCA,   morocco'],
        },
      });
      expect(hashes(messy)).toEqual(hashes(service.expand(profile)));
    });

    it('orders arrangements first, then channels in enum order', async () => {
      const { service } = await setup();
      const recipes = service.expand(profile);
      expect([...new Set(recipes.map((r) => r.type))]).toEqual([
        Arrangement.remote,
        Arrangement.onsite,
      ]);
      const channels = [
        ...new Set(
          recipes
            .filter((r) => r.type === Arrangement.remote)
            .map((r) => r.channel),
        ),
      ];
      expect(channels).toEqual(Object.values(Channel));
    });
  });

  describe('generate', () => {
    it('creates shared builders once, then reuses them', async () => {
      const { service, repository, profileId } = await setup();
      expect(await service.generate(profileId, profile)).toEqual({
        created: 32,
        existing: 0,
      });
      expect(await service.generate(profileId, profile)).toEqual({
        created: 0,
        existing: 32,
      });
      expect(repository.rows).toHaveLength(32);
      expect(repository.links).toHaveLength(32);
      expect(new Set(counts(repository))).toEqual(new Set([1]));
      expect(repository.rows.every((row) => row.isActive)).toBe(true);
    });

    it('builds every recipe from the one position', async () => {
      const { service } = await setup();
      const recipes = service.expand(profile);
      expect(recipes.every((r) => r.position === 'backend_engineer')).toBe(
        true,
      );
    });

    it('shares one builder between profiles with the same recipe and counts both', async () => {
      const { service, repository, profileId } = await setup();
      await service.generate(profileId, profile);
      expect(await service.generate('profile-2', profile)).toEqual({
        created: 0,
        existing: 32,
      });
      expect(repository.rows).toHaveLength(32);
      expect(repository.links).toHaveLength(64);
      expect(new Set(counts(repository))).toEqual(new Set([2]));
    });

    it('is idempotent: attaching twice adds no link and counts nothing twice', async () => {
      const { service, repository, profileId } = await setup();
      await service.generate(profileId, profile);
      await service.generate(profileId, profile);
      expect(repository.links).toHaveLength(32);
      expect(new Set(counts(repository))).toEqual(new Set([1]));
    });

    it('never links a soft-deleted builder again', async () => {
      const { service, repository, profileId } = await setup();
      await service.generate(profileId, profile);
      const [retired] = repository.rows;
      await service.softDelete(retired.id);
      expect(retired).toMatchObject({
        isDeleted: true,
        isActive: false,
        associatedProfiles: 0,
      });
      await service.generate('profile-2', profile);
      expect(repository.links.some((link) => link.queryId === retired.id)).toBe(
        false,
      );
      expect(retired.isActive).toBe(false);
    });

    it('404s retiring an unknown builder', async () => {
      const { service } = await setup();
      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('detach', () => {
    it('takes one associated profile off each shared builder, inactive only at 0', async () => {
      const { service, repository, profileId } = await setup();
      await service.generate(profileId, profile);
      await service.generate('profile-2', profile);
      expect(await service.detach(profileId)).toBe(32);
      expect(new Set(counts(repository))).toEqual(new Set([1]));
      expect(repository.rows.every((row) => row.isActive)).toBe(true);
      await service.detach('profile-2');
      expect(new Set(counts(repository))).toEqual(new Set([0]));
      expect(repository.rows.some((row) => row.isActive)).toBe(false);
      expect(repository.rows).toHaveLength(32);
    });
  });

  describe('list', () => {
    it('lists the builders of a profile and filters by channel', async () => {
      const { service, userId, profileId } = await setup();
      await service.generate(profileId, profile);
      expect(await service.list(userId, profileId)).toHaveLength(32);
      const posts = await service.list(
        userId,
        profileId,
        Channel.LINKEDIN_POSTS,
      );
      expect(posts).toHaveLength(9);
      expect(posts.every((row) => row.channel === Channel.LINKEDIN_POSTS)).toBe(
        true,
      );
    });

    it("404s another user's profile", async () => {
      const { service, profileId } = await setup();
      await service.generate(profileId, profile);
      await expect(service.list('user-2', profileId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides soft-deleted builders', async () => {
      const { service, repository, userId, profileId } = await setup();
      await service.generate(profileId, profile);
      await service.softDelete(repository.rows[0].id);
      expect(await service.list(userId, profileId)).toHaveLength(31);
    });
  });
  describe('listActive', () => {
    it("returns a channel's active, non-deleted builders across profiles, oldest first", async () => {
      const { service, repository, profileId } = await setup();
      await service.generate(profileId, profile);
      const ashby = repository.rows.filter(
        (row) => row.channel === Channel.ASHBY,
      );
      ashby.forEach((row, index) => {
        row.createdAt = new Date(Date.UTC(2026, 0, ashby.length - index));
      });
      await service.softDelete(ashby[0].id);
      Object.assign(ashby[1], { associatedProfiles: 0, isActive: false });

      const active = await service.listActive(Channel.ASHBY);

      expect(active.map((row) => row.id)).toEqual(
        ashby
          .slice(2)
          .map((row) => row.id)
          .reverse(),
      );
      expect(active.every((row) => row.channel === Channel.ASHBY)).toBe(true);
    });

    it('returns nothing for a channel without active builders', async () => {
      const { service } = await setup();
      expect(await service.listActive(Channel.GREEN_HOUSE)).toEqual([]);
    });
  });
});

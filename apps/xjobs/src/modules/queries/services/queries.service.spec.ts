import {
  Arrangement,
  Channel,
  Position,
  Region,
  Seniority,
  Technology,
} from 'src/common/enums';
import type { QuerySearchProfileInput, QuerySearchRecipe } from '../types';
import { FakeQuerySearchRepository } from '../testing/fakes';
import { QuerySearchService } from './queries.service';

const profile: QuerySearchProfileInput = {
  positions: [Position.backend_engineer, Position.platform_engineer],
  regions: [Region.EMEA, Region.MENA],
  arrangements: [Arrangement.remote, Arrangement.onsite],
  seniority: Seniority.senior,
  country: 'MA',
  city: 'Casablanca',
  skills: [
    { technology: Technology.nestjs, importance: 9, mastery: 5 },
    {
      technology: Technology.typescript,
      importance: 8,
      mastery: 5,
    },
    {
      technology: Technology.postgresql,
      importance: 7,
      mastery: 5,
    },
  ],
};

async function setup() {
  const repository = new FakeQuerySearchRepository();
  const service = new QuerySearchService(repository);
  return { service, repository, userId: 'user-1', profileId: 'profile-1' };
}

const hashes = (recipes: QuerySearchRecipe[]) =>
  recipes.map((recipe) => recipe.hash);

describe('QuerySearchService', () => {
  describe('expand', () => {
    it('expands every channel, position, region, arrangement and set', async () => {
      const { service } = await setup();
      const recipes = service.expand(profile);
      // 4 channels x 2 positions x 2 regions x 2 arrangements x 5 sets
      expect(recipes).toHaveLength(160);
      expect(new Set(hashes(recipes)).size).toBe(160);
    });

    it('drops unstated when a real arrangement remains', async () => {
      const { service } = await setup();
      const recipes = service.expand({
        ...profile,
        arrangements: [Arrangement.remote, Arrangement.unstated],
      });
      expect(recipes.some((r) => r.type === Arrangement.unstated)).toBe(false);
      expect(recipes.length).toBeGreaterThan(0);
    });

    it('keeps unstated when it is the only arrangement', async () => {
      const { service } = await setup();
      const recipes = service.expand({
        ...profile,
        arrangements: [Arrangement.unstated],
      });
      expect(recipes.length).toBeGreaterThan(0);
      expect(recipes.every((r) => r.type === Arrangement.unstated)).toBe(true);
    });

    it('sets the location only for onsite and hybrid recipes', async () => {
      const { service } = await setup();
      const recipes = service.expand(profile);
      for (const recipe of recipes) {
        if (recipe.type === Arrangement.remote) {
          expect(recipe.country).toBeNull();
          expect(recipe.city).toBeNull();
        } else {
          expect(recipe.country).toBe('MA');
          expect(recipe.city).toBe('Casablanca');
        }
      }
    });

    it('leaves remote hashes unchanged when only the city changes', async () => {
      const { service } = await setup();
      const remote = (input: QuerySearchProfileInput) =>
        hashes(
          service
            .expand(input)
            .filter((recipe) => recipe.type === Arrangement.remote),
        );
      expect(remote({ ...profile, city: 'Rabat' })).toEqual(remote(profile));
    });

    it('normalizes country and city formatting', async () => {
      const { service } = await setup();
      const messy = service.expand({
        ...profile,
        country: ' ma ',
        city: '  Casablanca ',
      });
      expect(hashes(messy)).toEqual(hashes(service.expand(profile)));
      const noCity = service.expand({ ...profile, city: '   ' });
      expect(
        noCity
          .filter((recipe) => recipe.type === Arrangement.onsite)
          .every((recipe) => recipe.city === null),
      ).toBe(true);
    });

    it('orders channels first, in enum order', async () => {
      const { service } = await setup();
      const channels = [
        ...new Set(service.expand(profile).map((r) => r.channel)),
      ];
      expect(channels).toEqual(Object.values(Channel));
    });
  });

  describe('generate', () => {
    it('creates once, then reports everything as existing', async () => {
      const { service, repository, userId, profileId } = await setup();
      expect(await service.generate(userId, profileId, profile)).toEqual({
        created: 160,
        existing: 0,
      });
      expect(await service.generate(userId, profileId, profile)).toEqual({
        created: 0,
        existing: 160,
      });
      expect(repository.rows).toHaveLength(160);
    });

    it('creates only the recipes of a new position', async () => {
      const { service, userId, profileId } = await setup();
      await service.generate(userId, profileId, profile);
      const result = await service.generate(userId, profileId, {
        ...profile,
        positions: [...profile.positions, Position.ml_engineer],
      });
      expect(result).toEqual({ created: 80, existing: 160 });
    });

    it('scopes recipes per profile', async () => {
      const { service, userId, profileId } = await setup();
      await service.generate(userId, profileId, profile);
      expect(await service.generate(userId, 'profile-2', profile)).toEqual({
        created: 160,
        existing: 0,
      });
    });

    it('counts a unique violation on create as existing', async () => {
      const { service, repository, userId, profileId } = await setup();
      const create = repository.create.bind(repository);
      let failed = false;
      repository.create = async (id, profile, recipe) => {
        if (!failed) {
          failed = true;
          throw { sqlState: '23505' };
        }
        return create(id, profile, recipe);
      };
      expect(await service.generate(userId, profileId, profile)).toEqual({
        created: 159,
        existing: 1,
      });
    });

    it('rethrows any other create error', async () => {
      const { service, repository, userId, profileId } = await setup();
      repository.create = async () => {
        throw new Error('boom');
      };
      await expect(
        service.generate(userId, profileId, profile),
      ).rejects.toThrow('boom');
    });
  });

  describe('list', () => {
    it('lists a workspace and filters by channel', async () => {
      const { service, userId, profileId } = await setup();
      await service.generate(userId, profileId, profile);
      expect(await service.list(userId, profileId)).toHaveLength(160);
      const posts = await service.list(
        userId,
        profileId,
        Channel.LINKEDIN_POSTS,
      );
      expect(posts).toHaveLength(40);
      expect(posts.every((row) => row.channel === Channel.LINKEDIN_POSTS)).toBe(
        true,
      );
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let repository: FakeUsersRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository);
  });

  it('404s an unknown user on get and eligibility', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.eligibility('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads eligibility, null until set', async () => {
    const user = repository.add();
    await expect(service.eligibility(user.id)).resolves.toEqual({
      residenceCountry: null,
      acceptsSponsorship: null,
    });
    repository.setEligibility(user.id, {
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    });
    await expect(service.eligibility(user.id)).resolves.toEqual({
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    });
    await expect(service.getOrThrow(user.id)).resolves.toMatchObject({
      id: user.id,
    });
  });
});

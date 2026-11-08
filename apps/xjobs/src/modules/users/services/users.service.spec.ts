import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FakeUsersRepository } from '../testing/fakes';
import { toUserView, UsersService } from './users.service';

describe('UsersService', () => {
  let repository: FakeUsersRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository);
  });

  it('404s an unknown user on get and update', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update('missing', { name: 'Mallory' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('names a user created without a name, ', async () => {
    const user = repository.add();
    await expect(
      service.update(user.id, { name: 'Robert' }),
    ).resolves.toMatchObject({ id: user.id, name: 'Robert' });
  });

  it('reads eligibility, null until set, and returns it in the user view', async () => {
    const user = repository.add();
    await expect(service.eligibility(user.id)).resolves.toEqual({
      residenceCountry: null,
      acceptsSponsorship: null,
    });
    await service.update(user.id, {
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    });
    await expect(service.eligibility(user.id)).resolves.toEqual({
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    });
    expect(toUserView(await service.getOrThrow(user.id))).toMatchObject({
      residenceCountry: 'MA',
      acceptsSponsorship: false,
    });
  });

  it('turns a database check violation on update into a 400 with its message', async () => {
    const user = repository.add();
    const message =
      "users.residenceCountry: 'ZZ' is not an approved countries code";
    vi.spyOn(repository, 'update').mockRejectedValue(
      Object.assign(new Error(message), { sqlState: '23514' }),
    );
    await expect(
      service.update(user.id, { residenceCountry: 'ZZ' }),
    ).rejects.toThrow(new BadRequestException(message));
    const other = new Error('boom');
    vi.spyOn(repository, 'update').mockRejectedValue(other);
    await expect(service.update(user.id, { name: 'x' })).rejects.toBe(other);
  });
});

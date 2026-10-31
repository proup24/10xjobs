import { ConflictException, NotFoundException } from '@nestjs/common';
import { FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let repository: FakeUsersRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository);
  });

  it('stores the email lowercased and 409s a duplicate, ignoring case', async () => {
    const user = await service.create({
      name: 'Bob',
      email: ' Bob@Example.com ',
    });
    expect(user.email).toBe('bob@example.com');
    await expect(
      service.create({ name: 'Bob', email: 'BOB@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown user on get, update and delete', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update('missing', { name: 'Mallory' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates and deletes a user by id', async () => {
    const user = await service.create({ name: 'Bob', email: 'bob@x.com' });
    await expect(
      service.update(user.id, { name: 'Robert' }),
    ).resolves.toMatchObject({ name: 'Robert' });
    await service.delete(user.id);
    expect(repository.rows).toEqual([]);
  });
});

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

  it('names a user created without a name, then deletes it by id', async () => {
    const user = repository.add();
    await expect(
      service.update(user.id, { name: 'Robert' }),
    ).resolves.toMatchObject({ id: user.id, name: 'Robert' });
    await service.delete(user.id);
    expect(repository.rows).toEqual([]);
  });
});

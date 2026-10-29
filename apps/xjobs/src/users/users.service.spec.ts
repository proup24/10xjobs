import { ConflictException, NotFoundException } from '@nestjs/common';
import { FakeUsersRepository } from './testing/fakes';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let repository: FakeUsersRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUsersRepository();
    service = new UsersService(repository);
  });

  it('409s the same email in the same workspace, ignoring case', async () => {
    await service.create('ws-a', { name: 'Bob', email: 'bob@example.com' });
    await expect(
      service.create('ws-a', { name: 'Bob', email: ' Bob@Example.com ' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the same email in another workspace', async () => {
    await service.create('ws-a', { name: 'Bob', email: 'bob@example.com' });
    await expect(
      service.create('ws-b', { name: 'Bob', email: 'bob@example.com' }),
    ).resolves.toMatchObject({ workspaceId: 'ws-b' });
  });

  it('404s a user reached through another workspace', async () => {
    const user = await service.create('ws-a', {
      name: 'Bob',
      email: 'bob@example.com',
    });
    await expect(service.getOrThrow('ws-b', user.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not update or delete across workspaces', async () => {
    const user = await service.create('ws-a', {
      name: 'Bob',
      email: 'bob@example.com',
    });
    await expect(
      service.update('ws-b', user.id, { name: 'Mallory' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('ws-b', user.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.rows).toEqual([expect.objectContaining({ name: 'Bob' })]);
  });
});

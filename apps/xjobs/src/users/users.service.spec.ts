import { ConflictException, NotFoundException } from '@nestjs/common';
import { toStoredAddress, type UserRow } from 'src/database';
import { UsersRepository, type UserInput } from './users.repository';
import { UsersService } from './users.service';

export class FakeUsersRepository extends UsersRepository {
  rows: UserRow[] = [];

  async create(workspaceId: string, data: UserInput): Promise<UserRow> {
    if (
      this.rows.some(
        (row) => row.workspaceId === workspaceId && row.email === data.email,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: UserRow = {
      id: `user-${this.rows.length + 1}`,
      workspaceId,
      name: data.name,
      email: data.email,
      address: data.address ? toStoredAddress(data.address) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(workspaceId: string): Promise<UserRow[]> {
    return this.rows.filter((row) => row.workspaceId === workspaceId);
  }

  async findById(workspaceId: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.workspaceId === workspaceId && row.id === userId,
      ) ?? null
    );
  }

  async update(workspaceId: string, userId: string, data: Partial<UserInput>) {
    const row = await this.findById(workspaceId, userId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(workspaceId: string, userId: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === workspaceId && row.id === userId),
    );
    return this.rows.length < before;
  }
}

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

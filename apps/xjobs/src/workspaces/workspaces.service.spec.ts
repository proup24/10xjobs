import { ConflictException, NotFoundException } from '@nestjs/common';
import type { WorkspaceRow } from 'src/database';
import {
  WorkspacesRepository,
  type WorkspaceInput,
} from './workspaces.repository';
import { WorkspacesService } from './workspaces.service';

export class FakeWorkspacesRepository extends WorkspacesRepository {
  rows: WorkspaceRow[] = [];

  async create(data: WorkspaceInput): Promise<WorkspaceRow> {
    if (this.rows.some((row) => row.slug === data.slug)) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row = { id: `ws-${this.rows.length + 1}`, ...data, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }

  async list(): Promise<WorkspaceRow[]> {
    return [...this.rows];
  }

  async findById(id: string): Promise<WorkspaceRow | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async update(
    id: string,
    data: Partial<WorkspaceInput>,
  ): Promise<WorkspaceRow | null> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) return null;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
}

describe('WorkspacesService', () => {
  let service: WorkspacesService;

  beforeEach(() => {
    service = new WorkspacesService(new FakeWorkspacesRepository());
  });

  it('creates a workspace', async () => {
    const workspace = await service.create({ name: 'Mine', slug: 'mine' });
    expect(workspace).toMatchObject({ name: 'Mine', slug: 'mine' });
  });

  it('turns a duplicate slug into a 409', async () => {
    await service.create({ name: 'Mine', slug: 'mine' });
    await expect(
      service.create({ name: 'Other', slug: 'mine' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown workspace', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an update of an unknown workspace', async () => {
    await expect(
      service.update('missing', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

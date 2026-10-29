/** In-memory repositories for unit tests; not part of the application build. */
import type { WorkspaceRow } from 'src/database';
import { WorkspacesRepository } from '../repositories/workspaces.repository';
import type { WorkspaceInput } from '../types';

export class FakeWorkspacesRepository extends WorkspacesRepository {
  rows: WorkspaceRow[] = [];

  async create(data: WorkspaceInput): Promise<WorkspaceRow> {
    if (this.rows.some((row) => row.slug === data.slug)) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row = {
      id: `ws-${this.rows.length + 1}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
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

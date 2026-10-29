import { Injectable } from '@nestjs/common';
import { DatabaseService, type WorkspaceRow } from 'src/database';
import type { WorkspaceInput } from '../types';

/** Injection token and contract for workspace persistence. */
export abstract class WorkspacesRepository {
  abstract create(data: WorkspaceInput): Promise<WorkspaceRow>;
  abstract list(): Promise<WorkspaceRow[]>;
  abstract findById(id: string): Promise<WorkspaceRow | null>;
  abstract update(
    id: string,
    data: Partial<WorkspaceInput>,
  ): Promise<WorkspaceRow | null>;
}

@Injectable()
export class PrismaWorkspacesRepository extends WorkspacesRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get workspaces() {
    return this.database.db.orm.public.Workspace;
  }

  create(data: WorkspaceInput): Promise<WorkspaceRow> {
    return this.workspaces.create(data);
  }

  async list(): Promise<WorkspaceRow[]> {
    return await this.workspaces.orderBy((w) => w.createdAt.asc()).all();
  }

  findById(id: string): Promise<WorkspaceRow | null> {
    return this.workspaces.where({ id }).first();
  }

  async update(
    id: string,
    data: Partial<WorkspaceInput>,
  ): Promise<WorkspaceRow | null> {
    if (Object.keys(data).length === 0) return this.findById(id);
    return this.workspaces.where({ id }).update(data);
  }
}

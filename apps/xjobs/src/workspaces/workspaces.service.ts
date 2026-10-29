import { Injectable, NotFoundException } from '@nestjs/common';
import { rethrowConflict, type WorkspaceRow } from 'src/database';
import {
  WorkspacesRepository,
  type WorkspaceInput,
} from './workspaces.repository';

const SLUG_TAKEN = 'A workspace with this slug already exists';

@Injectable()
export class WorkspacesService {
  constructor(private readonly workspaces: WorkspacesRepository) {}

  create(data: WorkspaceInput): Promise<WorkspaceRow> {
    return this.workspaces
      .create(data)
      .catch((error: unknown) => rethrowConflict(error, SLUG_TAKEN));
  }

  list(): Promise<WorkspaceRow[]> {
    return this.workspaces.list();
  }

  async getOrThrow(id: string): Promise<WorkspaceRow> {
    const workspace = await this.workspaces.findById(id);
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async update(
    id: string,
    data: Partial<WorkspaceInput>,
  ): Promise<WorkspaceRow> {
    const workspace = await this.workspaces
      .update(id, data)
      .catch((error: unknown) => rethrowConflict(error, SLUG_TAKEN));
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }
}

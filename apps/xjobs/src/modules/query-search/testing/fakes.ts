/** In-memory repositories for unit tests; not part of the application build. */
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { QuerySearchRepository } from '../repositories/query-search.repository';
import type { QuerySearchRecipe } from '../types';

export class FakeQuerySearchRepository extends QuerySearchRepository {
  rows: QuerySearchBuilderRow[] = [];

  async findHashes(
    workspaceId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    const wanted = new Set(hashes);
    return new Set(
      this.rows
        .filter((row) => row.workspaceId === workspaceId)
        .map((row) => row.hash)
        .filter((hash) => wanted.has(hash)),
    );
  }

  async create(
    workspaceId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow> {
    if (
      this.rows.some(
        (row) => row.workspaceId === workspaceId && row.hash === recipe.hash,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const { position: _position, ...columns } = recipe;
    const now = new Date();
    const row = {
      id: `qs-${this.rows.length + 1}`,
      ...columns,
      workspaceId,
      createdAt: now,
      updatedAt: now,
    } as QuerySearchBuilderRow;
    this.rows.push(row);
    return row;
  }

  async list(
    workspaceId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    return this.rows.filter(
      (row) =>
        row.workspaceId === workspaceId &&
        (!channel || row.channel === channel),
    );
  }
}

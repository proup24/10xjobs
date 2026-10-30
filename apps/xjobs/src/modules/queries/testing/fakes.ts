/** In-memory repositories for unit tests; not part of the application build. */
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { QuerySearchRepository } from '../repositories/queries.repository';
import type { QuerySearchRecipe } from '../types';

export class FakeQuerySearchRepository extends QuerySearchRepository {
  rows: QuerySearchBuilderRow[] = [];

  async findHashes(
    userId: string,
    profileId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    const wanted = new Set(hashes);
    return new Set(
      this.rows
        .filter((row) => row.userId === userId && row.profileId === profileId)
        .map((row) => row.hash)
        .filter((hash) => wanted.has(hash)),
    );
  }

  async create(
    userId: string,
    profileId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow> {
    if (
      this.rows.some(
        (row) => row.profileId === profileId && row.hash === recipe.hash,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const { position: _position, ...columns } = recipe;
    const now = new Date();
    const row = {
      id: `qs-${this.rows.length + 1}`,
      ...columns,
      userId,
      profileId,
      createdAt: now,
      updatedAt: now,
    } as QuerySearchBuilderRow;
    this.rows.push(row);
    return row;
  }

  async list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    return this.rows.filter(
      (row) =>
        row.userId === userId &&
        row.profileId === profileId &&
        (!channel || row.channel === channel),
    );
  }
}

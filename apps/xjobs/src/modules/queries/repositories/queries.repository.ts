import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type QuerySearchBuilderRow } from 'src/database';
import type { QuerySearchRecipe } from '../types';

/** Injection token and contract for query search builder persistence, scoped by workspace. */
export abstract class QuerySearchRepository {
  /** The subset of `hashes` already stored in the workspace. */
  abstract findHashes(
    workspaceId: string,
    hashes: string[],
  ): Promise<Set<string>>;
  /** Stores every recipe field except `position`; a duplicate `(workspaceId, hash)` is a unique violation. */
  abstract create(
    workspaceId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow>;
  /** Oldest first, optionally narrowed to one channel. */
  abstract list(
    workspaceId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]>;
}

@Injectable()
export class PrismaQuerySearchRepository extends QuerySearchRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async findHashes(
    workspaceId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const rows = await this.database.db.orm.public.QuerySearchBuilder.where({
      workspaceId,
    })
      .where((row) => row.hash.in(hashes))
      .all();
    return new Set(rows.map((row) => row.hash));
  }

  create(
    workspaceId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow> {
    // `position` only shapes the keywords and is not a column.
    const { position: _position, ...columns } = recipe;
    return this.database.db.orm.public.QuerySearchBuilder.create({
      ...columns,
      // Channel builders emit plain JSON; the column type is the JSON union.
      params: columns.params as QuerySearchBuilderRow['params'],
      workspaceId,
    });
  }

  async list(
    workspaceId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    const collection = this.database.db.orm.public.QuerySearchBuilder.where(
      channel ? { workspaceId, channel } : { workspaceId },
    );
    return await collection.orderBy((row) => row.createdAt.asc()).all();
  }
}

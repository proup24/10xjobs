import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type QuerySearchBuilderRow } from 'src/database';
import type { QuerySearchRecipe } from '../types';

/** Query recipes are scoped to an owning user and one of their profiles. */
export abstract class QuerySearchRepository {
  /** The subset of `hashes` already stored for this profile. */
  abstract findHashes(
    userId: string,
    profileId: string,
    hashes: string[],
  ): Promise<Set<string>>;
  /** Stores every recipe field except `position`; `(profileId, hash)` is unique. */
  abstract create(
    userId: string,
    profileId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow>;
  /** Oldest first, optionally narrowed to one channel. */
  abstract list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]>;
}

@Injectable()
export class PrismaQuerySearchRepository extends QuerySearchRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async findHashes(
    userId: string,
    profileId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const rows = await this.database.db.orm.public.QuerySearchBuilder.where({
      userId,
      profileId,
    })
      .where((row) => row.hash.in(hashes))
      .all();
    return new Set(rows.map((row) => row.hash));
  }

  create(
    userId: string,
    profileId: string,
    recipe: QuerySearchRecipe,
  ): Promise<QuerySearchBuilderRow> {
    // `position` only shapes the keywords and is not a column.
    const { position: _position, ...columns } = recipe;
    return this.database.db.orm.public.QuerySearchBuilder.create({
      ...columns,
      // Channel builders emit plain JSON; the column type is the JSON union.
      params: columns.params as QuerySearchBuilderRow['params'],
      userId,
      profileId,
    });
  }

  async list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    const collection = this.database.db.orm.public.QuerySearchBuilder.where(
      channel ? { userId, profileId, channel } : { userId, profileId },
    );
    return await collection.orderBy((row) => row.createdAt.asc()).all();
  }
}

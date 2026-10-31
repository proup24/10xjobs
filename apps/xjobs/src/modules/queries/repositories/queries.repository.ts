import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import {
  DatabaseService,
  isRetryableTransactionError,
  type QuerySearchBuilderRow,
} from 'src/database';
import type { DatabaseTransaction } from 'src/database/seeds/seed.interface';
import type { QuerySearchRecipe, QuerySearchAttachResult } from '../types';

/**
 * Query search builders are shared recipes, deduplicated by hash across every
 * profile. A profile uses them through association rows; each builder counts
 * its associations and is active while it has at least one.
 */
export abstract class QuerySearchRepository {
  /**
   * Links the profile to the shared builder of each recipe, creating missing
   * builders; each newly linked builder gains one associated profile and is
   * active. Idempotent. Soft-deleted builders are never linked.
   */
  abstract attach(
    profileId: string,
    recipes: QuerySearchRecipe[],
  ): Promise<QuerySearchAttachResult>;
  /**
   * Unlinks every builder from the profile: each loses one associated profile
   * and goes inactive at 0. Returns how many links were removed.
   */
  abstract detach(profileId: string): Promise<number>;
  /**
   * The profile's linked, non-deleted builders, oldest first, optionally for one
   * channel; null when the profile is not this user's.
   */
  abstract list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[] | null>;
  /** Retires a builder: unlinks every profile and deactivates it for good. */
  abstract softDelete(queryId: string): Promise<QuerySearchBuilderRow | null>;
}

const MAX_TRANSACTION_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 10;

@Injectable()
export class PrismaQuerySearchRepository extends QuerySearchRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  /** Re-runs the complete transaction on races, so counters never drift. */
  private async transaction<T>(
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.db.transaction(work);
      } catch (error) {
        if (
          attempt >= MAX_TRANSACTION_RETRIES ||
          !isRetryableTransactionError(error)
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** attempt),
        );
      }
    }
  }

  /** Adds `delta` associations to a locked builder; active only while used and not deleted. */
  private static async adjust(
    tx: DatabaseTransaction,
    queryId: string,
    delta: number,
  ): Promise<void> {
    const builder = await tx.orm.public.QuerySearchBuilder.where({
      id: queryId,
    })
      .forUpdate()
      .first();
    if (!builder) throw new Error(`Query search builder ${queryId} vanished`);
    const associatedProfiles = Math.max(0, builder.associatedProfiles + delta);
    await tx.orm.public.QuerySearchBuilder.where({ id: queryId }).update({
      associatedProfiles,
      isActive: associatedProfiles > 0 && !builder.isDeleted,
    });
  }

  attach(
    profileId: string,
    recipes: QuerySearchRecipe[],
  ): Promise<QuerySearchAttachResult> {
    // A stable order keeps concurrent syncs from locking builders crosswise.
    const wanted = [...recipes].sort((a, b) =>
      a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
    );
    return this.transaction(async (tx) => {
      const orm = tx.orm.public;
      const result: QuerySearchAttachResult = { created: 0, existing: 0 };

      for (const recipe of wanted) {
        let builder = await orm.QuerySearchBuilder.where({
          hash: recipe.hash,
        }).first();
        if (!builder) {
          // `position` only shapes the keyword and is not a column.
          const { position: _position, ...columns } = recipe;
          builder = await orm.QuerySearchBuilder.create({
            ...columns,
            // Channel builders emit plain JSON; the column type is the JSON union.
            params: columns.params as QuerySearchBuilderRow['params'],
            associatedProfiles: 0,
            isActive: false,
            isDeleted: false,
          });
          result.created += 1;
        } else {
          result.existing += 1;
        }
        if (builder.isDeleted) continue;
        const linked = await orm.ProfileQuerySearchBuilder.where({
          profileId,
          queryId: builder.id,
        }).first();
        if (linked) continue;
        await orm.ProfileQuerySearchBuilder.create({
          profileId,
          queryId: builder.id,
        });
        await PrismaQuerySearchRepository.adjust(tx, builder.id, 1);
      }

      return result;
    });
  }

  detach(profileId: string): Promise<number> {
    return this.transaction(async (tx) => {
      const orm = tx.orm.public;
      const links = await orm.ProfileQuerySearchBuilder.where({ profileId })
        .orderBy((link) => link.queryId.asc())
        .all();
      for (const link of links) {
        await orm.ProfileQuerySearchBuilder.where({ id: link.id }).delete();
        await PrismaQuerySearchRepository.adjust(tx, link.queryId, -1);
      }
      return links.length;
    });
  }

  async list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[] | null> {
    const orm = this.database.db.orm.public;
    const profile = await orm.Profile.where({ id: profileId, userId }).first();
    if (!profile) return null;
    const links = await orm.ProfileQuerySearchBuilder.where({
      profileId,
    }).all();
    if (links.length === 0) return [];
    const ids = links.map((link) => link.queryId);
    const builders = orm.QuerySearchBuilder.where(
      channel ? { channel, isDeleted: false } : { isDeleted: false },
    ).where((row) => row.id.in(ids));
    return await builders.orderBy((row) => row.createdAt.asc()).all();
  }

  softDelete(queryId: string): Promise<QuerySearchBuilderRow | null> {
    return this.transaction(async (tx) => {
      const orm = tx.orm.public;
      const builder = await orm.QuerySearchBuilder.where({ id: queryId })
        .forUpdate()
        .first();
      if (!builder) return null;
      await orm.ProfileQuerySearchBuilder.where({ queryId }).deleteAll();
      return orm.QuerySearchBuilder.where({ id: queryId }).update({
        isDeleted: true,
        isActive: false,
        associatedProfiles: 0,
      });
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { Channel, Seniority } from 'src/common/enums';
import {
  DatabaseService,
  isRetryableTransactionError,
  type QuerySearchBuilderRow,
} from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import type {
  QuerySearchRecipe,
  QuerySearchAttachResult,
  QuerySearchReplaceResult,
} from '../types';

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
  /** Like `detach`, only for the builders on `channel`; the other links stay. */
  abstract detachChannel(profileId: string, channel: Channel): Promise<number>;
  /**
   * The profile's linked, non-deleted builders, oldest first, optionally for one
   * channel; null when the profile is not this user's.
   */
  abstract list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[] | null>;
  /**
   * Every active, non-deleted builder of one channel, across all profiles,
   * oldest first: what that channel's collection job searches.
   */
  abstract listActive(channel: Channel): Promise<QuerySearchBuilderRow[]>;
  /**
   * Soft-deletes builders of a recipe older than `version` that nothing uses
   * any more (inactive). Returns how many it retired.
   */
  abstract retireOutdated(version: number): Promise<number>;
  /**
   * Swaps the profile's builders for those of `recipes` in one transaction:
   * links the wanted ones, unlinks the rest (a builder the profile keeps is
   * never unlinked), then records `searchesVersion` on the published profile.
   */
  abstract replace(
    profileId: string,
    recipes: QuerySearchRecipe[],
    searchesVersion: number,
  ): Promise<QuerySearchReplaceResult>;
  /**
   * In one transaction, unlinks every builder and deletes the published
   * profile. False, with nothing released, when no published profile matched.
   */
  abstract releaseAndDelete(profileId: string): Promise<boolean>;
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
    return this.transaction((tx) =>
      PrismaQuerySearchRepository.attachIn(tx, profileId, recipes),
    );
  }

  // Builder locks of two profiles' swaps can cross; the 40P01 retry in `transaction` covers it.
  private static async attachIn(
    tx: DatabaseTransaction,
    profileId: string,
    recipes: QuerySearchRecipe[],
  ): Promise<QuerySearchAttachResult> {
    // A stable order keeps concurrent syncs from locking builders crosswise.
    const wanted = [...recipes].sort((a, b) =>
      a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0,
    );
    const orm = tx.orm.public;
    const result: QuerySearchAttachResult = { created: 0, existing: 0 };

    for (const recipe of wanted) {
      let builder = await orm.QuerySearchBuilder.where({
        hash: recipe.hash,
      }).first();
      if (!builder) {
        // `position` only shapes the keyword and is not a column.
        const {
          position: _position,
          languages: _languages,
          experienceLevel: _experienceLevel,
          ...columns
        } = recipe;
        builder = await orm.QuerySearchBuilder.create({
          ...columns,
          // A seniority code; the column still holds the Seniority enum's values.
          experience: columns.experience as Seniority,
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
  }

  // Same note as `attachIn`: a deadlock here is retried by `transaction`.
  /** Unlinks the profile's builders (all, or those `keep` rejects); returns how many. */
  private static async releaseIn(
    tx: DatabaseTransaction,
    profileId: string,
    keepHashes?: Set<string>,
  ): Promise<number> {
    const orm = tx.orm.public;
    const links = await orm.ProfileQuerySearchBuilder.where({ profileId })
      .orderBy((link) => link.queryId.asc())
      .all();
    let dropped = links;
    if (keepHashes && links.length) {
      const builders = await orm.QuerySearchBuilder.where((row) =>
        row.id.in(links.map((link) => link.queryId)),
      ).all();
      const kept = new Set(
        builders
          .filter((builder) => keepHashes.has(builder.hash))
          .map((builder) => builder.id),
      );
      dropped = links.filter((link) => !kept.has(link.queryId));
    }
    for (const link of dropped) {
      await orm.ProfileQuerySearchBuilder.where({ id: link.id }).delete();
      await PrismaQuerySearchRepository.adjust(tx, link.queryId, -1);
    }
    return dropped.length;
  }

  replace(
    profileId: string,
    recipes: QuerySearchRecipe[],
    searchesVersion: number,
  ): Promise<QuerySearchReplaceResult> {
    const wanted = new Set(recipes.map((recipe) => recipe.hash));
    return this.transaction(async (tx) => {
      // Lock the profile first (as releaseAndDelete does): a draft or missing
      // profile must never gain links, since deleting it would skip `adjust`.
      const profile = await tx.orm.public.Profile.where({
        id: profileId,
        state: 'published',
      })
        .forUpdate()
        .first();
      if (!profile) return { created: 0, existing: 0, released: 0 };
      const attached = await PrismaQuerySearchRepository.attachIn(
        tx,
        profileId,
        recipes,
      );
      const released = await PrismaQuerySearchRepository.releaseIn(
        tx,
        profileId,
        wanted,
      );
      await tx.execute(
        tx.raw
          .sql`UPDATE profiles SET "searchesVersion" = ${searchesVersion} WHERE id = ${profileId}::uuid AND state = 'published'`
          .affectedCount()
          .build(),
      );
      return { ...attached, released };
    });
  }

  releaseAndDelete(profileId: string): Promise<boolean> {
    return this.transaction(async (tx) => {
      const profile = await tx.orm.public.Profile.where({
        id: profileId,
        state: 'published',
      })
        .forUpdate()
        .first();
      if (!profile) return false;
      await PrismaQuerySearchRepository.releaseIn(tx, profileId);
      // The row is locked and published, so this deletes exactly it.
      await tx.orm.public.Profile.where({ id: profileId }).deleteAll();
      return true;
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

  detachChannel(profileId: string, channel: Channel): Promise<number> {
    return this.transaction(async (tx) => {
      const orm = tx.orm.public;
      const links = await orm.ProfileQuerySearchBuilder.where({ profileId })
        .orderBy((link) => link.queryId.asc())
        .all();
      const builders = links.length
        ? await orm.QuerySearchBuilder.where({ channel })
            .where((row) => row.id.in(links.map((link) => link.queryId)))
            .all()
        : [];
      const onChannel = new Set(builders.map((builder) => builder.id));
      const dropped = links.filter((link) => onChannel.has(link.queryId));
      for (const link of dropped) {
        await orm.ProfileQuerySearchBuilder.where({ id: link.id }).delete();
        await PrismaQuerySearchRepository.adjust(tx, link.queryId, -1);
      }
      return dropped.length;
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

  async listActive(channel: Channel): Promise<QuerySearchBuilderRow[]> {
    return await this.database.db.orm.public.QuerySearchBuilder.where({
      channel,
      isActive: true,
      isDeleted: false,
    })
      .orderBy((row) => row.createdAt.asc())
      .orderBy((row) => row.id.asc())
      .all();
  }

  retireOutdated(version: number): Promise<number> {
    return this.database.db.orm.public.QuerySearchBuilder.where({
      isActive: false,
      isDeleted: false,
    })
      .where((row) => row.version.lt(version))
      .updateAndCount({ isDeleted: true });
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

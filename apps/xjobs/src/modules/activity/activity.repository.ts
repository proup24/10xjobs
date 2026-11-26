import { Injectable } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import { DatabaseService } from 'src/database';
import { pausedBuildersCte, pausedUsersCte } from './activity.sql';

const UUID = 'pg/uuid@1';
const BOOL = 'pg/bool@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

/** Whether a user's searches are paused, and their latest activity. */
export interface SearchesState {
  /** Paused, and at least one of their builders is paused (any channel). */
  paused: boolean;
  /** The latest of every activity signal over all time; null when none. */
  lastActiveAt: Date | null;
}

/**
 * Who is inactive and which searches only they need. `hours` is the pause
 * span (`SEARCH_PAUSE_AFTER_HOURS`); see `pausedUsersCte` for the definition.
 */
export abstract class ActivityRepository {
  /**
   * The active, non-deleted builders of `channel` whose every published-profile
   * owner is paused at `at`; a builder with no such owner is never in it.
   */
  abstract pausedBuilderIds(
    channel: Channel,
    at: Date,
    hours: number,
  ): Promise<Set<string>>;
  /** The user's searches state at `at`; an unknown user is not paused and never active. */
  abstract userState(
    userId: string,
    at: Date,
    hours: number,
  ): Promise<SearchesState>;
  /** Records a resume at `at`; never moves `searchesResumedAt` back. */
  abstract resume(userId: string, at: Date): Promise<void>;
}

@Injectable()
export class PrismaActivityRepository extends ActivityRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async pausedBuilderIds(
    channel: Channel,
    at: Date,
    hours: number,
  ): Promise<Set<string>> {
    const { db } = this.database;
    const { raw } = db;
    const rows = await db.query(
      raw.sql`WITH ${pausedUsersCte(raw, at, hours)}, ${pausedBuildersCte(raw)}
        SELECT id FROM paused_builders WHERE channel = ${channel}::text`
        .returnsRow({ id: UUID })
        .build(),
    );
    return new Set(rows.map((row) => row.id as string));
  }

  async userState(
    userId: string,
    at: Date,
    hours: number,
  ): Promise<SearchesState> {
    const { db } = this.database;
    const { raw } = db;
    const rows = await db.query(
      raw.sql`WITH ${pausedUsersCte(raw, at, hours)}, ${pausedBuildersCte(raw)}
        SELECT
          (EXISTS (SELECT 1 FROM paused_users pu WHERE pu."userId" = u.id)
           AND EXISTS (
             SELECT 1 FROM paused_builders b
               JOIN public.profile_query_search_builders l ON l."queryId" = b.id
               JOIN public.profiles p ON p.id = l."profileId" AND p.state = 'published'
              WHERE p."userId" = u.id)) AS paused,
          GREATEST(
            u."searchesResumedAt",
            (SELECT max(d."decidedAt") FROM public.job_decisions d WHERE d."userId" = u.id),
            (SELECT max(v."viewedAt") FROM public.job_views v WHERE v."userId" = u.id),
            (SELECT max(r."createdAt") FROM public.match_reviews r WHERE r."userId" = u.id),
            (SELECT max(x."receivedAt") FROM public.webhook_callbacks x WHERE x."userId" = u.id),
            (SELECT max(p."publishedAt") FROM public.profiles p
              WHERE p."userId" = u.id AND p.state = 'published')) AS "lastActiveAt"
        FROM public.users u
        WHERE u.id = ${userId}::uuid`
        .returnsRow({ paused: BOOL, lastActiveAt: TIMESTAMP })
        .build(),
    );
    const row = rows[0];
    if (!row) return { paused: false, lastActiveAt: null };
    return {
      paused: row.paused as boolean,
      lastActiveAt: (row.lastActiveAt as Date | null) ?? null,
    };
  }

  async resume(userId: string, at: Date): Promise<void> {
    const { db } = this.database;
    await db.execute(
      db.raw.sql`UPDATE public.users
          SET "searchesResumedAt" = GREATEST("searchesResumedAt", ${at.toISOString()}::timestamptz)
        WHERE id = ${userId}::uuid`
        .affectedCount()
        .build(),
    );
  }
}

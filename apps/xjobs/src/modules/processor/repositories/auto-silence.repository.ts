import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';

const TEXT = 'pg/text@1';
const INT = 'pg/int4@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

/** The automatic silencing rule (spec: "Automatic silencing"). */
export const AUTO_SILENCE_RULE = {
  /** Counted posts an author needs. */
  minPosts: 10,
  /** Days from the first counted post's `firstSeenAt` to the last one's. */
  minDays: 7,
} as const;

/** An author the rule would silence, with the evidence for it. */
export interface AutoSilenceCandidate {
  /** The original post's author key (see `originalAuthorOf`). */
  authorKey: string;
  /** The author's name on their newest post. */
  name: string | null;
  /** Posts counted: every current post extraction but `role_filled` ones. */
  counted: number;
  /** The first and last counted post job's `firstSeenAt`. */
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Counted posts per verdict (`junk`, `not_hiring`). */
  verdicts: Record<string, number>;
}

export abstract class AutoSilenceRepository {
  /**
   * Authors not yet silenced whom the rule silences: at least 10 counted posts
   * over at least 7 days, every counted one ruled `not_hiring` or `junk`, and
   * no role job of any of their posts ever `qualified`. Most counted first.
   */
  abstract candidates(): Promise<AutoSilenceCandidate[]>;
}

/**
 * A post source's author key and name, by the rule of `originalAuthorOf`: a
 * share's original author (null when the original names none, never the
 * sharer), or the source's own author for a non-share. `s` is one element of
 * `postSources.sources`.
 */
const AUTHOR_OF = (field: 'key' | 'name') =>
  `CASE WHEN jsonb_typeof(s->'original') = 'object'
    THEN s->'original'->'author'->>'${field}'
    ELSE s->'author'->>'${field}' END`;

/**
 * One row per (post job, author) for every active post job that still has its
 * sources. An archived post job keeps none (`postSources` is cleared when its
 * last source becomes a Prepare drop), so it is never attributed to anyone.
 */
const AUTHORED = `SELECT DISTINCT ON (j.id, key) j.id, j."firstSeenAt", j."currentExtractionId",
    ${AUTHOR_OF('key')} AS key, ${AUTHOR_OF('name')} AS name
  FROM normalized_jobs j
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(j."postSources"->'sources') = 'array'
      THEN j."postSources"->'sources' ELSE '[]'::jsonb END) s
  WHERE j.kind = 'post' AND j.status = 'active'
    AND j."processingStatus" IS DISTINCT FROM 'archived'
  ORDER BY j.id, key, name`;

const CANDIDATES = `WITH authored AS (${AUTHORED}),
  ruled AS (
    SELECT a.id, a.key, a.name, a."firstSeenAt", e.verdict,
      -- A role filled: the author was hiring, so it neither counts nor blocks.
      NOT (e.verdict = 'not_hiring' AND e."verdictReason" IS NOT DISTINCT FROM 'role_filled') AS counted
    FROM authored a
    JOIN job_extractions e ON e.id = a."currentExtractionId" AND e."docType" = 'post'
    WHERE a.key IS NOT NULL
  ),
  grouped AS (
    SELECT key,
      (array_agg(name ORDER BY "firstSeenAt" DESC, id DESC))[1] AS name,
      count(*) FILTER (WHERE counted)::int AS counted,
      min("firstSeenAt") FILTER (WHERE counted) AS first,
      max("firstSeenAt") FILTER (WHERE counted) AS last,
      bool_and(NOT counted OR COALESCE(verdict IN ('not_hiring', 'junk'), false)) AS only_junk
    FROM ruled GROUP BY key
  )
  SELECT g.key AS "authorKey", g.name, g.counted, g.first AS "firstSeenAt",
    g.last AS "lastSeenAt",
    (SELECT jsonb_object_agg(v.verdict, v.n) FROM (
      SELECT r.verdict, count(*)::int AS n FROM ruled r
      WHERE r.key = g.key AND r.counted GROUP BY r.verdict) v) AS verdicts
  FROM grouped g
  WHERE g.only_junk
    AND g.counted >= ${AUTO_SILENCE_RULE.minPosts}
    AND g.last - g.first >= interval '${AUTO_SILENCE_RULE.minDays} days'
    AND NOT EXISTS (SELECT 1 FROM silenced_authors sa WHERE sa."authorKey" = g.key)
    AND NOT EXISTS (
      SELECT 1 FROM authored a
      JOIN normalized_jobs r ON r."parentJobId" = a.id AND r.kind = 'post_role'
      JOIN job_matches m ON m."jobId" = r.id AND m.outcome = 'qualified'
      WHERE a.key = g.key)
  ORDER BY g.counted DESC, g.key`;

@Injectable()
export class PrismaAutoSilenceRepository extends AutoSilenceRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async candidates(): Promise<AutoSilenceCandidate[]> {
    const { raw } = this.database.db;
    // Fixed text: the rule's numbers are constants, nothing user-given.
    const strings = Object.assign([CANDIDATES], { raw: [CANDIDATES] });
    const rows = await this.database.db.query(
      raw
        .sql(strings)
        .returnsRow({
          authorKey: TEXT,
          name: TEXT,
          counted: INT,
          firstSeenAt: TIMESTAMP,
          lastSeenAt: TIMESTAMP,
          verdicts: JSONB,
        })
        .build(),
    );
    return rows.map((row) => ({
      authorKey: row.authorKey as string,
      name: (row.name as string | null) ?? null,
      counted: row.counted as number,
      firstSeenAt: row.firstSeenAt as Date,
      lastSeenAt: row.lastSeenAt as Date,
      verdicts: (row.verdicts as Record<string, number> | null) ?? {},
    }));
  }
}

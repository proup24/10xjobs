/**
 * The read-only queries behind `db:indeed-sample`: the profile's keywords, the
 * live LinkedIn groups each sampled place is compared with, harvestapi's
 * baseline runs and items, and dev's jobs for the overlap lookup.
 */
import type { DatabaseTransaction } from '@xjobs/database';
import type { QuerySearchBuilderRow } from 'src/database';
import {
  linkedinMemberWords,
  mergedLinkedinKeyword,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { mapLinkedinJob } from 'src/modules/ingest/normalize/mappers/linkedin-job.mapper';
import { SEARCH_SPELLINGS } from 'src/modules/queries/builders/search-spellings';
import { segmentKey } from 'src/modules/segments';
import { HARVEST_ACTOR, moroccoDay } from '../actor-compare/report';
import type { PlaceId } from './actors';
import { PLACE_GROUPS, type BaselineJob, type BaselineRun } from './baseline';
import type { DevLookup } from './report';

const JSONB = 'pg/jsonb@1';
const PLACES = Object.keys(PLACE_GROUPS) as PlaceId[];

type Db = Pick<DatabaseTransaction, 'query' | 'raw'>;

export interface PlaceGroup {
  realKeyword: string;
  otherKeywords: string[];
  spellings: string[];
  segmentKeys: string[];
}

interface BuilderRaw {
  id: string;
  channel: string;
  type: string;
  domain: string;
  location: string;
  hash: string;
  params: Record<string, unknown>;
}

function byHash(a: BuilderRaw, b: BuilderRaw): number {
  return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0;
}

/**
 * Active LinkedIn job board builders of each sampled place's location and
 * arrangement, grouped by segment key. The real keyword is the first segment's
 * merged keyword, in segment key order; the rest are printed only.
 */
export async function loadPlaceGroups(
  db: Db,
): Promise<Record<PlaceId, PlaceGroup>> {
  const [row] = await db.query(
    db.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT id::text AS id, channel::text AS channel, type::text AS type,
        domain::text AS domain, location, hash, params
      FROM query_search_builder
      WHERE channel = 'LINKEDIN_JOB_BOARD' AND "isActive" AND NOT "isDeleted") t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  const builders = (row?.rows ?? []) as unknown as BuilderRaw[];
  const out = {} as Record<PlaceId, PlaceGroup>;
  for (const place of PLACES) {
    const { location, type } = PLACE_GROUPS[place];
    const segments = new Map<string, BuilderRaw[]>();
    for (const b of builders) {
      if (b.location !== location || b.type !== type) continue;
      const key = segmentKey(b as unknown as QuerySearchBuilderRow);
      segments.set(key, [...(segments.get(key) ?? []), b]);
    }
    const keys = [...segments.keys()].sort();
    if (keys.length === 0) {
      throw new Error(
        `No active LINKEDIN_JOB_BOARD builders for ${place} (${location}, ${type})`,
      );
    }
    const keywords = keys.map((key) =>
      mergedLinkedinKeyword(
        (segments.get(key) ?? [])
          .sort(byHash)
          .map((b) => ({ params: b.params })),
      ),
    );
    const spellings = [
      ...new Set(
        linkedinMemberWords(
          keys.flatMap((key) =>
            (segments.get(key) ?? []).map((b) => ({ params: b.params })),
          ),
        ).spellings,
      ),
    ].sort();
    out[place] = {
      realKeyword: keywords[0],
      otherKeywords: keywords.slice(1),
      spellings,
      segmentKeys: keys,
    };
  }
  return out;
}

/**
 * The role word plus the technology as the LinkedIn builders search it: its
 * first searched spelling (`go` → `golang`). A technology with no searched
 * spelling falls back to its code.
 */
export function plainKeyword(roleWord: string, technology: string): string {
  const spelling = Object.hasOwn(SEARCH_SPELLINGS, technology)
    ? SEARCH_SPELLINGS[technology][0]?.toLowerCase()
    : undefined;
  return `${roleWord} ${spelling ?? technology}`;
}

/**
 * The role word the most builders search (each builder counted once per word),
 * or null when none has a role word. Ties go to a word that is part of the
 * profile's position code (`fullstack_engineer` → `engineer`), then to the
 * alphabetically first. Builders often all search the same role words, and
 * alphabetical order alone gave `architect` for a full-stack engineer.
 */
export function mostCommonRoleWord(
  roleWordsPerBuilder: readonly (readonly string[])[],
  position = '',
): string | null {
  const counts = new Map<string, number>();
  for (const words of roleWordsPerBuilder)
    for (const word of new Set(words))
      counts.set(word, (counts.get(word) ?? 0) + 1);
  const inPosition = new Set(position.toLowerCase().split(/[^\p{L}]+/u));
  const rank = ([word, count]: [string, number]) =>
    [-count, inPosition.has(word.toLowerCase()) ? 0 : 1] as const;
  const sorted = [...counts].sort((a, b) => {
    const [ca, pa] = rank(a);
    const [cb, pb] = rank(b);
    return ca - cb || pa - pb || a[0].localeCompare(b[0]);
  });
  return sorted[0]?.[0] ?? null;
}

/**
 * The profile's most common role word over its active LinkedIn job board
 * builders (`mostCommonRoleWord`, ties by its position) and the top spelling of its most important
 * skill (ties: higher mastery, then code), e.g. `engineer typescript`.
 */
export async function loadPlainKeyword(
  db: Db,
  profileId: string,
): Promise<string> {
  const [row] = await db.query(
    db.raw.sql`SELECT
      (SELECT coalesce(jsonb_agg(q.params), '[]'::jsonb)
        FROM profile_query_search_builders pq
        JOIN query_search_builder q ON q.id = pq."queryId"
        WHERE pq."profileId" = ${profileId}::uuid
          AND q.channel = 'LINKEDIN_JOB_BOARD' AND q."isActive" AND NOT q."isDeleted") AS members,
      (SELECT to_jsonb(s.technology) FROM profile_skills s
        WHERE s."profileId" = ${profileId}::uuid
        ORDER BY s.importance DESC, s.mastery DESC, s.technology ASC
        LIMIT 1) AS skill,
      (SELECT to_jsonb(p.position) FROM profiles p WHERE p.id = ${profileId}::uuid) AS position`
      .returnsRow({ members: JSONB, skill: JSONB, position: JSONB })
      .build(),
  );
  const members = (row?.members ?? []) as Record<string, unknown>[];
  const roleWord = mostCommonRoleWord(
    members.map((params) => linkedinMemberWords([{ params }]).roleWords),
    (row?.position as string | null | undefined) ?? '',
  );
  const skill = row?.skill as string | null | undefined;
  if (roleWord === null)
    throw new Error(
      `Profile ${profileId} has no active LinkedIn job board builder with role words`,
    );
  if (!skill) throw new Error(`Profile ${profileId} has no skills`);
  return plainKeyword(roleWord, skill);
}

/** Only a run the engine stored as `succeeded` counts as one; `partial` and `failed` keep their status. */
export function baselineStatus(status: string): string {
  const s = status.toLowerCase();
  return s === 'succeeded' ? 'succeeded' : s;
}

/**
 * harvestapi's LINKEDIN_JOB_BOARD runs since `since` in each place's segment
 * keys. Credited by batch actor; a run with no batch (failed before storing)
 * is the channel's actor, harvestapi. Budget skips are not stored as runs.
 */
export async function loadBaselineRuns(
  db: Db,
  segmentKeys: Record<PlaceId, string[]>,
  since: Date,
): Promise<BaselineRun[]> {
  const placeOf = new Map<string, PlaceId>();
  for (const place of PLACES)
    for (const key of segmentKeys[place] ?? []) placeOf.set(key, place);
  const [row] = await db.query(
    db.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT r."segmentKey" AS key, r."startedAt", r.status, r.capped,
        r."costMicroUsd", r."costFinalAt" IS NOT NULL AS "costFinal"
      FROM search_segment_runs r
      LEFT JOIN collection_batches b ON b."segmentRunId" = r.id
      WHERE r.channel = 'LINKEDIN_JOB_BOARD'
        AND coalesce(b.actor, ${HARVEST_ACTOR}::text) = ${HARVEST_ACTOR}::text
        AND r."startedAt" >= ${since.toISOString()}::timestamptz
        AND r."segmentKey" IN (
          SELECT jsonb_array_elements_text(${JSON.stringify([...placeOf.keys()])}::jsonb))) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  type Raw = {
    key: string;
    startedAt: string;
    status: string;
    capped: boolean;
    costMicroUsd: number | null;
    costFinal: boolean;
  };
  return ((row?.rows ?? []) as unknown as Raw[]).flatMap((r) => {
    const place = placeOf.get(r.key);
    return place
      ? [
          {
            place,
            startedAt: new Date(r.startedAt),
            status: baselineStatus(r.status),
            capped: r.capped,
            costMicroUsd: r.costMicroUsd,
            costFinal: r.costFinal,
          },
        ]
      : [];
  });
}

/**
 * The raw items harvestapi's runs of one place saw on one Morocco day, read
 * through `mapLinkedinJob` for the title and description. `jobId` is the raw
 * item id; an item that doesn't map has a null title (never relevant).
 *
 * The day's runs are picked in JS with `moroccoDay`, exactly as
 * `pickBaselineDay` buckets them, not with Postgres' `AT TIME ZONE`: Node and
 * Postgres ship their own tz data, and they can disagree on Casablanca's
 * offset (Node 24.14 and 24.22 already do for late 2026).
 */
export async function loadBaselineJobs(
  db: Db,
  place: PlaceId,
  segmentKeys: string[],
  day: string,
): Promise<BaselineJob[]> {
  // A UTC span wide enough for any offset Casablanca has had (0 or +1),
  // narrowed to the Morocco day in JS.
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const from = new Date(dayStart - 3 * 3_600_000).toISOString();
  const to = new Date(dayStart + 27 * 3_600_000).toISOString();
  const [runRow] = await db.query(
    db.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT b.id::text AS "batchId", r."startedAt"
      FROM search_segment_runs r
      JOIN collection_batches b ON b."segmentRunId" = r.id
      WHERE r.channel = 'LINKEDIN_JOB_BOARD' AND b.actor = ${HARVEST_ACTOR}::text
        AND r."startedAt" >= ${from}::timestamptz AND r."startedAt" < ${to}::timestamptz
        AND r."segmentKey" IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(segmentKeys)}::jsonb))) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  const batchIds = (
    (runRow?.rows ?? []) as unknown as { batchId: string; startedAt: string }[]
  )
    .filter((r) => moroccoDay(new Date(r.startedAt)) === day)
    .map((r) => r.batchId);
  if (batchIds.length === 0) return [];
  const [row] = await db.query(
    db.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT DISTINCT ON (s."rawItemId") s."rawItemId"::text AS "rawItemId",
        s."observedAt", v.payload
      FROM raw_item_sightings s
      JOIN raw_item_versions v ON v.id = s."versionId"
      WHERE s."batchId" IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(batchIds)}::jsonb)::uuid)
      ORDER BY s."rawItemId", s."observedAt" DESC) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  type Raw = { rawItemId: string; observedAt: string; payload: unknown };
  return ((row?.rows ?? []) as unknown as Raw[]).map((r) => {
    const mapped = mapLinkedinJob(
      (r.payload ?? {}) as Record<string, unknown>,
      { scrapedAt: new Date(r.observedAt) },
    );
    const ok = !('invalid' in mapped);
    return {
      place,
      jobId: r.rawItemId,
      title: ok ? mapped.title : null,
      descriptionText: ok ? mapped.descriptionText : null,
    };
  });
}

/**
 * Which of the given strong job keys and `titleCompanyKey` pairs dev already
 * has, over unmerged normalized jobs. The pair is built in SQL the way
 * `titleCompanyKey` builds it: lowercased, trimmed, `title|company`.
 */
export async function loadDevLookup(
  db: Db,
  keys: string[],
  pairs: string[],
): Promise<DevLookup> {
  const [row] = await db.query(
    db.raw
      .sql`WITH k AS (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb) AS v),
      p AS (SELECT jsonb_array_elements_text(${JSON.stringify(pairs)}::jsonb) AS v)
      SELECT
        (SELECT coalesce(jsonb_agg(DISTINCT j."jobKey"), '[]'::jsonb)
          FROM normalized_jobs j JOIN k ON k.v = j."jobKey"
          WHERE j."mergedIntoId" IS NULL) AS keys,
        (SELECT coalesce(jsonb_agg(DISTINCT p.v), '[]'::jsonb)
          FROM normalized_jobs j
          -- titleCompanyKey's counterpart: SQL lower(btrim) and JS toLowerCase().trim() may differ on non-ASCII.
          JOIN p ON p.v = lower(btrim(j.title)) || '|' || lower(btrim(j."companyName"))
          WHERE j."mergedIntoId" IS NULL) AS pairs`
      .returnsRow({ keys: JSONB, pairs: JSONB })
      .build(),
  );
  return {
    strongKeys: new Set((row?.keys ?? []) as string[]),
    titleCompany: new Set((row?.pairs ?? []) as string[]),
  };
}

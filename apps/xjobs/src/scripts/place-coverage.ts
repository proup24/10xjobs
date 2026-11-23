/**
 * For each LinkedIn search place, the jobs it finds that no other place finds.
 * Read-only: it only runs SELECTs.
 *
 *   pnpm --filter @xjobs/xjobs db:place-coverage -- --days 7
 *   pnpm --filter @xjobs/xjobs db:place-coverage -- --days 7 --actor harvestapi/linkedin-job-search
 *
 * Reads the last N days (default 7) of one actor's batches and prints two
 * tables, by place and arrangement type, and by place and seniority level:
 * runs, cost, jobs found, jobs found only by that place, and the best match
 * outcome of those jobs (qualified, review, rejected, none).
 *
 * From 2026-11-23 a harvestapi run covers every level of its place and work
 * type (one search per group, levels merged), so the seniority table credits
 * that run's cost to one of its levels arbitrarily: read per-level cost for
 * harvestapi as noise from that date on.
 */
import { Logger } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import {
  bestOutcome,
  placeCoverage,
  type CoverageRow,
  type Outcome,
  type PlaceRun,
  type Sighting,
} from './place-coverage/logic';

const DEFAULT_ACTOR = 'harvestapi/linkedin-job-search';

function parseDays(value: string | undefined): number {
  const days = Number(value ?? '7');
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days needs a positive whole number');
  }
  return days;
}

function table(title: string, rows: CoverageRow[], by: 'type' | 'level') {
  const header = [
    'place',
    by,
    'runs',
    'cost$',
    'jobs',
    'onlyHere',
    'qualified',
    'review',
    'rejected',
    'none',
  ];
  const body = rows.map((r) => [
    r.place,
    by === 'type' ? r.type : (r.level ?? '(none)'),
    r.runs,
    r.costUsd.toFixed(3),
    r.jobs,
    r.onlyHere,
    r.onlyHereOutcomes.qualified,
    r.onlyHereOutcomes.review,
    r.onlyHereOutcomes.rejected,
    r.onlyHereOutcomes.none,
  ]);
  console.log(`\n${title}`);
  console.table(
    body.map((cells) =>
      Object.fromEntries(header.map((h, i) => [h, cells[i]])),
    ),
  );
}

async function main(): Promise<void> {
  const logger = new Logger('PlaceCoverage');
  const { values } = parseArgs({
    // pnpm forwards a literal `--` separator.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { days: { type: 'string' }, actor: { type: 'string' } },
  });
  const days = parseDays(values.days);
  const actor = values.actor ?? DEFAULT_ACTOR;
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { raw } = db;
    const text = 'pg/text@1';
    const int = 'pg/int4@1';
    const sightings = (await db.query(
      raw.sql`SELECT DISTINCT s."jobId"::text AS "jobId", q.location AS place,
          q.type::text AS type, q.params->>'experienceLevel' AS level
        FROM raw_item_sightings rs
        JOIN collection_batches b ON b.id = rs."batchId" AND b.actor = ${actor}
        JOIN query_search_builder q ON q.id = rs."queryId"
        JOIN normalized_job_sources s ON s."rawItemId" = rs."rawItemId"
        WHERE rs."observedAt" >= now() - make_interval(days => ${days}::int)`
        .returnsRow({ jobId: text, place: text, type: text, level: text })
        .build(),
    )) as {
      jobId: string;
      place: string;
      type: string;
      level: string | null;
    }[];
    const runs = (await db.query(
      raw.sql`SELECT q.location AS place, q.type::text AS type,
          q.params->>'experienceLevel' AS level, r."costMicroUsd" AS "costMicroUsd"
        FROM search_segment_runs r
        JOIN collection_batches b ON b."segmentRunId" = r.id AND b.actor = ${actor}
        JOIN query_search_builder q ON q.id = r."queryIds"[1]
        WHERE r."startedAt" >= now() - make_interval(days => ${days}::int)`
        .returnsRow({
          place: text,
          type: text,
          level: text,
          costMicroUsd: int,
        })
        .build(),
    )) as PlaceRun[];
    const jobIds = [...new Set(sightings.map((s) => s.jobId))];
    const decisions = (await db.query(
      raw.sql`SELECT m."jobId"::text AS "jobId", m.outcome
        FROM job_matches m
        WHERE m."jobId" IN (
          SELECT s."jobId"
          FROM raw_item_sightings rs
          JOIN collection_batches b ON b.id = rs."batchId" AND b.actor = ${actor}
          JOIN normalized_job_sources s ON s."rawItemId" = rs."rawItemId"
          WHERE rs."observedAt" >= now() - make_interval(days => ${days}::int))`
        .returnsRow({ jobId: text, outcome: text })
        .build(),
    )) as { jobId: string; outcome: string }[];
    const byJob = new Map<string, string[]>();
    for (const d of decisions) {
      byJob.set(d.jobId, [...(byJob.get(d.jobId) ?? []), d.outcome]);
    }
    const outcomes = new Map<string, Outcome | 'none'>(
      jobIds.map((id) => [id, bestOutcome(byJob.get(id) ?? [])]),
    );
    const typed: Sighting[] = sightings;
    console.log(`Place coverage: last ${days} days, ${actor}`);
    table(
      'By place and type',
      placeCoverage(typed, runs, outcomes, 'type'),
      'type',
    );
    table(
      'By place and level',
      placeCoverage(typed, runs, outcomes, 'level'),
      'level',
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

/**
 * Suggests search spellings and role words from real collected jobs, and lists
 * spellings that never earn their place. Read-only: it only runs SELECTs.
 *
 *   pnpm --filter @xjobs/xjobs db:spellings -- --days 7
 *   pnpm --filter @xjobs/xjobs db:spellings -- --days 7 --check-totals --dry-run
 *
 * Reads processed LinkedIn jobs last seen in the last N days (default 7) and
 * prints a JSON report:
 * - technologies: per searched technology, over the jobs the processor tagged
 *   with it, each candidate form's share of job texts (title and description),
 *   the forms to consider adding (at least 10%), and the spellings that are
 *   the only match in no job.
 * - roleWordGaps: engineering-titled jobs a profile matched on, whose title has
 *   none of the role words searched for that profile's position and languages.
 *   Jobs and matches that cannot be judged are counted in `skipped`.
 *
 * `--check-totals` (off by default) asks LinkedIn for each suggestion's total
 * with a paid 3-row harvestapi run. It reserves each run's charge cap, refuses
 * when the reserved total passes $0.10, and needs APIFY_TOKEN. `--dry-run`
 * prints the plan and the reserved spend without any Apify call. Without
 * `--check-totals` no Apify client is built and no token is read.
 */
import { Logger } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { linkedInJobIds } from 'src/modules/processor/repositories/processor.repository';
import { SEARCH_SPELLINGS } from 'src/modules/queries/builders/search-spellings';
import { POSITION_ROLE_FAMILY } from 'src/modules/queries/builders/role-words';
import { geoIdOf } from './linkedin-region-test/logic';
import {
  candidateForms,
  checkTotalsPlan,
  roleWordGaps,
  spellingShares,
  suggestSpellings,
  unusedSpellings,
} from './spellings/logic';

const ACTOR = 'harvestapi/linkedin-job-search';
const MEMORY_MBYTES = 1024;

function parseDays(value: string | undefined): number {
  const days = Number(value ?? '7');
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days needs a positive whole number');
  }
  return days;
}

/** jsonb may arrive parsed or as text. */
function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

interface TotalsResult {
  spelling: string;
  total: number | null;
  costUsd: number;
}

/** The paid path: the only code that builds an Apify client. Never reached without --check-totals. */
async function checkTotals(
  suggestions: readonly string[],
  dryRun: boolean,
): Promise<unknown> {
  const plan = checkTotalsPlan(suggestions);
  const summary = {
    runs: plan.runs.map((r) => ({
      spelling: r.spelling,
      keyword: r.keyword,
      rows: r.rows,
      capUsd: Number(r.capUsd.toFixed(4)),
    })),
    reservedUsd: Number(plan.reservedUsd.toFixed(4)),
    capUsd: plan.capUsd,
    fits: plan.fits,
  };
  if (dryRun || plan.runs.length === 0) return { dryRun, ...summary };
  if (!plan.fits) {
    throw new Error(
      `Refusing --check-totals: $${plan.reservedUsd.toFixed(3)} reserved passes the $${plan.capUsd} cap`,
    );
  }
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required for --check-totals');
  const { ApifyClient } = await import('apify-client');
  const client = new ApifyClient({ token });
  const results: TotalsResult[] = [];
  for (const run of plan.runs) {
    const started = await client.actor(ACTOR).start(
      {
        jobTitles: [run.keyword],
        geoIds: [geoIdOf('europe')],
        postedLimit: 'week',
        sortBy: 'date',
        maxItems: run.rows,
      },
      { maxTotalChargeUsd: run.capUsd, memory: MEMORY_MBYTES },
    );
    const finished = await client
      .run(started.id)
      .waitForFinish({ waitSecs: 900 });
    const items = (await client.dataset(finished.defaultDatasetId).listItems())
      .items as Record<string, unknown>[];
    const meta = items[0]?._meta as
      | { pagination?: { totalElements?: unknown } }
      | undefined;
    const total = meta?.pagination?.totalElements;
    results.push({
      spelling: run.spelling,
      total: typeof total === 'number' ? total : null,
      costUsd: finished.usageTotalUsd ?? run.capUsd,
    });
  }
  return { ...summary, results };
}

async function main(): Promise<void> {
  const logger = new Logger('Spellings');
  const { values } = parseArgs({
    // pnpm forwards a literal `--` separator.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      days: { type: 'string' },
      'check-totals': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const days = parseDays(values.days);
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { raw } = db;
    const text = 'pg/text@1';
    const JSONB = 'pg/jsonb@1';
    const tags = (await db.query(
      raw.sql`SELECT code, to_jsonb(aliases) AS aliases
        FROM tech_tags WHERE status = 'approved'`
        .returnsRow({ code: text, aliases: JSONB })
        .build(),
    )) as { code: string; aliases: unknown }[];
    const jobs = (await db.query(
      raw.sql`SELECT j.id, j.title, j."descriptionText" AS description,
          to_jsonb(e."techTags") AS "techTags"
        FROM normalized_jobs j
        JOIN job_extractions e ON e.id = j."currentExtractionId"
        WHERE j."lastSeenAt" >= now() - make_interval(days => ${days}::int)
          AND j."processingStatus" = 'processed'
          AND j.status = 'active' AND j.kind = 'job'
          AND j.id IN (${linkedInJobIds(raw)})`
        .returnsRow({
          id: text,
          title: text,
          description: text,
          techTags: JSONB,
        })
        .build(),
    )) as {
      id: string;
      title: string | null;
      description: string | null;
      techTags: unknown;
    }[];
    const matches = (await db.query(
      raw.sql`SELECT m."jobId", p.position, p.languages
        FROM job_matches m
        JOIN profiles p ON p.id = m."profileId"
        WHERE m."jobId" IN (
          SELECT j.id FROM normalized_jobs j
          WHERE j."lastSeenAt" >= now() - make_interval(days => ${days}::int)
            AND j."processingStatus" = 'processed'
            AND j.id IN (${linkedInJobIds(raw)}))`
        .returnsRow({ jobId: text, position: text, languages: JSONB })
        .build(),
    )) as { jobId: string; position: string; languages: unknown }[];

    const aliasesOf = new Map(
      tags.map((t) => [t.code, json<string[]>(t.aliases) ?? []]),
    );
    const textOf = (j: (typeof jobs)[number]) =>
      `${j.title ?? ''}\n${j.description ?? ''}`;
    const technologies = Object.entries(SEARCH_SPELLINGS).flatMap(
      ([technology, known]) => {
        const tagged = jobs.filter((j) =>
          (json<string[]>(j.techTags) ?? []).includes(technology),
        );
        if (tagged.length === 0) return [];
        const candidates = candidateForms(
          known,
          aliasesOf.get(technology) ?? [],
        );
        const texts = tagged.map(textOf);
        const shares = spellingShares(texts, technology, candidates);
        return [
          {
            technology,
            jobs: tagged.length,
            shares: shares.map((s) => ({
              spelling: s.spelling,
              share: Number(s.share.toFixed(3)),
            })),
            suggested: suggestSpellings(shares, known),
            unused: unusedSpellings(
              texts.map((t) => ({ text: t })),
              known.map((k) => k.toLowerCase()),
            ),
          },
        ];
      },
    );

    const titleOf = new Map(jobs.map((j) => [j.id, j.title ?? '']));
    const matched = new Set<string>();
    const gapInputs: Parameters<typeof roleWordGaps>[0][number][] = [];
    let unknownPosition = 0;
    for (const m of matches) {
      matched.add(m.jobId);
      const title = titleOf.get(m.jobId);
      if (title === undefined) continue;
      if (!Object.hasOwn(POSITION_ROLE_FAMILY, m.position)) {
        unknownPosition++;
        continue;
      }
      const langs = json<{ lang: string }[]>(m.languages) ?? [];
      gapInputs.push({
        title,
        position: m.position,
        languages: langs.map((l) => l.lang),
      });
    }
    const skipped = {
      jobsWithoutMatch: jobs.filter((j) => !matched.has(j.id)).length,
      matchesWithUnknownPosition: unknownPosition,
    };

    const suggestions = [...new Set(technologies.flatMap((t) => t.suggested))];
    const report: Record<string, unknown> = {
      days,
      jobs: jobs.length,
      technologies,
      roleWordGaps: { gaps: roleWordGaps(gapInputs), skipped },
    };
    if (values['check-totals']) {
      report.totals = await checkTotals(suggestions, values['dry-run']);
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Spellings',
  );
  process.exit(1);
});

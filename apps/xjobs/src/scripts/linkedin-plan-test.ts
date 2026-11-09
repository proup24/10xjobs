/**
 * The go/no-go live test of the shared LinkedIn search plan. It spends real
 * Apify money (every run is capped, and the whole script stops before passing
 * TOTAL_BUDGET_USD), so run it by hand and keep the output:
 *
 *   pnpm --filter @xjobs/xjobs apify:linkedin-plan-test > private/linkedin-plan-test.json
 *
 * Needs APIFY_TOKEN and the database variables (read-only). Prints one JSON
 * block per section: places, geo, or, length, containment (one block per pair),
 * ceiling, publishedAt, budget. Every run uses 1024 MB.
 *
 * Flags:
 *   --dry-run               print places, ordered pairs and reserved spend; no Apify calls
 *   --sections a,b          or,length,containment,ceiling (default or,length,containment;
 *                           the ceiling run alone reserves almost the whole $1, so run it
 *                           as its own invocation: --sections ceiling)
 *   --geo '<place>=<id>'    pin a LinkedIn geoId for a place (repeatable); wins over
 *                           LINKEDIN_GEO_IDS. Find it on linkedin.com/jobs (location
 *                           picked in the search, `geoId` in the URL).
 * The decisions (budget, OR forms, containment, publishedAt stats) are in
 * `linkedin-plan-test/logic.ts`.
 */
import '../environment';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { Channel } from 'src/common/enums';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect/config';
import {
  linkedinJobSearchUrl,
  toLinkedinJobBoardInput,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { LINKEDIN_GEO_IDS } from 'src/modules/queries/channels/linkedin_geo';
import {
  BudgetExceededError,
  TOTAL_BUDGET_USD,
  buildPairs,
  classifyRun,
  createBudget,
  datedItems,
  judgeContainment,
  keywordOfLength,
  orForms,
  orderPairs,
  parseGeoArgs,
  parseSections,
  publishedAtStats,
  resolveGeo,
  rowsCap,
  type GeoSource,
  type RunOutcome,
} from './linkedin-plan-test/logic';

const MEMORY_MBYTES = 1024;
const SEVEN_DAYS = 7 * 24 * 3600;
const CONTAINMENT_KEYWORD = 'software engineer';
const CEILING_ROWS = 1200;
const OR_RUNS = 5;
const LENGTHS = [100, 200, 400, 800];

type Item = Record<string, unknown>;

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; both spellings work.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    'dry-run': { type: 'boolean', default: false },
    sections: { type: 'string' },
    geo: { type: 'string', multiple: true },
  },
});
const dryRun = values['dry-run'];
const sections = parseSections(values.sections ?? 'or,length,containment');
const geoOverrides = parseGeoArgs(values.geo ?? []);

const budget = createBudget(TOTAL_BUDGET_USD);
const allItems: Item[] = [];
const geoUsed = new Map<string, { geoId?: string; source: GeoSource }>();
let client: ApifyClient | undefined;
let actor = '';

interface RunResult extends RunOutcome {
  url: string;
  rows: number;
  /** The Apify run status, apart from what it means. */
  status: string;
  statusMessage: string | null;
  error?: string;
  costUsd: number | null;
  searchTotals: unknown;
  items: Item[];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function geoPlace(location: string): { location: string; geoId?: string } {
  const resolved = resolveGeo(location, geoOverrides, LINKEDIN_GEO_IDS);
  geoUsed.set(location, resolved);
  return resolved.geoId ? { location, geoId: resolved.geoId } : { location };
}

/** One capped run of one search; the budget refuses it before it starts. */
async function search(
  keyword: string,
  location: string,
  rows: number,
): Promise<RunResult> {
  const maxTotalChargeUsd = rowsCap(rows);
  budget.reserve(maxTotalChargeUsd);
  const url = linkedinJobSearchUrl(keyword, geoPlace(location), SEVEN_DAYS);
  if (!client) throw new Error('No Apify client');
  try {
    const run = await client
      .actor(actor)
      .call(toLinkedinJobBoardInput(url, rows), {
        maxTotalChargeUsd,
        memory: MEMORY_MBYTES,
        waitSecs: 900,
      });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const totals = await client
      .keyValueStore(run.defaultKeyValueStoreId)
      .getRecord('SEARCH_TOTALS');
    allItems.push(...(items as Item[]));
    return {
      ...classifyRun({
        status: run.status,
        statusMessage: run.statusMessage,
        exitCode: run.exitCode,
      }),
      url,
      rows,
      status: run.status,
      statusMessage: run.statusMessage ?? null,
      costUsd: run.usageTotalUsd ?? null,
      searchTotals: totals?.value ?? null,
      items: items as Item[],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...classifyRun({ status: 'ERROR', error: message }),
      url,
      rows,
      status: 'ERROR',
      statusMessage: null,
      error: message,
      costUsd: null,
      searchTotals: null,
      items: [],
    };
  }
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Items mentioning the term in title or description (punctuation ignored). */
function mentions(items: Item[], term: string): number {
  const needle = squash(term);
  return items.filter((item) =>
    squash(
      `${str(item.jobTitle) ?? ''}${str(item.jobDescription) ?? ''}`,
    ).includes(needle),
  ).length;
}

function summary(result: RunResult) {
  const { items, ...rest } = result;
  return {
    ...rest,
    itemCount: items.length,
    sampleLocations: [...new Set(items.map((i) => str(i.location)))].slice(
      0,
      5,
    ),
    sampleSearchString: str(items[0]?.searchString),
  };
}

function emit(section: string, value: unknown): void {
  console.log(JSON.stringify({ section, ...(value as object) }, null, 2));
}

function emitGeo(): void {
  const entries = [...geoUsed].map(([place, geo]) => ({ place, ...geo }));
  const emea = entries.find((e) => e.place.toLowerCase() === 'emea');
  const warning =
    emea && emea.source === 'none'
      ? 'EMEA has no geoId: the gate cannot pass on text-only EMEA. Pin it with --geo "EMEA=<geoId>".'
      : undefined;
  if (warning) console.error(`WARNING: ${warning}`);
  emit('geo', { places: entries, warning });
}

async function main(): Promise<void> {
  const logger = new Logger('LinkedinPlanTest');
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    // places
    const orm = db.orm.public;
    const builders = await orm.QuerySearchBuilder.where({
      channel: Channel.LINKEDIN_JOB_BOARD,
      isActive: true,
      isDeleted: false,
    }).all();
    const places = [...new Set(builders.map((b) => b.location))].sort();
    const types = [...new Set(builders.map((b) => b.type))].sort();
    emit('places', { places, types });

    const pairs = orderPairs(
      buildPairs(places, {
        regions: await orm.RegionTerm.all(),
        countries: await orm.Country.all(),
        cities: await orm.City.all(),
        links: await orm.RegionCountry.all(),
      }),
    );
    const pairCost = 2 * rowsCap(50);
    const ceilingFloor = sections.has('ceiling') ? rowsCap(CEILING_ROWS) : 0;

    if (dryRun) {
      geoPlace('EMEA');
      for (const pair of pairs) {
        geoPlace(pair.child);
        geoPlace(pair.parent);
      }
      emitGeo();
      const afford = Math.max(
        0,
        Math.floor(
          (TOTAL_BUDGET_USD -
            (sections.has('or') ? OR_RUNS * rowsCap(25) : 0) -
            (sections.has('length') ? LENGTHS.length * rowsCap(25) : 0) -
            ceilingFloor) /
            pairCost,
        ),
      );
      emit('dry-run', {
        sections: [...sections],
        orderedPairs: pairs,
        reservedUsd: {
          or: sections.has('or') ? OR_RUNS * rowsCap(25) : 0,
          length: sections.has('length') ? LENGTHS.length * rowsCap(25) : 0,
          containmentPerPair: sections.has('containment') ? pairCost : 0,
          containmentPairsAffordable: sections.has('containment') ? afford : 0,
          ceiling: ceilingFloor,
        },
        limitUsd: TOTAL_BUDGET_USD,
      });
      return;
    }

    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is required');
    client = new ApifyClient({ token });
    actor = channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run.actor;

    try {
      if (sections.has('or')) {
        const terms = ['nestjs', 'next js'];
        const forms: Record<string, unknown> = {};
        for (const [name, keyword] of Object.entries(orForms(terms))) {
          const result = await search(keyword, 'EMEA', 25);
          forms[name] = {
            keyword,
            ...summary(result),
            mentionsPerTerm: Object.fromEntries(
              terms.map((t) => [t, mentions(result.items, t)]),
            ),
          };
        }
        const singles: Record<string, unknown> = {};
        for (const term of terms) {
          const result = await search(term, 'EMEA', 25);
          singles[term] = {
            ...summary(result),
            mentions: mentions(result.items, term),
          };
        }
        emit('or', { forms, singles });
      }

      if (sections.has('length')) {
        const lengths: Record<string, unknown> = {};
        for (const size of LENGTHS) {
          const keyword = keywordOfLength(size);
          const result = await search(keyword, 'EMEA', 25);
          lengths[String(size)] = {
            chars: keyword.length,
            keyword,
            ...summary(result),
          };
        }
        emit('length', { lengths });
      }

      if (sections.has('containment')) {
        for (const { child, parent } of pairs) {
          // Keep the ceiling run's share, then stop when a pair no longer fits.
          if (budget.remaining() - ceilingFloor < pairCost) {
            emit('containment-stopped', {
              reason: 'budget: the next pair no longer fits',
            });
            break;
          }
          const childRun = await search(CONTAINMENT_KEYWORD, child, 50);
          let parentRun = await search(CONTAINMENT_KEYWORD, parent, 50);
          const side = (run: RunResult) => ({
            ok: run.ok,
            ...datedItems(run.items),
          });
          const c = side(childRun);
          let p = side(parentRun);
          let verdict = judgeContainment(
            { ok: c.ok, items: c.items },
            { ok: p.ok, items: p.items },
          );
          let rerun = false;
          if (verdict.verdict === 'row-limit-cut') {
            rerun = true;
            parentRun = await search(CONTAINMENT_KEYWORD, parent, 200);
            p = side(parentRun);
            verdict = judgeContainment(
              { ok: c.ok, items: c.items },
              { ok: p.ok, items: p.items },
            );
          }
          emit('containment', {
            child,
            parent,
            ...verdict,
            rerunParentAt200: rerun,
            itemsWithoutId: { child: c.withoutId, parent: p.withoutId },
            childRun: summary(childRun),
            parentRun: summary(parentRun),
          });
        }
      }

      if (sections.has('ceiling')) {
        const ceiling = await search('software engineer', 'EMEA', CEILING_ROWS);
        emit('ceiling', {
          ...summary(ceiling),
          itemsReturned: ceiling.items.length,
          // A run stopped by its charge cap is truncated by us, not LinkedIn.
          hitChargeCap: ceiling.chargeCapped,
        });
      }
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) throw error;
      emit('budget-stop', { reason: error.message });
    }

    emitGeo();
    emit('publishedAt', publishedAtStats(allItems));
    emit('budget', {
      reservedUsd: budget.spent(),
      limitUsd: TOTAL_BUDGET_USD,
      note: 'reserved sums each run cap; real spend is lower (see costUsd per run)',
    });
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

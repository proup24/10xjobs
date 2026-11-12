/**
 * The go/no-go live test of the shared LinkedIn search plan. It spends real
 * Apify money (every run is capped, one invocation stops before passing
 * TOTAL_BUDGET_USD, and every invocation together stops before
 * CAMPAIGN_BUDGET_USD), so run it by hand and keep the output:
 *
 *   pnpm --filter @xjobs/xjobs apify:linkedin-plan-test > private/linkedin-plan-test.json
 *
 * Needs APIFY_TOKEN and the database variables (read-only). Prints one JSON
 * block per section: places, plan, geo, or, length, containment (one block per
 * pair, plus one per rerun), ceiling, publishedAt, budget. Every run uses
 * 1024 MB, the ceiling run included (see docs/actors/linkedin-plan-test.md).
 *
 * Flags:
 *   --dry-run               print places, ordered pairs, reserved spend and warnings; no Apify calls
 *   --sections a,b          or,length,containment,ceiling (default or,length,containment;
 *                           the ceiling run alone reserves almost the whole $1, so run it
 *                           as its own invocation: --sections ceiling)
 *   --pairs 'a>b,c>d'       only these containment pairs (child>parent; a city by its name,
 *                           a region by its label or code), in run order
 *   --geo '<place>=<id>'    pin a LinkedIn geoId for a place (repeatable; a region by its
 *                           label or code); wins over LINKEDIN_GEO_IDS. Find it on
 *                           linkedin.com/jobs (location picked in the search, `geoId` in the URL).
 *   --spend-file <path>     the running total across invocations (default
 *                           tmp/linkedin-plan-test-spend.json, gitignored)
 * The decisions (budget, OR forms, pairs, containment, publishedAt stats) are in
 * `linkedin-plan-test/logic.ts`.
 */
import '../environment';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { Channel } from 'src/common/enums';
import {
  CHEAP_SCRAPER_ACTOR,
  linkedinJobSearchUrl,
  toLinkedinJobBoardInput,
} from 'src/modules/collectors/providers/mappers/cheap-scraper-input';
import { LINKEDIN_GEO_IDS } from 'src/modules/queries/channels/linkedin_geo';
import {
  BudgetExceededError,
  CAMPAIGN_BUDGET_USD,
  CEILING_ROWS,
  LENGTHS,
  PAIR_ROWS,
  RERUN_ROWS,
  SMALL_ROWS,
  TOTAL_BUDGET_USD,
  buildPairs,
  classifyRun,
  createBudget,
  datedItems,
  filterPairs,
  invocationLimit,
  judgeContainment,
  keywordOfLength,
  orForms,
  parseGeoArgs,
  parsePairsFilter,
  parseSections,
  planSpend,
  publishedAtStats,
  resolveGeo,
  rowsCap,
  type GeoSource,
  type Pair,
  type RunOutcome,
} from './linkedin-plan-test/logic';

const MEMORY_MBYTES = 1024;
const SEVEN_DAYS = 7 * 24 * 3600;
const CONTAINMENT_KEYWORD = 'software engineer';

type Item = Record<string, unknown>;

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; both spellings work.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    'dry-run': { type: 'boolean', default: false },
    sections: { type: 'string' },
    geo: { type: 'string', multiple: true },
    pairs: { type: 'string' },
    'spend-file': {
      type: 'string',
      default: 'tmp/linkedin-plan-test-spend.json',
    },
  },
});
const dryRun = values['dry-run'];
const sections = parseSections(values.sections ?? 'or,length,containment');
const geoOverrides = parseGeoArgs(values.geo ?? []);
const pairsFilter =
  values.pairs === undefined ? undefined : parsePairsFilter(values.pairs);

/** What every paid invocation reserved, kept in a local file between runs. */
interface Ledger {
  reservedUsd: number;
  runs: { at: string; rows: number; capUsd: number; costUsd: number | null }[];
}
const spendFile = resolve(values['spend-file']);
const ledger: Ledger = existsSync(spendFile)
  ? (JSON.parse(readFileSync(spendFile, 'utf8')) as Ledger)
  : { reservedUsd: 0, runs: [] };
function saveLedger(): void {
  mkdirSync(dirname(spendFile), { recursive: true });
  writeFileSync(spendFile, `${JSON.stringify(ledger, null, 2)}\n`);
}

const limitUsd = invocationLimit(ledger.reservedUsd);
const budget = createBudget(limitUsd);
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

/** A place's search params; `code` is a region's code, so `--geo LATAM=` reaches "Latin America". */
function geoPlace(
  location: string,
  code?: string,
): { location: string; geoId?: string } {
  const resolved = resolveGeo(
    code ? [location, code] : [location],
    geoOverrides,
    LINKEDIN_GEO_IDS,
  );
  geoUsed.set(location, resolved);
  return resolved.geoId ? { location, geoId: resolved.geoId } : { location };
}

/** One capped run of one search; the budget refuses it before it starts. */
async function search(
  keyword: string,
  location: string,
  rows: number,
  code?: string,
): Promise<RunResult> {
  const maxTotalChargeUsd = rowsCap(rows);
  budget.reserve(maxTotalChargeUsd);
  // Recorded before the run starts, so a crash still counts it.
  const entry = {
    at: new Date().toISOString(),
    rows,
    capUsd: maxTotalChargeUsd,
    costUsd: null as number | null,
  };
  ledger.reservedUsd += maxTotalChargeUsd;
  ledger.runs.push(entry);
  saveLedger();
  const url = linkedinJobSearchUrl(
    keyword,
    geoPlace(location, code),
    SEVEN_DAYS,
  );
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
    entry.costUsd = run.usageTotalUsd ?? null;
    saveLedger();
    return {
      ...classifyRun({
        status: run.status,
        statusMessage: run.statusMessage,
        exitCode: run.exitCode,
        usageTotalUsd: run.usageTotalUsd,
        maxTotalChargeUsd,
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

    const allPairs = buildPairs(places, {
      regions: await orm.RegionTerm.all(),
      countries: await orm.Country.all(),
      cities: await orm.City.all(),
      links: await orm.RegionCountry.all(),
    });
    let pairs: Pair[] = allPairs;
    if (pairsFilter) {
      const filtered = filterPairs(allPairs, pairsFilter);
      pairs = filtered.pairs;
      if (filtered.unmatched.length > 0)
        console.error(
          `WARNING: --pairs entries that match no candidate pair: ${filtered.unmatched.join(', ')}`,
        );
    }
    const plan = planSpend({ sections, pairCount: pairs.length, limitUsd });
    const ceilingFloor = plan.reservedUsd.ceiling;
    const pairCost = plan.reservedUsd.containmentPerPair;
    const warnings = [...plan.warnings];
    if (limitUsd < TOTAL_BUDGET_USD)
      warnings.unshift(
        `${spendFile} already records ${ledger.reservedUsd.toFixed(2)} of the ${CAMPAIGN_BUDGET_USD} USD campaign budget: this invocation may reserve only ${limitUsd.toFixed(2)} USD.`,
      );
    for (const warning of warnings) console.error(`WARNING: ${warning}`);
    emit('plan', {
      sections: [...sections],
      orderedPairs: pairs,
      ...plan,
      warnings,
      limitUsd,
      campaign: {
        spendFile,
        reservedBeforeUsd: ledger.reservedUsd,
        limitUsd: CAMPAIGN_BUDGET_USD,
      },
    });

    if (dryRun) {
      geoPlace('EMEA');
      for (const pair of pairs) {
        geoPlace(pair.child, pair.childCode);
        geoPlace(pair.parent, pair.parentCode);
      }
      emitGeo();
      return;
    }

    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is required');
    client = new ApifyClient({ token });
    actor = CHEAP_SCRAPER_ACTOR;

    try {
      if (sections.has('or')) {
        const terms = ['nestjs', 'next js'];
        const forms: Record<string, unknown> = {};
        for (const [name, keyword] of Object.entries(orForms(terms))) {
          const result = await search(keyword, 'EMEA', SMALL_ROWS);
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
          const result = await search(term, 'EMEA', SMALL_ROWS);
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
          const result = await search(keyword, 'EMEA', SMALL_ROWS);
          lengths[String(size)] = {
            chars: keyword.length,
            keyword,
            ...summary(result),
          };
        }
        emit('length', { lengths });
      }

      if (sections.has('containment')) {
        const side = (run: RunResult) => ({
          ok: run.ok,
          ...datedItems(run.items),
        });
        for (const { child, childCode, parent, parentCode } of pairs) {
          // Keep the ceiling run's share, then stop when a pair no longer fits.
          if (budget.remaining() - ceilingFloor < pairCost) {
            emit('containment-stopped', {
              reason: 'budget: the next pair no longer fits',
            });
            break;
          }
          // Both runs share one f_TPR window; the child runs first, so a job
          // only it holds may have aged out of the window before the parent ran.
          const windowStart = Date.now() - SEVEN_DAYS * 1000;
          const childRun = await search(
            CONTAINMENT_KEYWORD,
            child,
            PAIR_ROWS,
            childCode,
          );
          const parentRun = await search(
            CONTAINMENT_KEYWORD,
            parent,
            PAIR_ROWS,
            parentCode,
          );
          const c = side(childRun);
          const p = side(parentRun);
          const parentFull = parentRun.items.length >= PAIR_ROWS;
          const verdict = judgeContainment(c, p, { parentFull, windowStart });
          // Emitted before any rerun, so a budget stop cannot lose paid results.
          emit('containment', {
            child,
            parent,
            ...verdict,
            parentFull,
            itemsWithoutId: { child: c.withoutId, parent: p.withoutId },
            childRun: summary(childRun),
            parentRun: summary(parentRun),
          });
          const inconclusive =
            verdict.verdict === 'row-limit-cut' || verdict.verdict === 'fail';
          if (!inconclusive || !parentFull) continue;
          const rerunCap = rowsCap(RERUN_ROWS);
          if (budget.remaining() - ceilingFloor < rerunCap) {
            emit('containment-rerun', {
              child,
              parent,
              skipped: `budget: a ${RERUN_ROWS}-row rerun (${rerunCap} USD) no longer fits`,
            });
            continue;
          }
          const rerun = await search(
            CONTAINMENT_KEYWORD,
            parent,
            RERUN_ROWS,
            parentCode,
          );
          const r = side(rerun);
          emit('containment-rerun', {
            child,
            parent,
            ...judgeContainment(c, r, {
              parentFull: rerun.items.length >= RERUN_ROWS,
              windowStart,
            }),
            parentFull: rerun.items.length >= RERUN_ROWS,
            itemsWithoutId: { parent: r.withoutId },
            parentRun: summary(rerun),
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
      limitUsd,
      campaign: {
        spendFile,
        reservedUsd: ledger.reservedUsd,
        costUsd: ledger.runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
        limitUsd: CAMPAIGN_BUDGET_USD,
      },
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

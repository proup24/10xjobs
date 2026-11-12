/**
 * The go/no-go parity check of the LinkedIn job board source: the same
 * searches, posted in the last 24 hours, on cheap_scraper and on
 * harvestapi/linkedin-job-search. It spends real Apify money (every run is
 * capped at RUN_CAP_USD and the script refuses to start when the reserved
 * spend is above RESERVED_LIMIT_USD), so run it by hand and keep the output:
 *
 *   pnpm --filter @xjobs/xjobs apify:linkedin-parity > parity.json
 *
 * Needs APIFY_TOKEN. JSON goes to stdout, progress to stderr. Runs are capped,
 * so `returned` may be truncated; `total` is what each actor says LinkedIn has
 * (cheap_scraper's `SEARCH_TOTALS`, harvestapi's `_meta.pagination.totalElements`).
 *
 * Flags:
 *   --search 'keyword|location|f_E|f_WT'   repeatable, empty parts allowed
 *                                          (defaults: three dev builders)
 */
import '../environment';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import {
  CHEAP_SCRAPER_ACTOR,
  linkedinJobSearchUrl,
  toLinkedinJobBoardInput,
} from 'src/modules/collectors/providers/mappers/cheap-scraper-input';
import { toHarvestJobSearchInput } from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';

const HARVEST_ACTOR = 'harvestapi/linkedin-job-search';
const RUN_CAP_USD = 0.03;
const RESERVED_LIMIT_USD = 0.2;
const MAX_ITEMS = 100;
const MEMORY_MBYTES = 1024;
const ONE_DAY_SECONDS = 24 * 3600;

const DEFAULT_SEARCHES = [
  'next js|morocco|3,4|1',
  'nestjs|european economic area|4,5|2',
  'next js|united states|3,4|2',
];

type Item = Record<string, unknown>;

interface Side {
  returned: number;
  total: number | null;
  status: string;
  usageTotalUsd: number | null;
  ids: string[];
  searchTotals?: unknown;
}

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; both spellings work.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { search: { type: 'string', multiple: true } },
});
const searches = values.search?.length ? values.search : DEFAULT_SEARCHES;

function parseSearch(spec: string) {
  const [keyword = '', location = '', experience = '', workType = ''] = spec
    .split('|')
    .map((part) => part.trim());
  if (!keyword) throw new Error(`Search "${spec}" has no keyword`);
  const params: Record<string, unknown> = {
    ...(location ? { location } : {}),
    ...(experience ? { experienceLevel: experience } : {}),
    ...(workType ? { workType } : {}),
  };
  return { keyword, params };
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** cheap_scraper's total from its SEARCH_TOTALS record; the raw record is also printed. */
function cheapTotal(record: unknown): number | null {
  if (typeof record === 'number') return record;
  if (record && typeof record === 'object') {
    const { total } = record as Record<string, unknown>;
    if (typeof total === 'number') return total;
    const numbers = Object.values(record).filter(
      (v): v is number => typeof v === 'number',
    );
    if (numbers.length === 1) return numbers[0];
  }
  return null;
}

async function main(): Promise<void> {
  const reservedUsd = searches.length * 2 * RUN_CAP_USD;
  if (reservedUsd > RESERVED_LIMIT_USD)
    throw new Error(
      `Refusing to start: reserved spend ${reservedUsd.toFixed(2)} USD is above ${RESERVED_LIMIT_USD} USD`,
    );
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');
  const client = new ApifyClient({ token });
  const options = {
    maxTotalChargeUsd: RUN_CAP_USD,
    memory: MEMORY_MBYTES,
    log: null,
    waitSecs: 900,
  };
  let totalCostUsd = 0;
  const results: unknown[] = [];

  for (const spec of searches) {
    const { keyword, params } = parseSearch(spec);

    console.error(`cheap_scraper: ${spec}`);
    const url = linkedinJobSearchUrl(keyword, params, ONE_DAY_SECONDS);
    const cheapRun = await client
      .actor(CHEAP_SCRAPER_ACTOR)
      .call(toLinkedinJobBoardInput(url, MAX_ITEMS), options);
    const cheapItems = (
      await client.dataset(cheapRun.defaultDatasetId).listItems()
    ).items as Item[];
    const totals = await client
      .keyValueStore(cheapRun.defaultKeyValueStoreId)
      .getRecord('SEARCH_TOTALS');
    const cheap: Side = {
      returned: cheapItems.length,
      total: cheapTotal(totals?.value),
      status: cheapRun.status,
      usageTotalUsd: cheapRun.usageTotalUsd ?? null,
      ids: cheapItems.map((i) => idOf(i.jobId)).filter((v) => v !== null),
      searchTotals: totals?.value ?? null,
    };

    console.error(`harvestapi: ${spec}`);
    const harvestRun = await client.actor(HARVEST_ACTOR).call(
      {
        ...toHarvestJobSearchInput(keyword, params, MAX_ITEMS),
        postedLimit: '24h',
      },
      options,
    );
    const harvestItems = (
      await client.dataset(harvestRun.defaultDatasetId).listItems()
    ).items as Item[];
    const meta = harvestItems[0]?._meta as
      | { pagination?: { totalElements?: unknown } }
      | undefined;
    const harvest: Side = {
      returned: harvestItems.length,
      total: numberOf(meta?.pagination?.totalElements),
      status: harvestRun.status,
      usageTotalUsd: harvestRun.usageTotalUsd ?? null,
      ids: harvestItems.map((i) => idOf(i.id)).filter((v) => v !== null),
    };

    totalCostUsd += (cheap.usageTotalUsd ?? 0) + (harvest.usageTotalUsd ?? 0);
    const cheapIds = new Set(cheap.ids);
    const harvestIds = new Set(harvest.ids);
    const strip = ({ ids: _ids, ...rest }: Side) => rest;
    results.push({
      search: spec,
      cheap: strip(cheap),
      harvest: strip(harvest),
      onlyCheap: [...cheapIds].filter((id) => !harvestIds.has(id)),
      onlyHarvest: [...harvestIds].filter((id) => !cheapIds.has(id)),
      shared: [...cheapIds].filter((id) => harvestIds.has(id)).length,
    });
  }

  console.log(JSON.stringify({ results, totalCostUsd }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

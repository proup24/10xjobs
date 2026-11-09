/**
 * The go/no-go live test of the shared LinkedIn search plan. It spends real
 * Apify money (every run is capped, and the whole script stops before passing
 * TOTAL_BUDGET_USD), so run it by hand and keep the output:
 *
 *   pnpm --filter @xjobs/xjobs apify:linkedin-plan-test > private/linkedin-plan-test.json
 *
 * Needs APIFY_TOKEN and the database variables (read-only). Prints one JSON
 * block per section: places, or, length, containment, ceiling, publishedAt.
 * Every run uses 1024 MB; a run that fails is reported as a memory failure.
 * The decisions (budget, OR forms, containment, publishedAt stats) are in
 * `linkedin-plan-test/logic.ts`.
 */
import '../environment';
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
  TOTAL_BUDGET_USD,
  containmentVerdict,
  createBudget,
  keywordOfLength,
  orForms,
  publishedAtStats,
  type DatedItem,
} from './linkedin-plan-test/logic';

const MEMORY_MBYTES = 1024;
const SEVEN_DAYS = 7 * 24 * 3600;
const FIXED_PARENTS = ['EMEA', 'Europe', 'LATAM', 'North Africa'];
const CONTAINMENT_KEYWORD = 'software engineer';
/** Caps per run, by rows asked (USD). */
const CAP_25 = 0.03;
const CAP_50 = 0.06;
const CAP_200 = 0.2;
const CAP_CEILING = 0.25;

type Item = Record<string, unknown>;

const budget = createBudget(TOTAL_BUDGET_USD);
const token = process.env.APIFY_TOKEN;
if (!token) throw new Error('APIFY_TOKEN is required');
const client = new ApifyClient({ token });
const actor = channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run.actor;
const allItems: Item[] = [];

interface RunResult {
  url: string;
  rows: number;
  ok: boolean;
  /** A failed run counts as a memory failure at MEMORY_MBYTES. */
  memoryFailure: boolean;
  status: string;
  costUsd: number | null;
  searchTotals: unknown;
  items: Item[];
  error?: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One capped run of one search; the budget refuses it before it starts. */
async function search(
  keyword: string,
  place: { location: string; geoId?: string },
  rows: number,
  maxTotalChargeUsd: number,
): Promise<RunResult> {
  budget.reserve(maxTotalChargeUsd);
  const url = linkedinJobSearchUrl(keyword, place, SEVEN_DAYS);
  try {
    const run = await client
      .actor(actor)
      .call(toLinkedinJobBoardInput(url, rows), {
        maxTotalChargeUsd,
        memory: MEMORY_MBYTES,
        waitSecs: 600,
      });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const totals = await client
      .keyValueStore(run.defaultKeyValueStoreId)
      .getRecord('SEARCH_TOTALS');
    const ok = run.status === 'SUCCEEDED';
    allItems.push(...(items as Item[]));
    return {
      url,
      rows,
      ok,
      memoryFailure: !ok,
      status: run.status,
      costUsd: run.usageTotalUsd ?? null,
      searchTotals: totals?.value ?? null,
      items: items as Item[],
    };
  } catch (error) {
    return {
      url,
      rows,
      ok: false,
      memoryFailure: true,
      status: 'ERROR',
      costUsd: null,
      searchTotals: null,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function geoPlace(location: string): { location: string; geoId?: string } {
  const geoId = LINKEDIN_GEO_IDS[location.toLowerCase()];
  return geoId ? { location, geoId } : { location };
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

function toDated(items: Item[]): DatedItem[] {
  return items.map((item) => ({
    id: String(item.jobId ?? item.jobUrl ?? ''),
    publishedAt: str(item.publishedAt),
  }));
}

async function main(): Promise<void> {
  const logger = new Logger('LinkedinPlanTest');
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    // 1. places
    const orm = db.orm.public;
    const builders = await orm.QuerySearchBuilder.where({
      channel: Channel.LINKEDIN_JOB_BOARD,
      isActive: true,
      isDeleted: false,
    }).all();
    const places = [...new Set(builders.map((b) => b.location))].sort();
    const types = [...new Set(builders.map((b) => b.type))].sort();
    emit('places', { places, types });

    // Containment candidates: place -> each region containing it (a city goes
    // through its country), plus the fixed wide regions.
    const regions = await orm.RegionTerm.all();
    const countries = await orm.Country.all();
    const cities = await orm.City.all();
    const links = await orm.RegionCountry.all();
    const regionByLabel = new Map(
      regions.map((r) => [r.label.toLowerCase(), r]),
    );
    const countryByLabel = new Map(
      countries.flatMap((c) => [
        [c.label.toLowerCase(), c] as const,
        [c.code.toLowerCase(), c] as const,
      ]),
    );
    const regionsOf = (countryCode: string) =>
      links
        .filter((l) => l.countryCode === countryCode)
        .map((l) => regions.find((r) => r.code === l.regionCode)?.label)
        .filter((label): label is string => !!label);
    const pairs = new Map<string, [string, string]>();
    const addPair = (child: string, parent: string) => {
      if (child.toLowerCase() !== parent.toLowerCase())
        pairs.set(`${child}|${parent}`.toLowerCase(), [child, parent]);
    };
    for (const place of places) {
      if (regionByLabel.has(place)) continue;
      const country = countryByLabel.get(place);
      const city = cities.find((c) => {
        const owner = countries.find((k) => k.code === c.countryCode);
        return owner && `${c.name}, ${owner.label}`.toLowerCase() === place;
      });
      const countryCode = country?.code ?? city?.countryCode;
      if (!countryCode) continue;
      if (city) {
        const owner = countries.find((k) => k.code === city.countryCode);
        if (owner) addPair(place, owner.label);
      }
      for (const parent of regionsOf(countryCode)) addPair(place, parent);
      for (const parent of FIXED_PARENTS) addPair(place, parent);
    }

    // 2. or
    const terms = ['nestjs', 'next js'];
    const forms = orForms(terms);
    const emea = geoPlace('EMEA');
    const orResults: Record<string, unknown> = {};
    for (const [name, keyword] of Object.entries(forms)) {
      const result = await search(keyword, emea, 25, CAP_25);
      orResults[name] = {
        keyword,
        ...summary(result),
        mentionsPerTerm: Object.fromEntries(
          terms.map((t) => [t, mentions(result.items, t)]),
        ),
      };
    }
    const singles: Record<string, unknown> = {};
    for (const term of terms) {
      const result = await search(term, emea, 25, CAP_25);
      singles[term] = {
        ...summary(result),
        mentions: mentions(result.items, term),
      };
    }
    emit('or', { forms: orResults, singles });

    // 3. length
    const lengths: Record<string, unknown> = {};
    for (const size of [100, 200, 400, 800]) {
      const keyword = keywordOfLength(size);
      const result = await search(keyword, emea, 25, CAP_25);
      lengths[String(size)] = {
        chars: keyword.length,
        keyword,
        ...summary(result),
      };
    }
    emit('length', { lengths });

    // 4. containment
    const containment: unknown[] = [];
    for (const [child, parent] of pairs.values()) {
      const childRun = await search(
        CONTAINMENT_KEYWORD,
        geoPlace(child),
        50,
        CAP_50,
      );
      let parentRun = await search(
        CONTAINMENT_KEYWORD,
        geoPlace(parent),
        50,
        CAP_50,
      );
      let verdict = containmentVerdict(
        toDated(childRun.items),
        toDated(parentRun.items),
      );
      let rerun = false;
      if (verdict.verdict === 'row-limit-cut') {
        rerun = true;
        parentRun = await search(
          CONTAINMENT_KEYWORD,
          geoPlace(parent),
          200,
          CAP_200,
        );
        verdict = containmentVerdict(
          toDated(childRun.items),
          toDated(parentRun.items),
        );
      }
      containment.push({
        child,
        parent,
        ...verdict,
        rerunParentAt200: rerun,
        childRun: summary(childRun),
        parentRun: summary(parentRun),
      });
    }
    emit('containment', { pairs: containment });

    // 5. ceiling
    const ceiling = await search('software engineer', emea, 1200, CAP_CEILING);
    emit('ceiling', {
      ...summary(ceiling),
      itemsReturned: ceiling.items.length,
    });

    // 6. publishedAt
    emit('publishedAt', publishedAtStats(allItems));
    emit('budget', { reservedUsd: budget.spent(), limitUsd: TOTAL_BUDGET_USD });
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

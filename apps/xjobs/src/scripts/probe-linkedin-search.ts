/**
 * Runs the LinkedIn job board actor once over the given search URLs and prints
 * what we need to tune collection: the `searchString` each search's items
 * carry (collection no longer reads it; LinkedIn may rewrite it), the fields
 * of a sample job and its company profile, and the cost. A paid run (capped at $0.05); run it by hand:
 *
 *   pnpm apify:probe-linkedin -- --url '<search url>' [--url …] [--rows 5] [--company-profile]
 *
 * Needs only APIFY_TOKEN. Uses the Apify client directly (tsx emits no
 * decorator metadata, so Nest injection is not available in scripts).
 */
import '../environment';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect/config';
import { Channel } from 'src/common/enums';
import { toLinkedinJobBoardInput } from 'src/modules/collectors/providers/mappers/cheap-scraper-input';

const MAX_CHARGE_USD = 0.05;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // pnpm forwards a literal `--` separator; both spellings work.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      url: { type: 'string', multiple: true },
      rows: { type: 'string', default: '5' },
      'company-profile': { type: 'boolean', default: false },
    },
  });
  const urls = values.url ?? [];
  if (urls.length === 0) throw new Error('Pass at least one --url');
  const rows = Number(values.rows);
  if (!Number.isInteger(rows) || rows < 1)
    throw new Error('--rows must be ≥ 1');
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');

  const actor = channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run.actor;
  const client = new ApifyClient({ token });
  const run = await client.actor(actor).call(
    {
      ...toLinkedinJobBoardInput(urls[0], rows * urls.length),
      // Collection runs one URL per run; the probe may compare several, and
      // the actor's only row limit is over the whole run.
      startUrls: urls.map((url) => ({ url })),
      enrichCompanyData: values['company-profile'],
    },
    { maxTotalChargeUsd: MAX_CHARGE_USD, waitSecs: 300 },
  );
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const totals = await client
    .keyValueStore(run.defaultKeyValueStoreId)
    .getRecord('SEARCH_TOTALS');
  const sample = record(items[0]);
  const perSearch: Record<string, number> = {};
  for (const item of items) {
    const search = String(record(item).searchString ?? '?');
    perSearch[search] = (perSearch[search] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        runId: run.id,
        status: run.status,
        costUsd: run.usageTotalUsd ?? null,
        searchTotals: totals?.value ?? null,
        itemsPerSearchString: perSearch,
        sampleItemKeys: Object.keys(sample).sort(),
        sampleCompany: Object.fromEntries(
          Object.entries(sample).filter(([key]) => /^company/i.test(key)),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

/**
 * Throwaway spike for slice 04 (search precision): live checks of LinkedIn
 * places and keywords on harvestapi/linkedin-job-search, before the
 * shared-searches planner is revised. It spends real Apify money, so run it by
 * hand and keep the output:
 *
 *   pnpm --filter @xjobs/xjobs apify:linkedin-region-test -- --dry-run
 *   pnpm --filter @xjobs/xjobs apify:linkedin-region-test > tmp/linkedin-region-test.json
 *
 * Sections:
 * - places: each containment place once (past 24 hours, newest first, capped
 *   at PLACE_ROWS rows), then every child > parent pair judged offline;
 *   LinkedIn job functions are tallied from the same jobs.
 * - multi: United States, Canada and Latin America in one run, then each
 *   alone: is the start fee charged once or per place, does `maxItems` apply
 *   per place, and does each job say which place found it?
 * - or: LinkedIn totals for single and OR'd keywords on EMEA over a week.
 * - keywords (only when asked): LinkedIn totals for each stack term, the
 *   stack OR'd, and the stack with an engineering role word (Europe, past
 *   week), then title samples of the two forms on Europe (past 24 hours) and
 *   Morocco (past week): what the role word cuts, and which engineering
 *   jobs it loses.
 * - countries (only when asked): the Middle East three times at once, and
 *   eight of its countries once each: are country searches steadier, and do
 *   they find what the region search misses?
 * - final (only with --campaign final): the last check before the planner is
 *   built, every run with its real filters (Europe remote mid-senior; Morocco
 *   hybrid and onsite, associate and mid-senior): (a) narrow vs extended role
 *   words AND the stack, sampled on both places; (b) each spelling of nodejs,
 *   nextjs and nestjs alone, then OR'd, as totals; (c) the dev keyword padded
 *   to 400, 800, 1,200 and 1,600 characters, as totals (an error or 0 marks
 *   the keyword length limit); (d) the dev profile's real searches over 24
 *   hours, as totals.
 * - control (only when asked): each CONTROL_PLACES search twice at the same
 *   time, judged against itself, to tell LinkedIn's own noise from real gaps;
 *   EU > Europe is judged again on the same runs.
 *
 * Money: every run carries an Apify charge cap (its start plus every row it
 * may return). A spend file per campaign (gitignored) sums real spend across
 * invocations, and an invocation refuses to start when that spend plus its
 * reserved caps would pass the campaign cap: `region` $2
 * (tmp/linkedin-region-test-spend.json), `final` $1
 * (tmp/linkedin-final-check-spend.json).
 *
 * Needs APIFY_TOKEN only. JSON goes to stdout, progress to stderr.
 *
 * Flags:
 *   --dry-run          print the plan and reserved spend; no Apify calls
 *   --sections a,b     places,multi,or,control,countries,keywords,final (default: places,multi,or)
 *   --campaign <name>  region (default) or final: picks the cap and spend file; the final section requires final
 *   --keyword <text>   containment and multi keyword (default: react)
 *   --concurrency <n>  runs at once (default 3; Apify's free plan has little memory)
 */
import '../environment';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ApifyClient } from 'apify-client';
import {
  CONTROL_PLACES,
  CONTROL_ROWS,
  CONTAINMENT_PLACES,
  MULTI_PLACES,
  MULTI_ROWS,
  OR_ROWS,
  PAIRS,
  PLACE_ROWS,
  type PlaceRun,
  type TestJob,
  DEV_KEYWORD,
  EXTENDED_ROLE_WORDS,
  FINAL_LENGTH_TARGETS,
  NARROW_ROLE_WORDS,
  andStack,
  campaignOf,
  finalKeywords,
  geoIdOf,
  jobFunctionStats,
  judgePair,
  ENGINEERING_TITLE,
  KEYWORD_SAMPLES,
  keywordTotals,
  orForms,
  orTerms,
  paddedKeyword,
  DEV_STACK_TERMS,
  runCapUsd,
} from './linkedin-region-test/logic';

const ACTOR = 'harvestapi/linkedin-job-search';
const MEMORY_MBYTES = 1024;
const SECTIONS = [
  'places',
  'multi',
  'or',
  'control',
  'countries',
  'keywords',
  'final',
] as const;

/** Region copies and per-country rows for the countries section. */
const REGION_COPIES = 3;
const REGION_ROWS = 80;
const COUNTRY_ROWS = 40;
const KEYWORD_SAMPLE_ROWS = 40;

/** The dev profile's searches as the planner will make them: real filters on every run. */
const FINAL_PLACES = {
  'europe remote': {
    geoIds: [geoIdOf('europe')],
    filters: { workplaceType: ['remote'], experienceLevel: ['mid-senior'] },
  },
  morocco: {
    geoIds: [geoIdOf('morocco')],
    filters: {
      workplaceType: ['hybrid', 'office'],
      experienceLevel: ['associate', 'mid-senior'],
    },
  },
} as const;
const FINAL_STACK_OR = orTerms(DEV_STACK_TERMS);
/**
 * Middle East countries, by geoId. Israel and Türkiye are not in
 * LINKEDIN_GEO_IDS: their ids are unverified, so their jobs' locations are
 * printed to check them.
 */
const MIDDLE_EAST_COUNTRIES: Record<string, string> = {
  'united arab emirates': geoIdOf('united arab emirates'),
  'saudi arabia': geoIdOf('saudi arabia'),
  qatar: geoIdOf('qatar'),
  kuwait: geoIdOf('kuwait'),
  bahrain: geoIdOf('bahrain'),
  oman: geoIdOf('oman'),
  israel: '101620260',
  turkiye: '102105699',
};
const DEFAULT_SECTIONS = 'places,multi,or';
type Section = (typeof SECTIONS)[number];

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; both spellings work.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    'dry-run': { type: 'boolean', default: false },
    sections: { type: 'string', default: DEFAULT_SECTIONS },
    keyword: { type: 'string', default: 'react' },
    concurrency: { type: 'string', default: '3' },
    campaign: { type: 'string', default: 'region' },
  },
});
if (values.campaign !== 'region' && values.campaign !== 'final')
  throw new Error('--campaign must be region or final');
const CAMPAIGN = campaignOf(values.campaign);
const SPEND_FILE = resolve(process.cwd(), CAMPAIGN.spendFile);

/** One Apify run the invocation will make. */
interface PlannedRun {
  section: Section;
  label: string;
  input: Record<string, unknown>;
  rows: number;
  places: number;
  capUsd: number;
}

interface RunOutcome {
  run: PlannedRun;
  ok: boolean;
  status: string;
  startedMs: number;
  items: Record<string, unknown>[];
  total: number | null;
  costUsd: number;
  chargedEventCounts: unknown;
  pricingInfo: unknown;
  error?: string;
}

function input(
  keyword: string,
  geoIds: string[],
  rows: number,
  postedLimit: '24h' | 'week',
  filters: Record<string, readonly string[]> = {},
) {
  return {
    jobTitles: [keyword],
    geoIds,
    postedLimit,
    sortBy: 'date',
    maxItems: rows,
    ...filters,
  };
}

function plan(sections: Section[], keyword: string): PlannedRun[] {
  const runs: PlannedRun[] = [];
  const add = (
    section: Section,
    label: string,
    geoIds: string[],
    rows: number,
    k: string,
    postedLimit: '24h' | 'week',
    filters: Record<string, readonly string[]> = {},
  ) =>
    runs.push({
      section,
      label,
      input: input(k, geoIds, rows, postedLimit, filters),
      rows,
      places: geoIds.length,
      capUsd: runCapUsd(rows, geoIds.length),
    });
  if (sections.includes('places'))
    for (const place of CONTAINMENT_PLACES)
      add('places', place, [geoIdOf(place)], PLACE_ROWS, keyword, '24h');
  if (sections.includes('multi')) {
    add(
      'multi',
      'together',
      MULTI_PLACES.map(geoIdOf),
      MULTI_ROWS,
      keyword,
      '24h',
    );
    for (const place of MULTI_PLACES)
      add('multi', place, [geoIdOf(place)], MULTI_ROWS, keyword, '24h');
  }
  // Copies sit next to each other, so with concurrency ≥ 2 they start together.
  // The region copies come first, so with concurrency ≥ 3 they start together.
  if (sections.includes('keywords')) {
    for (const form of keywordTotals())
      add(
        'keywords',
        `total:${form.name}`,
        [geoIdOf('europe')],
        OR_ROWS,
        form.keyword,
        'week',
      );
    for (const [place, postedLimit] of [
      ['europe', '24h'],
      ['morocco', 'week'],
    ] as const)
      for (const form of KEYWORD_SAMPLES)
        add(
          'keywords',
          `sample:${place}:${form.name}`,
          [geoIdOf(place)],
          KEYWORD_SAMPLE_ROWS,
          form.keyword,
          postedLimit,
        );
  }
  if (sections.includes('final')) {
    const europe = FINAL_PLACES['europe remote'];
    // (a) role words, sampled on both places.
    for (const [place, { geoIds, filters }] of Object.entries(FINAL_PLACES))
      for (const [name, roles] of [
        ['narrow', NARROW_ROLE_WORDS],
        ['extended', EXTENDED_ROLE_WORDS],
      ] as const)
        add(
          'final',
          `roles:${place}:${name}`,
          [...geoIds],
          KEYWORD_SAMPLE_ROWS,
          andStack(roles, FINAL_STACK_OR),
          '24h',
          filters,
        );
    // (b) spellings, as week totals on Europe remote.
    for (const form of finalKeywords())
      add(
        'final',
        form.name,
        [...europe.geoIds],
        OR_ROWS,
        form.keyword,
        'week',
        europe.filters,
      );
    // (c) keyword length limit.
    for (const target of FINAL_LENGTH_TARGETS)
      add(
        'final',
        `length:${target}`,
        [...europe.geoIds],
        OR_ROWS,
        paddedKeyword(target),
        'week',
        europe.filters,
      );
    // (d) the dev profile's real searches over 24 hours.
    for (const [place, { geoIds, filters }] of Object.entries(FINAL_PLACES))
      add(
        'final',
        `volume:${place}`,
        [...geoIds],
        OR_ROWS,
        DEV_KEYWORD,
        '24h',
        filters,
      );
  }
  if (sections.includes('countries')) {
    for (let copy = 1; copy <= REGION_COPIES; copy++)
      add(
        'countries',
        `middle east#${copy}`,
        [geoIdOf('middle east')],
        REGION_ROWS,
        keyword,
        '24h',
      );
    for (const [country, geoId] of Object.entries(MIDDLE_EAST_COUNTRIES))
      add('countries', country, [geoId], COUNTRY_ROWS, keyword, '24h');
  }
  if (sections.includes('control'))
    for (const place of CONTROL_PLACES)
      for (const copy of [1, 2])
        add(
          'control',
          `${place}#${copy}`,
          [geoIdOf(place)],
          CONTROL_ROWS,
          keyword,
          '24h',
        );
  if (sections.includes('or'))
    for (const form of orForms())
      add('or', form.name, [geoIdOf('emea')], OR_ROWS, form.keyword, 'week');
  return runs;
}

interface SpendFile {
  spentUsd: number;
  runs: { at: string; label: string; costUsd: number; apifyRunId?: string }[];
}

function readSpend(): SpendFile {
  if (!existsSync(SPEND_FILE)) return { spentUsd: 0, runs: [] };
  return JSON.parse(readFileSync(SPEND_FILE, 'utf8')) as SpendFile;
}

function recordSpend(
  spend: SpendFile,
  label: string,
  costUsd: number,
  apifyRunId?: string,
) {
  spend.spentUsd += costUsd;
  spend.runs.push({ at: new Date().toISOString(), label, costUsd, apifyRunId });
  mkdirSync(dirname(SPEND_FILE), { recursive: true });
  writeFileSync(SPEND_FILE, JSON.stringify(spend, null, 2));
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => {
        if (typeof x === 'string') return [x];
        const name = str((x as { name?: unknown } | null)?.name);
        return name ? [name] : [];
      })
    : [];

function toJob(item: Record<string, unknown>): TestJob | null {
  const id = item.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const posted = str(item.postedDate);
  const postedMs = posted ? Date.parse(posted) : NaN;
  const location = item.location as { linkedinText?: unknown } | undefined;
  const company = item.company as { industries?: unknown } | undefined;
  return {
    id: String(id),
    postedMs: Number.isFinite(postedMs) ? postedMs : null,
    title: str(item.title) ?? '',
    location: str(location?.linkedinText),
    jobFunctions: strings(item.jobFunctions),
    industries: strings(company?.industries ?? item.industries),
    query: item.query ?? null,
  };
}

function totalOf(items: Record<string, unknown>[]): number | null {
  const meta = items[0]?._meta as
    | { pagination?: { totalElements?: unknown } }
    | undefined;
  const total = meta?.pagination?.totalElements;
  return typeof total === 'number' ? total : null;
}

async function execute(
  client: ApifyClient,
  run: PlannedRun,
  spend: SpendFile,
): Promise<RunOutcome> {
  console.error(
    `start ${run.section}:${run.label} (cap $${run.capUsd.toFixed(3)})`,
  );
  const startedMs = Date.now();
  try {
    const started = await client.actor(ACTOR).start(run.input, {
      maxTotalChargeUsd: run.capUsd,
      memory: MEMORY_MBYTES,
    });
    const finished = await client
      .run(started.id)
      .waitForFinish({ waitSecs: 900 });
    const items = (await client.dataset(finished.defaultDatasetId).listItems())
      .items as Record<string, unknown>[];
    // A run with no reported cost counts at its cap.
    const costUsd = finished.usageTotalUsd ?? run.capUsd;
    recordSpend(spend, `${run.section}:${run.label}`, costUsd, finished.id);
    console.error(
      `done  ${run.section}:${run.label} ${finished.status} ${items.length} items $${costUsd.toFixed(4)}`,
    );
    return {
      run,
      ok: finished.status === 'SUCCEEDED',
      status: finished.status,
      startedMs: finished.startedAt
        ? new Date(finished.startedAt).getTime()
        : startedMs,
      items,
      total: totalOf(items),
      costUsd,
      chargedEventCounts: finished.chargedEventCounts ?? null,
      pricingInfo: finished.pricingInfo ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Unknown whether it charged: count the cap so the budget stays safe.
    recordSpend(spend, `${run.section}:${run.label} (error)`, run.capUsd);
    console.error(`fail  ${run.section}:${run.label} ${message}`);
    return {
      run,
      ok: false,
      status: 'ERROR',
      startedMs,
      items: [],
      total: null,
      costUsd: run.capUsd,
      chargedEventCounts: null,
      pricingInfo: null,
      error: message,
    };
  }
}

/** Runs with at most `limit` in flight, results in plan order. */
async function runAll(
  client: ApifyClient,
  runs: PlannedRun[],
  spend: SpendFile,
  limit: number,
): Promise<RunOutcome[]> {
  const results: RunOutcome[] = new Array(runs.length);
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const i = next++;
      results[i] = await execute(client, runs[i], spend);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, runs.length) }, worker),
  );
  return results;
}

function summary(o: RunOutcome) {
  return {
    label: o.run.label,
    status: o.status,
    returned: o.items.length,
    rows: o.run.rows,
    places: o.run.places,
    total: o.total,
    costUsd: o.costUsd,
    chargedEventCounts: o.chargedEventCounts,
    ...(o.error ? { error: o.error } : {}),
  };
}

function placesReport(outcomes: RunOutcome[]) {
  const runs = new Map<string, PlaceRun>(
    outcomes.map((o) => [
      o.run.label,
      {
        place: o.run.label,
        ok: o.ok,
        startedMs: o.startedMs,
        rows: o.run.rows,
        jobs: o.items.map(toJob).filter((j): j is TestJob => j !== null),
        total: o.total,
      },
    ]),
  );
  const pairs = PAIRS.map(([child, parent]) => {
    const c = runs.get(child);
    const p = runs.get(parent);
    if (!c || !p) throw new Error(`Pair ${child} > ${parent} has no run`);
    return judgePair(c, p);
  });
  const allJobs = [...runs.values()].flatMap((r) => r.jobs);
  return {
    runs: outcomes.map(summary),
    pairs,
    jobFunctions: jobFunctionStats(allJobs),
    jobs: Object.fromEntries(
      [...runs].map(([place, r]) => [
        place,
        r.jobs.map((j) => ({
          ...j,
          posted:
            j.postedMs === null ? null : new Date(j.postedMs).toISOString(),
        })),
      ]),
    ),
  };
}

function multiReport(outcomes: RunOutcome[]) {
  const together = outcomes.find((o) => o.run.label === 'together');
  const alone = outcomes.filter((o) => o.run.label !== 'together');
  const ids = (o: RunOutcome | undefined) =>
    new Set((o?.items ?? []).map(toJob).flatMap((j) => (j ? [j.id] : [])));
  const togetherIds = ids(together);
  // Which place each job of the combined run says found it.
  const queries = new Map<string, number>();
  for (const item of together?.items ?? []) {
    const key = JSON.stringify(item.query ?? null);
    queries.set(key, (queries.get(key) ?? 0) + 1);
  }
  return {
    runs: outcomes.map(summary),
    together: {
      returned: together?.items.length ?? 0,
      maxIfPerPlace: MULTI_ROWS * MULTI_PLACES.length,
      queryValues: Object.fromEntries(queries),
      pricingInfo: together?.pricingInfo ?? null,
    },
    alone: alone.map((o) => {
      const own = ids(o);
      return {
        place: o.run.label,
        returned: own.size,
        alsoInTogether: [...own].filter((id) => togetherIds.has(id)).length,
      };
    }),
  };
}

function controlReport(outcomes: RunOutcome[]) {
  const runs = new Map<string, PlaceRun>(
    outcomes.map((o) => [
      o.run.label,
      {
        place: o.run.label,
        ok: o.ok,
        startedMs: o.startedMs,
        rows: o.run.rows,
        jobs: o.items.map(toJob).filter((j): j is TestJob => j !== null),
        total: o.total,
      },
    ]),
  );
  const get = (label: string) => {
    const run = runs.get(label);
    if (!run) throw new Error(`Control has no run ${label}`);
    return run;
  };
  const brief = (r: ReturnType<typeof judgePair>) => ({
    child: r.child,
    parent: r.parent,
    verdict: r.verdict,
    compared: r.compared,
    missing: r.missing.length,
    missingShare: r.compared
      ? Number((r.missing.length / r.compared).toFixed(3))
      : null,
    childTotal: r.childTotal,
    parentTotal: r.parentTotal,
    missingJobs: r.missing,
  });
  return {
    runs: outcomes.map(summary),
    // The same search against itself, both ways: what LinkedIn alone drops.
    self: CONTROL_PLACES.flatMap((place) => [
      brief(judgePair(get(`${place}#1`), get(`${place}#2`))),
      brief(judgePair(get(`${place}#2`), get(`${place}#1`))),
    ]),
    pairs: [
      ['european union', 'europe'],
      ['africa', 'europe'],
      ['middle east', 'europe'],
    ].flatMap(([child, parent]) =>
      [1, 2].map((copy) =>
        brief(judgePair(get(`${child}#${copy}`), get(`${parent}#${copy}`))),
      ),
    ),
  };
}

function countriesReport(outcomes: RunOutcome[]) {
  const jobsOf = (o: RunOutcome) =>
    o.items.map(toJob).filter((j): j is TestJob => j !== null);
  const copies = outcomes.filter((o) => o.run.label.startsWith('middle east#'));
  const countries = outcomes.filter(
    (o) => !o.run.label.startsWith('middle east#'),
  );
  const region = new Map<string, TestJob>();
  for (const o of copies) for (const j of jobsOf(o)) region.set(j.id, j);
  const country = new Map<string, TestJob>();
  for (const o of countries) for (const j of jobsOf(o)) country.set(j.id, j);
  const ids = (o: RunOutcome) => new Set(jobsOf(o).map((j) => j.id));
  const copyIds = copies.map(ids);
  // What each copy found that no earlier copy had: the gain of one more repeat.
  const seen = new Set<string>();
  const gainPerCopy = copyIds.map((own) => {
    const added = [...own].filter((id) => !seen.has(id)).length;
    for (const id of own) seen.add(id);
    return added;
  });
  const count = (jobs: TestJob[]) => {
    const tally = new Map<string, number>();
    for (const j of jobs)
      tally.set(
        j.location ?? '(none)',
        (tally.get(j.location ?? '(none)') ?? 0) + 1,
      );
    return Object.fromEntries([...tally].sort((a, b) => b[1] - a[1]));
  };
  // Over the span every run fully saw, so a capped run doesn't look like a miss.
  const floor = Math.max(
    ...outcomes.flatMap((o) => {
      if (o.items.length < o.run.rows) return [];
      const times = jobsOf(o).flatMap((j) =>
        j.postedMs === null ? [] : [j.postedMs],
      );
      return times.length ? [Math.min(...times)] : [];
    }),
    Math.max(...outcomes.map((o) => o.startedMs)) -
      24 * 3600 * 1000 +
      30 * 60 * 1000,
  );
  const to = Math.min(...outcomes.map((o) => o.startedMs));
  const inSpan = (j: TestJob) =>
    j.postedMs !== null && j.postedMs >= floor && j.postedMs < to;
  const regionSpan = [...region.values()].filter(inSpan);
  const countrySpan = [...country.values()].filter(inSpan);
  const regionIds = new Set(regionSpan.map((j) => j.id));
  const countryIds = new Set(countrySpan.map((j) => j.id));
  return {
    runs: outcomes.map(summary),
    span: {
      from: new Date(floor).toISOString(),
      to: new Date(to).toISOString(),
    },
    regionCopies: copies.map((o, i) => ({
      label: o.run.label,
      returned: o.items.length,
      total: o.total,
      newVsEarlierCopies: gainPerCopy[i],
    })),
    regionUnion: region.size,
    countryUnion: country.size,
    inSpan: {
      regionUnion: regionSpan.length,
      countryUnion: countrySpan.length,
      both: regionSpan.filter((j) => countryIds.has(j.id)).length,
      onlyCountries: countrySpan.filter((j) => !regionIds.has(j.id)).length,
      onlyRegion: regionSpan.filter((j) => !countryIds.has(j.id)).length,
      onlyRegionLocations: count(
        regionSpan.filter((j) => !countryIds.has(j.id)),
      ),
      onlyCountriesLocations: count(
        countrySpan.filter((j) => !regionIds.has(j.id)),
      ),
    },
    perCountry: countries.map((o) => {
      const own = jobsOf(o);
      return {
        country: o.run.label,
        geoId: (o.run.input.geoIds as string[])[0],
        returned: own.length,
        total: o.total,
        inRegionUnion: own.filter((j) => region.has(j.id)).length,
        locations: count(own),
      };
    }),
  };
}

const jobsOf = (o: RunOutcome) =>
  o.items.map(toJob).filter((j): j is TestJob => j !== null);

const asRun = (o: RunOutcome): PlaceRun => ({
  place: o.run.label,
  ok: o.ok,
  startedMs: o.startedMs,
  rows: o.run.rows,
  jobs: jobsOf(o),
  total: o.total,
});

/** Engineering-titled jobs of `wide` that `narrow` should hold but doesn't. */
function engineeringLost(wide: RunOutcome, narrow: RunOutcome) {
  const wideRun = asRun(wide);
  // The wide run keeps its full row count, so its cap floor stays honest.
  return judgePair(
    {
      ...wideRun,
      jobs: wideRun.jobs.filter((j) => ENGINEERING_TITLE.test(j.title)),
      rows: wideRun.jobs.length < wide.run.rows ? Infinity : 0,
    },
    asRun(narrow),
  );
}

function describeTitles(o: RunOutcome) {
  const jobs = jobsOf(o);
  return {
    status: o.status,
    returned: jobs.length,
    total: o.total,
    engineeringTitles: jobs.filter((j) => ENGINEERING_TITLE.test(j.title))
      .length,
    otherTitles: jobs
      .filter((j) => !ENGINEERING_TITLE.test(j.title))
      .map((j) => j.title),
  };
}

function finalReport(outcomes: RunOutcome[]) {
  const find = (label: string) => outcomes.find((o) => o.run.label === label);
  const total = (o: RunOutcome) => ({
    label: o.run.label,
    keyword: (o.run.input.jobTitles as string[])[0],
    keywordLength: (o.run.input.jobTitles as string[])[0].length,
    status: o.status,
    total: o.total,
    returned: o.items.length,
    ...(o.error ? { error: o.error } : {}),
  });
  const roles = Object.keys(FINAL_PLACES).map((place) => {
    const narrow = find(`roles:${place}:narrow`);
    const extended = find(`roles:${place}:extended`);
    if (!narrow || !extended) return { place, error: 'missing run' };
    const lost = engineeringLost(extended, narrow);
    return {
      place,
      narrow: describeTitles(narrow),
      extended: describeTitles(extended),
      // Engineering titles the extended form finds that the narrow one loses.
      engineeringJobsLostByNarrow: {
        verdict: lost.verdict,
        compared: lost.compared,
        missing: lost.missing,
        window: lost.window,
      },
    };
  });
  const group = (prefix: string) =>
    outcomes.filter((o) => o.run.label.startsWith(prefix)).map(total);
  return {
    runs: outcomes.map(summary),
    roles,
    spellings: [...group('spelling:'), ...group('spellings:')],
    // A run that errors or returns 0 marks the length limit.
    lengths: group('length:'),
    volume: group('volume:'),
  };
}

function keywordsReport(outcomes: RunOutcome[]) {
  const totals = outcomes
    .filter((o) => o.run.label.startsWith('total:'))
    .map((o) => ({
      form: o.run.label.slice('total:'.length),
      keyword: (o.run.input.jobTitles as string[])[0],
      status: o.status,
      total: o.total,
      sampleTitles: o.items.slice(0, OR_ROWS).map((i) => str(i.title)),
      ...(o.error ? { error: o.error } : {}),
    }));
  const sample = (label: string) => outcomes.find((o) => o.run.label === label);
  const samples = ['europe', 'morocco'].map((place) => {
    const stack = sample(`sample:${place}:stack`);
    const role = sample(`sample:${place}:role AND stack`);
    if (!stack || !role) return { place, error: 'missing run' };
    // Lost recall: engineering-titled stack jobs the role form should hold but doesn't.
    // The child keeps its full row count, so its cap floor stays honest.
    const lost = engineeringLost(stack, role);
    return {
      place,
      stack: describeTitles(stack),
      roleAndStack: describeTitles(role),
      engineeringJobsLost: {
        verdict: lost.verdict,
        compared: lost.compared,
        missing: lost.missing,
        window: lost.window,
      },
    };
  });
  return { runs: outcomes.map(summary), totals, samples };
}

function orReport(outcomes: RunOutcome[]) {
  const forms = new Map(orForms().map((f) => [f.name, f.keyword]));
  return outcomes.map((o) => ({
    ...summary(o),
    keyword: forms.get(o.run.label),
    keywordLength: forms.get(o.run.label)?.length,
    sampleTitles: o.items.slice(0, OR_ROWS).map((i) => str(i.title)),
  }));
}

async function main(): Promise<void> {
  const sections = values.sections
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Section[];
  for (const s of sections)
    if (!SECTIONS.includes(s)) throw new Error(`Unknown section "${s}"`);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('--concurrency must be ≥ 1');

  if (sections.includes('final') && values.campaign !== 'final')
    throw new Error('The final section requires --campaign final');
  const runs = plan(sections, values.keyword);
  const reservedUsd = runs.reduce((sum, r) => sum + r.capUsd, 0);
  const spend = readSpend();
  const budget = {
    campaign: values.campaign,
    campaignUsd: CAMPAIGN.capUsd,
    alreadySpentUsd: spend.spentUsd,
    reservedThisInvocationUsd: Number(reservedUsd.toFixed(4)),
    fits: spend.spentUsd + reservedUsd <= CAMPAIGN.capUsd,
  };
  const planned = runs.map((r) => ({
    section: r.section,
    label: r.label,
    keyword: (r.input.jobTitles as string[])[0],
    geoIds: r.input.geoIds,
    postedLimit: r.input.postedLimit,
    filters: {
      workplaceType: r.input.workplaceType,
      experienceLevel: r.input.experienceLevel,
    },
    rows: r.rows,
    capUsd: Number(r.capUsd.toFixed(4)),
  }));

  if (values['dry-run']) {
    console.log(
      JSON.stringify({ plan: planned, pairs: PAIRS, budget }, null, 2),
    );
    return;
  }
  if (!budget.fits)
    throw new Error(
      `Refusing to start: $${spend.spentUsd.toFixed(3)} spent + $${reservedUsd.toFixed(3)} reserved passes the $${CAMPAIGN.capUsd} campaign cap (${SPEND_FILE})`,
    );
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');
  const client = new ApifyClient({ token });

  const outcomes = await runAll(client, runs, spend, concurrency);
  const of = (s: Section) => outcomes.filter((o) => o.run.section === s);
  const report: Record<string, unknown> = {
    keyword: values.keyword,
    plan: planned,
  };
  if (sections.includes('places')) report.places = placesReport(of('places'));
  if (sections.includes('multi')) report.multi = multiReport(of('multi'));
  if (sections.includes('or')) report.or = orReport(of('or'));
  if (sections.includes('keywords'))
    report.keywords = keywordsReport(of('keywords'));
  if (sections.includes('final')) report.final = finalReport(of('final'));
  if (sections.includes('countries'))
    report.countries = countriesReport(of('countries'));
  if (sections.includes('control'))
    report.control = controlReport(of('control'));
  report.spend = {
    thisInvocationUsd: Number(
      outcomes.reduce((s, o) => s + o.costUsd, 0).toFixed(4),
    ),
    campaignTotalUsd: Number(spend.spentUsd.toFixed(4)),
    campaignCapUsd: CAMPAIGN.capUsd,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

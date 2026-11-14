/**
 * Pure decisions of the LinkedIn region test (`linkedin-region-test.ts`):
 * which places and pairs run, what is reserved, and how a pair is judged.
 * Throwaway spike for slice 04 (search precision); no product code reads it.
 */
import { LINKEDIN_GEO_IDS } from 'src/modules/queries/channels/linkedin_geo';

/** Hard cap over every invocation together, real spend plus what a run may still charge. */
export const CAMPAIGN_BUDGET_USD = 2;
/** harvestapi pay-per-event prices (spec 2026-11-11): per job and per run start. */
export const PRICE_PER_JOB_USD = 0.001;
export const PRICE_PER_START_USD = 0.001;
/** Margin added to each run's charge cap so a run that returns exactly its rows is not cut. */
export const RUN_CAP_MARGIN_USD = 0.005;

/** Rows each containment place returns: the row cap per request. */
export const PLACE_ROWS = 150;
/** Rows per place in the several-places probe. */
export const MULTI_ROWS = 15;
/** Rows per OR-syntax run; only LinkedIn's total is read. */
export const OR_ROWS = 3;
/** Rows per control copy: the same search run twice at once, to measure LinkedIn's own noise. */
export const CONTROL_ROWS = 100;
/** The places whose misses the control calibrates, each searched twice at the same time. */
export const CONTROL_PLACES = [
  'european union',
  'europe',
  'middle east',
  'africa',
] as const;
/** A pair compared on fewer child jobs than this is inconclusive. */
export const MIN_COMPARED = 5;
/** Child jobs this close to the 24-hour edge may age out between runs. */
export const EDGE_MARGIN_MS = 30 * 60 * 1000;

/** Every place the containment pairs need, by its `LINKEDIN_GEO_IDS` key. North Africa is Africa's geoId. */
export const CONTAINMENT_PLACES = [
  'morocco',
  'africa',
  'middle east',
  'mena',
  'emea',
  'united kingdom',
  'european union',
  'european economic area',
  'europe',
] as const;

/** child > parent, each tested directly; a pass never carries through a chain. */
export const PAIRS: readonly (readonly [string, string])[] = [
  ['morocco', 'africa'],
  ['morocco', 'mena'],
  ['morocco', 'emea'],
  ['africa', 'emea'],
  ['middle east', 'mena'],
  ['middle east', 'emea'],
  ['mena', 'emea'],
  ['united kingdom', 'europe'],
  ['united kingdom', 'emea'],
  ['european union', 'european economic area'],
  ['european union', 'europe'],
  ['european union', 'emea'],
  ['european economic area', 'europe'],
  ['european economic area', 'emea'],
  ['europe', 'emea'],
];

/** The places with no parent we search: probed together in one run, then alone. */
export const MULTI_PLACES = [
  'united states',
  'canada',
  'latin america',
] as const;

/** The profile's stack as LinkedIn terms; multi-word terms are where OR syntax can break. */
export const STACK_TERMS = [
  'typescript',
  'node js',
  'react',
  'react native',
  'next js',
  'nestjs',
  'aws',
  'postgresql',
];

/** Keyword forms whose LinkedIn totals answer: does OR work, and how must multi-word terms be written. */
export function orForms(): { name: string; keyword: string }[] {
  const quoted = (t: string) => (t.includes(' ') ? `"${t}"` : t);
  return [
    { name: 'single:nestjs', keyword: 'nestjs' },
    { name: 'single:next js', keyword: 'next js' },
    { name: 'single:"next js"', keyword: '"next js"' },
    { name: 'or:bare', keyword: 'nestjs OR next js' },
    { name: 'or:quoted', keyword: 'nestjs OR "next js"' },
    { name: 'or:parens', keyword: '(nestjs) OR ("next js")' },
    { name: 'or:lowercase', keyword: 'nestjs or "next js"' },
    { name: 'or:stack', keyword: STACK_TERMS.map(quoted).join(' OR ') },
  ];
}

export function geoIdOf(place: string): string {
  const id = LINKEDIN_GEO_IDS[place];
  if (!id) throw new Error(`No geoId for "${place}" in LINKEDIN_GEO_IDS`);
  return id;
}

/** What a run may charge at most: its start plus every row it may return, plus the margin. */
export function runCapUsd(rows: number, places = 1): number {
  return (
    PRICE_PER_START_USD + rows * places * PRICE_PER_JOB_USD + RUN_CAP_MARGIN_USD
  );
}

/** One job as the test keeps it. */
export interface TestJob {
  id: string;
  postedMs: number | null;
  title: string;
  location: string | null;
  jobFunctions: string[];
  industries: string[];
  query: unknown;
}

/** One finished place run, as the containment judgement reads it. */
export interface PlaceRun {
  place: string;
  ok: boolean;
  startedMs: number;
  rows: number;
  jobs: TestJob[];
  total: number | null;
}

export type Verdict = 'pass' | 'fail' | 'too-few' | 'invalid';

export interface PairResult {
  child: string;
  parent: string;
  verdict: Verdict;
  /** Child jobs inside the span both runs fully saw. */
  compared: number;
  missing: {
    id: string;
    title: string;
    location: string | null;
    posted: string | null;
  }[];
  childTotal: number | null;
  parentTotal: number | null;
  /** LinkedIn's totals agree with containment: the child's is not above the parent's. */
  totalsConsistent: boolean | null;
  window: { from: string | null; to: string };
}

/** Oldest posted time of a run that hit its row cap: below it, the run saw nothing. */
function floorOf(run: PlaceRun): number | null {
  if (run.jobs.length < run.rows) return null;
  const times = run.jobs.flatMap((j) =>
    j.postedMs === null ? [] : [j.postedMs],
  );
  return times.length ? Math.min(...times) : null;
}

/**
 * Is every child job the parent should hold in the parent's results? Only child
 * jobs posted inside the span both runs fully saw are compared:
 * - after the later 24-hour edge (plus a margin, jobs age out between runs);
 * - after the oldest job of each run that hit its row cap;
 * - before the earlier run started (later jobs may be newer than one run).
 */
export function judgePair(child: PlaceRun, parent: PlaceRun): PairResult {
  const to = Math.min(child.startedMs, parent.startedMs);
  const edge =
    Math.max(child.startedMs, parent.startedMs) -
    24 * 3600 * 1000 +
    EDGE_MARGIN_MS;
  const floors = [edge, floorOf(child), floorOf(parent)].filter(
    (v): v is number => v !== null,
  );
  const from = Math.max(...floors);
  const base = {
    child: child.place,
    parent: parent.place,
    childTotal: child.total,
    parentTotal: parent.total,
    totalsConsistent:
      child.total === null || parent.total === null
        ? null
        : child.total <= parent.total,
    window: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
  };
  if (!child.ok || !parent.ok || child.jobs.length === 0)
    return { ...base, verdict: 'invalid', compared: 0, missing: [] };
  const parentIds = new Set(parent.jobs.map((j) => j.id));
  const inSpan = child.jobs.filter(
    (j) => j.postedMs !== null && j.postedMs >= from && j.postedMs < to,
  );
  const missing = inSpan
    .filter((j) => !parentIds.has(j.id))
    .map((j) => ({
      id: j.id,
      title: j.title,
      location: j.location,
      posted: j.postedMs === null ? null : new Date(j.postedMs).toISOString(),
    }));
  const verdict: Verdict =
    inSpan.length < MIN_COMPARED ? 'too-few' : missing.length ? 'fail' : 'pass';
  return { ...base, verdict, compared: inSpan.length, missing };
}

export const ENGINEERING_TITLE =
  /(engineer|developer|d[ée]velopp|ing[ée]nieur|programm|software|logiciel|\bsre\b|devops|architect|full.?stack|back.?end|front.?end|tech lead|\bcto\b|mobile|\bios\b|android)/i;

/** How LinkedIn's job functions line up with engineering titles: what a `functionIds: [eng, it]` filter would keep. */
export function jobFunctionStats(jobs: readonly TestJob[]) {
  const unique = [...new Map(jobs.map((j) => [j.id, j])).values()];
  const engFn = (j: TestJob) =>
    j.jobFunctions.some((f) => f === 'ENG' || f === 'IT');
  const engTitle = (j: TestJob) => ENGINEERING_TITLE.test(j.title);
  const count = (p: (j: TestJob) => boolean) => unique.filter(p).length;
  const functions = new Map<string, number>();
  for (const j of unique)
    for (const f of j.jobFunctions.length ? j.jobFunctions : ['(none)'])
      functions.set(f, (functions.get(f) ?? 0) + 1);
  return {
    jobs: unique.length,
    engineeringTitle: count(engTitle),
    engOrItFunction: count(engFn),
    engineeringTitleWithoutEngOrIt: count((j) => engTitle(j) && !engFn(j)),
    engOrItWithoutEngineeringTitle: count((j) => engFn(j) && !engTitle(j)),
    functions: Object.fromEntries([...functions].sort((a, b) => b[1] - a[1])),
    /** For reading by hand: engineering titles a functionIds filter would drop. */
    wouldLose: unique
      .filter((j) => engTitle(j) && !engFn(j))
      .map((j) => ({
        title: j.title,
        functions: j.jobFunctions,
        industries: j.industries,
      })),
  };
}

/** Engineering role words, English and French, for the keyword check. */
export const ROLE_WORDS = [
  'engineer',
  'developer',
  'ingénieur',
  'développeur',
  'programmer',
  '"tech lead"',
];

const quote = (t: string) => (t.includes(' ') ? `"${t}"` : t);
export const STACK_OR = STACK_TERMS.map(quote).join(' OR ');
export const ROLE_OR = ROLE_WORDS.join(' OR ');

/** Totals-only keyword forms: which terms flood, whether AND and accents parse. */
export function keywordTotals(): { name: string; keyword: string }[] {
  return [
    ...STACK_TERMS.map((t) => ({ name: `term:${t}`, keyword: quote(t) })),
    { name: 'stack', keyword: STACK_OR },
    { name: 'role', keyword: ROLE_OR },
    { name: 'role AND stack', keyword: `(${ROLE_OR}) AND (${STACK_OR})` },
    { name: 'role stack (no AND)', keyword: `(${ROLE_OR}) (${STACK_OR})` },
    { name: 'accent:développeur', keyword: 'développeur' },
    { name: 'accent:developpeur', keyword: 'developpeur' },
  ];
}

/** Sampled forms: titles are read to judge what the role word cuts. */
export const KEYWORD_SAMPLES = [
  { name: 'stack', keyword: STACK_OR },
  { name: 'role AND stack', keyword: `(${ROLE_OR}) AND (${STACK_OR})` },
];

/** The two keyword-check campaigns: each has its own cap and spend file, so the final check does not draw on the region test's budget. */
export function campaignOf(name: 'region' | 'final'): {
  capUsd: number;
  spendFile: string;
} {
  return name === 'final'
    ? { capUsd: 1, spendFile: 'tmp/linkedin-final-check-spend.json' }
    : {
        capUsd: CAMPAIGN_BUDGET_USD,
        spendFile: 'tmp/linkedin-region-test-spend.json',
      };
}

/** Today's role list against a wider one: the final check measures what the extra words recover. */
export const NARROW_ROLE_WORDS = ROLE_WORDS;
export const EXTENDED_ROLE_WORDS = [
  'engineer',
  'developer',
  'engineering',
  'architect',
  'ingénieur',
  'développeur',
  'architecte',
  'programmer',
  '"tech lead"',
  '"technical lead"',
  'devops',
  'sre',
];

/** Candidate spellings per technology, as a person or a posting may write them. */
export const FINAL_SPELLINGS: Record<string, string[]> = {
  nodejs: ['nodejs', 'node.js', 'node js'],
  nextjs: ['nextjs', 'next.js', 'next js'],
  nestjs: ['nestjs', 'nest.js'],
};

/** Terms with a space or a `.`, `#`, `+` are quoted. */
export const quoteTerm = (t: string): string =>
  /[\s.#+]/.test(t) ? `"${t}"` : t;

/** Lowercased, deduped and sorted terms, quoted where needed, OR'd. */
export function orTerms(terms: readonly string[]): string {
  return [...new Set(terms.map((t) => t.toLowerCase()))]
    .sort()
    .map(quoteTerm)
    .join(' OR ');
}

/** The dev profile's stack with every candidate spelling: the stack half of a run. */
export const DEV_STACK_TERMS = [
  'typescript',
  'react',
  'react native',
  'aws',
  'postgresql',
  ...Object.values(FINAL_SPELLINGS).flat(),
];

export const andStack = (roles: readonly string[], stack: string): string =>
  `(${roles.join(' OR ')}) AND (${stack})`;

/** The dev profile's full keyword: extended role words AND every stack spelling. */
export const DEV_KEYWORD = andStack(
  EXTENDED_ROLE_WORDS,
  orTerms(DEV_STACK_TERMS),
);

/** Totals-only forms of (b): each spelling alone, then each technology's spellings OR'd. */
export function finalKeywords(): { name: string; keyword: string }[] {
  return [
    ...Object.values(FINAL_SPELLINGS).flatMap((spellings) =>
      spellings.map((t) => ({
        name: `spelling:${quoteTerm(t)}`,
        keyword: quoteTerm(t),
      })),
    ),
    ...Object.entries(FINAL_SPELLINGS).map(([tech, spellings]) => ({
      name: `spellings:${tech}`,
      keyword: orTerms(spellings),
    })),
  ];
}

/** (c): the keyword lengths, in characters, the limit is probed at. */
export const FINAL_LENGTH_TARGETS = [400, 800, 1200, 1600];

/** Other technologies, used only to lengthen the dev keyword. */
const PAD_TECHNOLOGIES = (
  'python java golang rust kotlin swift scala ruby php elixir haskell clojure erlang perl lua dart ' +
  'django flask fastapi rails laravel symfony spring express koa hapi fastify svelte vue angular ember ' +
  'solid qwik astro remix gatsby nuxt redux mobx zustand rxjs graphql grpc kafka rabbitmq redis memcached ' +
  'mongodb mysql mariadb sqlite cassandra dynamodb elasticsearch opensearch clickhouse snowflake bigquery ' +
  'redshift docker kubernetes helm terraform ansible pulumi jenkins gitlab circleci argocd prometheus grafana ' +
  'datadog sentry nginx apache linux ubuntu debian bash zsh git webpack vite rollup esbuild babel eslint ' +
  'prettier jest vitest mocha cypress playwright selenium puppeteer storybook tailwind bootstrap sass less ' +
  'figma firebase supabase prisma typeorm sequelize knex drizzle mongoose hasura strapi contentful sanity ' +
  'stripe twilio sendgrid auth0 okta keycloak oauth jwt openapi swagger postman azure gcp heroku vercel ' +
  'netlify cloudflare fastly lambda ec2 s3 sqs sns cloudfront ecs eks fargate pytorch tensorflow pandas numpy ' +
  'spark airflow dbt kubeflow mlflow unity unreal flutter ionic electron tauri cordova xamarin'
).split(' ');

/**
 * The dev keyword with extra technologies OR'd into its stack half, as many as
 * fit under `target` characters: probes where LinkedIn stops accepting a keyword.
 */
export function paddedKeyword(target: number): string {
  const extras: string[] = [];
  let best = DEV_KEYWORD;
  for (const tech of PAD_TECHNOLOGIES) {
    const next = andStack(
      EXTENDED_ROLE_WORDS,
      orTerms([...DEV_STACK_TERMS, ...extras, tech]),
    );
    if (next.length > target) continue;
    extras.push(tech);
    best = next;
  }
  if (best.length <= target - 25)
    throw new Error(`Not enough padding terms to reach ${target} characters`);
  return best;
}

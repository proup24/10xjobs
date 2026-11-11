# LinkedIn source on harvestapi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinkedIn job board collection runs on `harvestapi/linkedin-job-search`. Every useful LinkedIn fact is stored on the job as LinkedIn's value, and companies get a table of their own.

**Architecture:** The collector translates each builder's stored `f_E` and `f_WT` params into harvestapi's structured input, and segments group builders by a canonical search key. A new ingest mapper turns harvestapi items into the normalized record, which gains LinkedIn-only fields and a nested `company`. The jobs writer stores those fields, upserts `companies`, and keeps a job's extraction when its job key changes.

**Tech Stack:** NestJS, TypeScript (strict, nodenext), Vitest, Zod, the Prisma contract and migrations (`@prisma/orm-postgres`), Apify.

**Spec:** `docs/superpowers/specs/2026-11-11-linkedin-source-harvestapi-design.md`

## Global Constraints

- **Actor:** `harvestapi/linkedin-job-search`. Price: $0.001 per job, plus $0.001 start fee per search title.
- **One run per search.** Every run sends `postedLimit: '1h'` and `sortBy: 'date'`. `maxItems` is 100 and the charge cap is $0.25.
- **LinkedIn job board window:** `{ initialHours: 1, overlapMinutes: 0, maximumHours: 1 }`.
- **LinkedIn job board schedule:** `{ pattern: '0 9-21 * * 1-5', timezone: 'Africa/Casablanca' }`. LinkedIn posts keep today's `hourly` config.
- **Experience mapping:** `f_E` 1 `internship`, 2 `entry`, 3 `associate`, 4 `mid-senior`, 5 `director`.
- **Workplace mapping:** `f_WT` 1 `office`, 2 `remote`, 3 `hybrid`.
- **Builders keep storing `f_E` and `f_WT` codes.** No recipe bump, no `db:regenerate`.
- **The processor and the matcher are not changed.** The one exception is that the jobs writer keeps a job's extraction when the job is re-keyed (Task 5).
- **LinkedIn's values and the processor's values never share a field.** The new fields live on `normalized_jobs` and the normalized record only.
- **Raw identity stays `id:<LinkedIn job id>`.**
- **`NORMALIZER_VERSION` goes from 3 to 4.** Don't run `db:renormalize`, and don't delete old LinkedIn data.
- **The Apify token is read from `APIFY_TOKEN` in the environment.** Never write it to a file or a commit.

## Review Focus

1. **A harvestapi item with no company, or no `company.id`** (a confidential poster). Expected: `company` is null, the job stays valid, and no `companies` row is written. Tested in Task 3.
2. **The same job seen on two ticks**, differing only in signed logo URLs, `applicants`, `views`, `_meta`, `query` or `headerCaptionText`. Expected: one raw version, not two. Tested in Task 6.
3. **An Easy Apply item, or one whose `companyApplyUrl` is a LinkedIn URL.** Expected: `applyUrl` is null, and the job key stays `linkedin-job:<id>`. Tested in Task 3.
4. **Re-keying when the old job was never processed (`pending`), or when the target job already has its own extraction** (an ATS posting). Expected: no extraction is copied in either case; the pending state carries over as today. Tested in Task 5.
5. **A builder with both `geoId` and location text, and the `GLOBAL` builder.** Expected: `geoIds: [geoId]` and no `locations` for the first; `locations: ['Worldwide']` for `GLOBAL`. A multi-code `f_E` such as `'4,5'` becomes two levels, and an unknown code is dropped. Tested in Task 1.

---

### Task 1: harvestapi input and the search key

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts`. Replace `linkedinSearch`, `linkedinJobSearchUrl` and `toLinkedinJobBoardInput`.
- Create: `apps/xjobs/src/modules/collectors/providers/mappers/cheap-scraper-input.ts`. Holds the old `linkedinJobSearchUrl` and `toLinkedinJobBoardInput`, moved unchanged, plus a header comment: "Old actor input, used only by the parity and plan-test scripts. Delete when the shared-searches planner is revised."
- Modify: `apps/xjobs/src/modules/segments/services/segments.ts`. Import `linkedinSearchKey`.
- Modify: `apps/xjobs/src/scripts/linkedin-plan-test.ts` and `apps/xjobs/src/scripts/probe-linkedin-search.ts`. Change their imports to `cheap-scraper-input.ts`.
- Test: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.spec.ts` (new), plus the `linkedinSearch` and `linkedinJobSearchUrl` blocks of `segment-collect.spec.ts`, which move to `cheap-scraper-input.spec.ts`.

**Interfaces:**

- Produces:
  - `export interface HarvestJobSearchInput { jobTitles: string[]; geoIds?: string[]; locations?: string[]; experienceLevel?: string[]; workplaceType?: string[]; postedLimit: '1h'; sortBy: 'date'; maxItems: number }`
  - `export function toHarvestJobSearchInput(keyword: string, params: Record<string, unknown>, maxItems: number): HarvestJobSearchInput`
  - `export function linkedinSearchKey(keyword: string, params: Record<string, unknown>): string`. Returns canonical JSON of `{ keyword, place, experienceLevel, workplaceType }`:
    - `place` is `{ geoId }` when the builder has one, else `{ location }`, with `GLOBAL` → `Worldwide`.
    - Both arrays hold the mapped values, sorted.
    - Optional properties are omitted when empty.

- [ ] **Step 1: Write the failing tests** in `linkedin-job-board.mapper.spec.ts`:
  - `toHarvestJobSearchInput('backend golang', { location: 'Germany', experienceLevel: '4,5', workType: '2' }, 100)` equals `{ jobTitles: ['backend golang'], locations: ['Germany'], experienceLevel: ['mid-senior', 'director'], workplaceType: ['remote'], postedLimit: '1h', sortBy: 'date', maxItems: 100 }`.
  - `{ location: 'uae', geoId: '104305776' }` gives `geoIds: ['104305776']` and no `locations` key.
  - `{ location: 'GLOBAL' }` gives `locations: ['Worldwide']`.
  - `{ experienceLevel: '1,9' }` gives `experienceLevel: ['internship']`. `{ workType: '1' }` gives `['office']`, and `'3'` gives `['hybrid']`.
  - No `experienceLevel` or `workType` param means no such key in the input.
  - `linkedinSearchKey` is equal for `{ location: 'uae', geoId: 'X' }` and `{ location: 'united arab emirates', geoId: 'X' }`.
  - `linkedinSearchKey` is equal for `experienceLevel: '4,5'` and `'5,4'`.
  - `linkedinSearchKey` differs when `workType` differs, and when the keyword differs.
- [ ] **Step 2: Run** `npx nx test xjobs -- linkedin-job-board.mapper`. Expected: FAIL, the functions are not exported.
- [ ] **Step 3: Implement** both functions. Then move the old helpers to `cheap-scraper-input.ts`, and point `segments.ts` at `linkedinSearchKey`: the key becomes `search:${linkedinSearchKey(...)}`. The segment key strings change, so each segment's hash changes once. That's harmless, because cursors live on the builders.
- [ ] **Step 4: Run** `npx nx test xjobs -- linkedin-job-board.mapper cheap-scraper-input segments`. Expected: PASS. The collector spec still uses the old helpers until Task 6, so it imports them from `cheap-scraper-input.ts` for now.
- [ ] **Step 5: Run** `npx nx run-many -t lint typecheck -p @xjobs/xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(collectors): harvestapi job search input and a structured LinkedIn search key`.

### Task 2: Parity check (go/no-go)

**Files:**

- Create: `apps/xjobs/src/scripts/linkedin-source-parity.ts`
- Modify: `apps/xjobs/package.json`. Add the script `"apify:linkedin-parity": "tsx --conditions=@xjobs/source --tsconfig tsconfig.app.json src/scripts/linkedin-source-parity.ts"`.
- Create: `docs/actors/harvestapi-linkedin-job-search.md`. Covers the actor's input, output, prices, the field coverage from the spec, and this check's result.

**Interfaces:**

- Consumes:
  - `toHarvestJobSearchInput` from Task 1.
  - `linkedinJobSearchUrl` and `toLinkedinJobBoardInput` from `cheap-scraper-input.ts`.
  - `ApifyClient` from `apify-client`, the way `linkedin-plan-test.ts` uses it.

- [ ] **Step 1: Write the script.**
  - **Searches.** It takes three builders as flags: `--search 'keyword|location|f_E|f_WT'`, repeatable, with empty parts allowed. The defaults are three real dev builders, chosen by the implementer from `query_search_builders` (read-only via the `supabase-dev` MCP) to cover a country, a region and a remote filter.
  - **Runs.** For each search it runs both actors over the last 24 hours, with a cap of $0.03 per run and `maxItems` 100:
    - cheap_scraper: `f_TPR=r86400` in the URL.
    - harvestapi: its input from `toHarvestJobSearchInput` with `postedLimit` overridden to `'24h'`.
  - **Output.** For each search it prints a JSON block: `{ search, cheap: { returned, total }, harvest: { returned, total }, onlyCheap: [...ids], onlyHarvest: [...ids], shared }`.
    - cheap_scraper's total comes from its `SEARCH_TOTALS` record; harvestapi's from `_meta.pagination.totalElements`.
    - Job ids are cheap_scraper's `jobId` and harvestapi's `id`.
  - **Budget.** It refuses to start when the reserved spend (6 × $0.03) is above $0.20.
- [ ] **Step 2: Run** `APIFY_TOKEN=<from the user> pnpm --filter @xjobs/xjobs apify:linkedin-parity > /tmp/<scratch>/parity.json`. Ask the user for the token if it isn't in the shell environment; never put it in a file. Expected: six succeeded runs, and a total cost under $0.20.
- [ ] **Step 3: Decide go or no-go.**
  - **Go:** for every search, harvestapi returns at least 80% as many jobs as cheap_scraper, and `onlyCheap` is no more than 20% of cheap_scraper's jobs.
  - **No-go:** otherwise, stop the plan and bring the output to the user.
  - Record the numbers in `docs/actors/harvestapi-linkedin-job-search.md`.
- [ ] **Step 4: Save fixtures.**
  - Copy these harvestapi items into `apps/xjobs/src/modules/ingest/utils/fixtures/linkedin-job-harvest.json`, as an array, from this run or from `/tmp/claude-1000/-home-lab-apps-10xjobs/0f9b0e3c-21e3-4c36-bffc-8d7d1cfbd23e/scratchpad/harvest-run/items.json`:
    - one remote item with a hiring team and a region location (`regionCode: 'EU'`);
    - one hybrid item with an outside apply URL;
    - one on-site item with a salary;
    - one item with `workplaceType: null`;
    - one Easy Apply (`ComplexOnsiteApply` to `linkedin.com/job-apply/...`);
    - one `ComplexOnsiteApply` with an outside URL.
  - Replace hiring-team names, profile URLs and email addresses in descriptions with obvious placeholders (`Jane Recruiter`, `https://www.linkedin.com/in/placeholder`, `recruiter@example.com`).
- [ ] **Step 5: Commit** `chore(scripts): LinkedIn source parity check and harvestapi fixtures`.

### Task 3: The harvestapi mapper and the record's new fields

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/mappers/harvest-job.mapper.ts`
- Modify: `apps/xjobs/src/modules/ingest/normalize/record.ts`. Schema, `RECORD_FIELDS`, `NORMALIZER_VERSION = 4`.
- Modify: `apps/xjobs/src/modules/ingest/normalize/mappers/linkedin-job.mapper.ts`. List harvestapi first; bebity's `isBebityJob` also matches harvestapi items.
- Modify: `apps/xjobs/src/modules/ingest/normalize/merge.ts`. Only if the new fields need anything beyond the default "first open source that states it" rule; they shouldn't.
- Test: `apps/xjobs/src/modules/ingest/normalize/harvest-job.spec.ts` (new), `linkedin.spec.ts`, `merge.spec.ts`, `ats.spec.ts`.

**Interfaces:**

- Produces:
  - **Record fields.** After `poster`, before `closed`, `RECORD_FIELDS` gains:
    - `workplaceType: 'remote' | 'hybrid' | 'onsite' | null`
    - `remoteAllowed: boolean | null`
    - `employmentType: string | null`
    - `countryCode: string | null` (`/^[A-Z]{2}$/`)
    - `regionCode: string | null`
    - `applicantTrackingSystem: string | null`
    - `applicantCount: number | null` (int ≥ 0)
    - `expiresAt: string | null` (ISO datetime)
    - `listingState: string | null`
    - `company: NormalizedCompany | null`
  - `export interface NormalizedCompany { linkedinId: string; universalName: string | null; name: string | null; linkedinUrl: string | null; website: string | null; employeeCount: number | null; employeeCountMin: number | null; employeeCountMax: number | null; industries: string[]; specialities: string[]; description: string | null; headquartersCountryCode: string | null }`, the Zod `strictObject` exported from `record.ts`.
  - `export function isHarvestJob(p: Record<string, unknown>): boolean`: true when `'applyMethod' in p && 'jobState' in p`.
  - `export function mapHarvestJob(p: Record<string, unknown>, ctx: NormalizeContext): NormalizedRecord`

- [ ] **Step 1: Write the failing tests** in `harvest-job.spec.ts`, against the fixture items from Task 2:
  - **Remote item:**
    - `workplaceType: 'remote'`, `remoteAllowed: true`, `regionCode: 'EU'`, `countryCode: null`.
    - `poster: { name: 'Jane Recruiter', profileUrl: 'https://www.linkedin.com/in/placeholder', type: 'person' }`.
    - `employmentType: 'full_time'`, `contractType: 'Full-time'`.
    - `listingState: 'LISTED'`, `closed: false`.
    - `publishedAt` is `postedDate`'s date part, and `postedAt` is `postedDate` unchanged.
    - `descriptionHtml` and `descriptionText` are both set.
    - `postingUrl: 'https://www.linkedin.com/jobs/view/<id>'`.
  - **Every item:** `experienceLevel` equals the item's `experienceLevel` (null when missing), `applicantTrackingSystem` equals `applicantTrackingSystem`, `applicantCount` equals `applicants`, and `expiresAt` equals `expireAt`.
  - **On-site item:** `workplaceType: 'onsite'`, `countryCode: 'FR'`, and a salary with `text`, `min`, `max`, `currency: 'EUR'`, `period: 'MONTHLY'`.
  - **Null workplace item:** `workplaceType: null`.
  - **Outside apply URL item:** `applyUrl` equals `applyMethod.companyApplyUrl`. `jobKey(Channel.LINKEDIN_JOB_BOARD, 'id:<id>', record)` doesn't start with `linkedin-job:`. If the fixture is an Ashby or Greenhouse URL it starts with `ats:`, otherwise with `url:`.
  - **Easy Apply item:** `applyUrl: null`, and the job key is `linkedin-job:<id>`.
  - **Outside-URL `ComplexOnsiteApply` item:** `applyUrl` is the outside URL.
  - **Company:**
    - `linkedinId` equals `company.id`, and `website` is set.
    - `industries` equals `company.industries`, and `sector` equals `company.industries[0]`.
    - `employeeCountMin` and `employeeCountMax` come from `employeeCountRange`.
    - `headquartersCountryCode` comes from the `company.locations` entry with `headquarter: true`, upper-cased, or null.
  - **No company:** `{ ...item, company: null }` and `{ ...item, company: { name: 'X' } }` both give `company: null`, and the record stays valid.
  - **Bad values:** `salary: { text: null, min: null, max: null }` gives `salary: null`. `location.parsed.countryCode: 'oo'` gives `countryCode: null`.
  - **`employmentType` → `contractType`:** `part_time` → `Part-time`, `contract` → `Contract`, `temporary` → `Temporary`, `internship` → `Internship`, `volunteer` → `Volunteer` (title-cased, `_` → space).
  - **Order:** `linkedin.spec.ts` still maps the cheap_scraper and bebity fixtures as before, and their new fields are all null (`company: null`). A harvestapi fixture item is mapped by the harvestapi mapper, not by bebity's.
  - **ATS:** `ats.spec.ts` shows that Ashby and Greenhouse records carry the new fields as null.
- [ ] **Step 2: Run** `npx nx test xjobs -- normalize`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Read every field through the existing `clean*`, `httpUrl` and `isLinkedinHost` helpers.
  - `applyUrl`: `externalApplyUrl` checks a cheap_scraper `applyType`, so add a sibling `outsideUrl(value: unknown): string | null` in `linkedin.ts`: an http(s) URL, not on a LinkedIn host, returned unchanged.
  - Map `on_site` to `onsite`. Any other unknown `workplaceType` is null.
  - `emptyRecord` already nulls the new fields for every other mapper. `company` defaults to null, as the other non-`closed` fields do.
- [ ] **Step 4: Run** `npx nx test xjobs -- normalize ingest`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): map harvestapi LinkedIn jobs with workplace type, apply URL and company`.

### Task 4: Schema: job columns and `companies`

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`
- Create: `libs/database/src/migrations/app/<UTC yyyymmddThhmm>_linkedin_listing_fields_and_companies/`, generated.
- Modify: `libs/database/src/supabase/database.types.ts`, regenerated.
- Test: `apps/db-tests/src/engine-tables.db.spec.ts`, `apps/db-tests/src/rls-enabled.db.spec.ts` (only if it lists tables explicitly).

**Interfaces:**

- Produces:
  - **`model Company`**, `@@map("companies")`, `@@rls` with no policies:
    - `id Uuid @id @onCreate(uuid(7))`
    - `linkedinId String @unique`
    - `universalName String?`, `name String?`, `linkedinUrl String?`, `website String?`
    - `employeeCount Int?`, `employeeCountMin Int?`, `employeeCountMax Int?`
    - `industries String[]`, `specialities String[]`
    - `description String?`, `headquartersCountryCode String?`
    - `firstSeenAt TimestamptzJsDate(3)`, `lastSeenAt TimestamptzJsDate(3)`
    - `jobs NormalizedJob[]`, `+Timestamps`
    - `@@check` `"firstSeenAt" <= "lastSeenAt"`
  - **`NormalizedJob` gains** these nullable columns:
    - `workplaceType String?` with `@@check(expression: sql\`"workplaceType" IS NULL OR "workplaceType" IN ('remote', 'hybrid', 'onsite')\`, name: "normalized_jobs_workplace_type")`
    - `remoteAllowed Boolean?`, `employmentType String?`, `countryCode String?`, `regionCode String?`
    - `applicantTrackingSystem String?`, `applicantCount Int?`
    - `expiresAt TimestamptzJsDate(3)?`, `listingState String?`
    - `companyId Uuid?`, with `company Company? @relation(fields: [companyId], references: [id], onDelete: Restrict)` and `@@index([companyId])`

- [ ] **Step 1: Write the failing test.** Add a `companies` entry to `engine-tables.db.spec.ts`'s table list, so that `authenticated` and `anon` can neither read nor write it, like the others. Give the `normalized_jobs` row a `companyId` pointing at it.
- [ ] **Step 2: Run** `pnpm db:reset && pnpm db:test -- engine-tables`. Expected: FAIL, the relation doesn't exist.
- [ ] **Step 3: Edit the contract**, then run `pnpm --filter @xjobs/database db:migration:plan`, rename the generated directory to `..._linkedin_listing_fields_and_companies`, run `pnpm db:reset`, then `pnpm db:types`.
- [ ] **Step 4: Run** `pnpm db:test -- engine-tables rls-enabled isolation`. Expected: PASS.
- [ ] **Step 5: Run** `npx nx run-many -t lint typecheck -p @xjobs/xjobs @xjobs/database`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(db): LinkedIn listing fields on normalized_jobs and a companies table`.

### Task 5: Jobs writer: new columns, company upsert, extraction on re-key

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts`
- Create: `apps/xjobs/src/modules/ingest/repositories/companies.writer.ts`
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts`. Use the existing `INGEST_TEST_DATABASE_URL` recipe; ask the user to check that the disposable database exists.

**Interfaces:**

- Consumes:
  - `NormalizedCompany` and the new record fields from Task 3.
  - The `Company` model and the new job columns from Task 4.
- Produces: `export async function upsertCompany(tx: DatabaseTransaction, company: NormalizedCompany, seenAt: Date): Promise<string>`. Returns the company id.
  - **Insert** when `linkedinId` is new, with `firstSeenAt = lastSeenAt = seenAt`.
  - **Update** otherwise: `firstSeenAt = least(...)`, `lastSeenAt = greatest(...)`. The other columns are overwritten only when `seenAt >= stored lastSeenAt`, so a rebuild of an older job never rolls a company back.
  - It runs as one `INSERT … ON CONFLICT ("linkedinId") DO UPDATE` with those conditions, so concurrent ingest can't race.

- [ ] **Step 1: Write the failing tests** in `raw.postgres.spec.ts`:
  - **New fields.** Ingesting the harvestapi remote fixture creates a job with `workplaceType 'remote'`, `employmentType 'full_time'`, `regionCode 'EU'`, `listingState 'LISTED'`, a non-null `companyId`, and `descriptionHtml` set.
  - **Company row.** Its `linkedinId` and `website` come from the fixture.
  - **Newer company data wins.** Ingesting a second job with the same `company.id` and a changed `employeeCount`, observed later, updates the company row. Re-running `linkJob` with `rebuild: true` on the first job leaves the newer value in place.
  - **Re-key.** A cheap_scraper version of LinkedIn id N is ingested and its job is set to `processingStatus 'processed'` with an extraction (insert a minimal `job_extractions` row, as `engine-tables.db.spec.ts` does). Then a harvestapi version of id N with an Ashby `companyApplyUrl` is ingested. Expected:
    - The old job is `merged`.
    - The new job is `active` and `processed`.
    - The new job's `currentExtractionId` points at a copy whose `jobId` is the new job, with `costUsd` 0 and the same `data`.
  - **Re-key into an existing job.** The same, but an `ats:ashby/...` job with its own extraction already exists. Expected: that job keeps its own `currentExtractionId`.
  - **Re-key of a pending job.** The same, but the old job is `pending` with no extraction. Expected: the new job is `pending`, with `currentExtractionId` null.
- [ ] **Step 2: Run** `INGEST_TEST_DATABASE_URL=… npx nx test xjobs -- raw.postgres`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `fieldColumns` writes the nine new scalar columns. `expiresAt` becomes a `Date`.
  - `remerge` calls `upsertCompany(tx, merged.record.company, <lastSeenAt of the source the company came from>)` when the merged record has a company, and sets `companyId` (null otherwise). `fieldSources.company` names that source's raw item.
  - In `linkJob`'s `if (created)` branch, when `old.currentExtractionId` is set, copy that `job_extractions` row to the new job (every column except `id` and `createdAt`, with `jobId` set to the new job and `costUsd` 0, as `ProcessorRepository.copyExtraction` does). Set `currentExtractionId` and `processedAt` from the old job.
- [ ] **Step 4: Run** `INGEST_TEST_DATABASE_URL=… npx nx test xjobs -- ingest`. Expected: PASS, including the existing writer specs.
- [ ] **Step 5: Commit** `feat(ingest): store LinkedIn listing fields and companies, keep the extraction on re-key`.

### Task 6: Collector switch, schedule and volatile keys

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts`. Rename `maxRowsPerUrl` to `maxRowsPerSearch`.
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts`
- Modify: `apps/xjobs/src/modules/ingest/config/channels.ts`
- Test: `apps/xjobs/src/modules/collectors/providers/segment-collect.spec.ts`, `apps/xjobs/src/infrastructure/worker/tests/scheduler.spec.ts` and `collection-worker.spec.ts` (schedule values), `apps/xjobs/src/modules/ingest/utils/content-hash.spec.ts`.

**Interfaces:**

- Consumes: `toHarvestJobSearchInput` and `linkedinSearchKey` from Task 1.
- Produces: `LinkedinJobBoardCollector.config = { actor: 'harvestapi/linkedin-job-search', maxRunChargeUsd: 0.25, maxRowsPerSearch: 100 }`.

- [ ] **Step 1: Rewrite the LinkedIn job board block of `segment-collect.spec.ts`** around harvestapi items `{ id, title, linkedinUrl, descriptionText, applyMethod: {}, jobState: 'LISTED', _meta: { pagination: { totalElements } } }`:
  - **Input.** Actor `harvestapi/linkedin-job-search`, input `toHarvestJobSearchInput(keyword, params, 100)`, options `{ maxChargeUsd: 0.25 }`. The segment's window plays no part: the input is the same for a 1-hour and a 24-hour segment.
  - **Attribution.** Every member gets every item, ranked by dataset order.
  - **Geo spellings.** Members that spell a geoId-pinned place differently still make one run.
  - **Different searches** in one segment still throw `/one search/`.
  - **Truncation.** Truncated when 100 items come back, or when `totalElements` (40) is greater than the items returned (30). Not truncated at 30 of 30.
  - **Search totals.** `searchTotals` equals the first item's `_meta.pagination`, or null when there are no items. The old `SEARCH_TOTALS` record isn't read.
- [ ] **Step 2: Add to `content-hash.spec.ts`.** Two copies of a harvestapi fixture item, differing in `company.logo`, `company.logos`, `company.backgroundCover`, `company.backgroundCovers`, `company.followerCount`, `company.employeeCount`, `applicants`, `views`, `new`, `_meta`, `query` and `headerCaptionText`, hash the same. A changed `descriptionText` hashes differently.
- [ ] **Step 3: Update the schedule tests.** The LinkedIn job board's schedule is `{ pattern: '0 9-21 * * 1-5', timezone: 'Africa/Casablanca' }` and its window is `{ initialHours: 1, overlapMinutes: 0, maximumHours: 1 }`. LinkedIn posts keep `'0 8-22 * * 1-5'` UTC and their 15-minute overlap.
- [ ] **Step 4: Run** `npx nx test xjobs -- segment-collect content-hash scheduler collection-worker`. Expected: FAIL.
- [ ] **Step 5: Implement.**
  - **Collector.** Drop the `seconds` computation and the `record()` call. `ApifyActorProvider.record` stays for the posts collector, if that collector uses it.
  - **Config.** Give the LinkedIn job board its own `linkedinJobBoard` config (`...hourly`, then the schedule and window above). Posts keep `...hourly`.
  - **Volatile keys.** Add the Step 2 paths to `LINKEDIN_JOB_BOARD.volatileKeys`. Because `applicants` is volatile, the stored `applicantCount` is the value from the first scrape of each content version. That's accepted.
  - **Leftovers.** Delete `cheap-scraper-input.ts`'s use in this spec; the scripts still use it.
- [ ] **Step 6: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(collectors): collect the LinkedIn job board with harvestapi, hourly 09-21 Morocco time`.

### Task 7: Docs, roadmap and the PR

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/README.md` and the collectors README, if one names the actor. Name the new actor, the new fields and `companies`.
- Modify: `docs/actors/linkedin-job-scraper.md`. Add a top note: "Replaced by harvestapi on 2026-11-11; kept for the old raw items."
- Modify: `docs/roadmap/phase-3-find-quality/01-linkedin-source-data.md`. Status line: spec and plan links, built.
- Modify: `docs/superpowers/specs/2026-11-11-linkedin-source-harvestapi-design.md`. Status becomes `approved`.

- [ ] **Step 1: Update the docs** above. Keep each change to what's now true; no history.
- [ ] **Step 2: Run** `npx nx run-many -t lint test build typecheck` and `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 3: Commit** `docs: harvestapi LinkedIn source`, push with `git push -u origin feat/linkedin-harvestapi`, and open the PR to `main` with `gh pr create`. The body includes:
  - the parity numbers;
  - the post-deploy check below;
  - a note that the shared-searches spec must be revised against this actor before its planner tasks are built.
- [ ] **Step 4: Post-deploy check, by hand, after the user merges and deploys.** On `10xjobs-dev`, after the first tick, run read-only queries through the `supabase-dev` MCP:
  - New LinkedIn jobs: the share with `workplaceType`, with `applyUrl`, with `companyId`, and with `descriptionHtml`.
  - The number of `companies` rows.
  - The tick's Apify cost (sum of `costUsd` for the batch).
  - Report the numbers to the user.

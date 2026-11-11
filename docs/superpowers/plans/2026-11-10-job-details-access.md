# Job details for matches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user reads their matches with each job's details, curated facts and source quotes in one `supabase.rpc` call, and nothing else of the shared job tables.

**Architecture:** One `SECURITY DEFINER` SQL function, `public.match_details`, starts from the caller's own `job_matches` and joins `normalized_jobs`, the match's `job_extractions` row, the job's source channels and the value-list labels. A private helper, `public.match_facts(jsonb)`, turns the extraction document into the curated facts object; only `match_details` can call it. Both ship in one same-hash app migration (raw SQL, as `create_profile_from_draft` did). The shared tables keep RLS on with no user policies.

**Tech Stack:** Postgres (Supabase local stack), Prisma Next migrations (`@prisma/orm-postgres` `rawSql`), Vitest db-tests through `supabase-js`.

**Spec:** `docs/superpowers/specs/2026-11-10-job-details-access-design.md`

## Global Constraints

- The Prisma contract (`libs/database/src/contract/contract.prisma`) is the only schema source; functions go in an app migration as raw SQL.
- `normalized_jobs`, `job_extractions`, `normalized_job_sources`, `raw_items` keep RLS on with no user policies.
- Functions: `SET search_path = ''`, fully qualified names, `REVOKE … FROM PUBLIC, anon`.
- The description is `descriptionText` only; `descriptionHtml` is never returned.
- Only v2 extraction documents are read (the matcher decides only on `schemaVersion = 2`).
- Hidden, always: `fieldSources`, raw item ids or contents, `processing*`, `normalizerVersion`, `mergedIntoId`, `descriptionHtml`, `currentExtractionId`, and from the document `confidence`, `decidedBy`, `score`, `model`, `verification`, `junkFlags`, `conflicts`, `unmatched`, `truncated`, `models`; from the extraction row `costUsd`, `needsReview`, hashes, model names.
- Work on a branch from `main` (`feat/job-details-access`); PR to `main`; Claude pushes only with `git push -u origin <branch>`.

## Review Focus

1. **Quotes that are empty strings.** The processor stores `""` when it has no quote (seen on dev). Expected: the facts carry `quote: null`, so the view never shows an empty quote. Test in Task 2.
2. **A fact whose value is null.** The posting doesn't state salary or years. Expected: that fact key is `null`, not an object with nulls. Test in Task 2.
3. **A technology or place code with no value-list row.** Technology `{code: null, text: "Dynatrace"}` is common on dev. Expected: label falls back to `text`; a region/country code with no row gets `label: null`, not a dropped entry. Test in Task 2.
4. **A job matched to both users.** A and B both have a match on the same job. Expected: each sees their own match row once, never the other's `checks`/`stackScore`. Test in Task 2.
5. **A job with two sources.** Expected: one row per match, `channels` holds both channels once each, sorted. Test in Task 2.

---

### Task 1: Matched-job fixtures and engine-table coverage

**Files:**

- Modify: `apps/db-tests/src/support/fixtures.ts`
- Modify: `apps/db-tests/src/engine-tables.db.spec.ts`

**Interfaces:**

- Produces, in `fixtures.ts`:
  - `seedDetailedJob(opts?: { status?: 'active' | 'merged'; channels?: Array<'LINKEDIN_JOB_BOARD' | 'LINKEDIN_POSTS' | 'GREEN_HOUSE' | 'ASHBY'>; lastSeenAt?: string; document?: Record<string, unknown> }): Promise<{ jobId: string; extractionId: string }>` — a `normalized_jobs` row with every exposed field set (and the hidden ones set to recognizable values: `fieldSources: { title: 'secret-source' }`, `descriptionHtml: '<p>secret-html</p>'`, `processingError: 'secret-error'`), a v2 extraction (`schemaVersion: 2`, `data: opts.document ?? detailedDocument()`), and one source chain per channel (default `['LINKEDIN_JOB_BOARD']`). `status: 'merged'` also creates the job it's merged into and sets `mergedIntoId`.
  - `seedMatchOn(userId: string, profileId: string, job: { jobId: string; extractionId: string }, opts?: { outcome?: 'qualified' | 'rejected'; checks?: unknown; stackScore?: number }): Promise<string>` — the `job_matches` row pointing at `job.extractionId` (`matcherVersion: 1`, `unverified: false`, `checks` default `{}`); returns the match id.
  - `detailedDocument(): Record<string, unknown>` — a valid v2 extraction document (shape from `apps/xjobs/src/modules/processor/schema/extraction.ts`), with full envelopes (`confidence`, `decidedBy`, `score`, `model: 'secret-model'`, `verification`), and: `position {roleKind:'backend', title:'Senior Backend Engineer'}` quote `'We are hiring a Senior Backend Engineer'`; `seniority 'senior'`; `yearsRequired {min:5,max:null}` quote `'5+ years'`; `arrangement 'remote'`; one opening `{arrangements:['remote'], places:[{kind:'region',code:'EMEA'},{kind:'country',code:'ZZ'}], placeStrictness:'limit', timezones:[{fromUtc:-1,toUtc:3,label:'CET ±2h'}], quote:'Remote within EMEA'}`; `contractType 'full_time'`; `engagement` value `null` with quote `''`; `contractMonths` null; `salary {min:70000,max:90000,currency:'EUR',period:'year'}` quote `'€70–90k'`; `techStack` with requirements `{technology:{code:'typescript',text:'TypeScript'},kind:'main',…,group:null}` and `{technology:{code:null,text:'Dynatrace'},kind:'must',…,group:'g1'}`, `groups:[{id:'g1',min:1}]`; `requiredLanguages [{lang:'de',level:'fluent',quote:'Fluent German'}]`; `workAuthorization {requirements:[{kind:'work-permit',place:'DE'}], sponsorship:'no'}`; `junkFlags`, `conflicts`, `unmatched`, `verification`, `models` filled with `secret-*` strings. Codes used (`backend`, `senior`, `remote`, `full_time`, `typescript`, `EMEA`) must exist in the seeded value lists; `ZZ` must not. Check `libs/database/src/seeds` and pick real codes if any differ.
  - `cleanupDetailedJobs(): Promise<void>` — deletes everything the two seeders created (matches, extractions, sources and their chains, jobs, merged targets), in reverse dependency order. Track ids in a module-level list.
- The source chain per channel, all through `admin()`: `query_search_builder` → `search_segment_runs` → `collection_batches` → `raw_items` → `raw_item_versions` → `normalized_versions` (`status:'valid'`, `record:{}`, `jobKey` = the job's) → `normalized_job_sources`. Copy the minimal valid rows from `engine-tables.db.spec.ts`.

- [ ] **Step 1: Add `normalized_jobs`, `job_extractions` and `normalized_job_sources` to the `fixtures` list in `engine-tables.db.spec.ts`**, so the existing `describe.each` checks a signed-in user sees nothing and can't insert. Add `normalized_versions` too (it's on the chain). Use minimal rows in dependency order after `raw_item_versions`.

- [ ] **Step 2: Run** `pnpm db:test -- engine-tables`
      Expected: PASS for every table, including the four new ones (they are already engine-only; this pins it).

- [ ] **Step 3: Write `seedDetailedJob`, `seedMatchOn`, `detailedDocument`, `cleanupDetailedJobs`.** Validate the document against the engine's schema once, by hand: `pnpm tsx -e` importing `extractionDocumentSchema` from `apps/xjobs/src/modules/processor/schema/extraction.ts` and `.parse(detailedDocument())`. It must parse.

- [ ] **Step 4: Run** `npx nx run-many -t lint typecheck -p @xjobs/db-tests`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/db-tests/src/support/fixtures.ts apps/db-tests/src/engine-tables.db.spec.ts
git commit -m "test(db): matched-job fixtures and engine-only checks for job tables"
```

### Task 2: `match_details` function

**Files:**

- Create: `libs/database/src/migrations/app/<UTC yyyymmddThhmm>_match_details/migration.ts` (then `ops.json`, `migration.json` emitted)
- Modify: `libs/database/src/migrations/app/refs/db.json`
- Modify: `libs/database/src/supabase/database.types.ts` (regenerated)
- Create: `apps/db-tests/src/match-details.db.spec.ts`

**Interfaces:**

- Consumes: Task 1's fixtures; `createTestUser`, `cleanupTestUsers`, `seedProfile`, `publishProfile`, `admin`, `noSession`/`stack` for an anon client (see `resume-swap.db.spec.ts`'s `anon()`).
- Produces:
  - `public.match_details(p_profile_id uuid, p_outcome text DEFAULT 'qualified', p_since timestamptz DEFAULT NULL, p_job_id uuid DEFAULT NULL)` `RETURNS TABLE(...)`, `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`. `GRANT EXECUTE … TO authenticated`; revoked from `PUBLIC, anon`.
  - Columns, in order: `"matchId" uuid, "profileId" uuid, "jobId" uuid, outcome text, unverified boolean, "stackScore" numeric, checks jsonb, "decidedAt" timestamptz, kind text, title text, "companyName" text, "companyUrl" text, location text, "salaryText" text, "salaryMin" int, "salaryMax" int, "salaryCurrency" text, "salaryPeriod" text, "publishedAt" text, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz, closed boolean, "postingUrl" text, "applyUrl" text, "posterName" text, "posterProfileUrl" text, "posterType" text, "descriptionText" text, channels text[], facts jsonb`.
  - Filters: `m."userId" = auth.uid()` (null uid → no rows), `m."profileId" = p_profile_id`, `m.outcome = p_outcome`, `j.status = 'active'`, `p_since IS NULL OR j."lastSeenAt" >= p_since`, `p_job_id IS NULL OR m."jobId" = p_job_id`. Facts come from `m."extractionId"`, not `j."currentExtractionId"`. `channels` = sorted distinct `raw_items.channel` via `normalized_job_sources`. No `ORDER BY` inside (the client orders).
  - `public.match_facts(doc jsonb) RETURNS jsonb`, `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''`; `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (only the owner, via `match_details`, runs it).
  - The facts object. A fact whose `value` is null is `null`; every `quote` that is `''` becomes `null`; `{code,label}` labels come from the value lists by code regardless of status:
    ```
    position:          { roleKind: {code,label}, title, quote }
    seniority:         { code, label, quote }
    yearsRequired:     { min, max, quote }
    arrangement:       { code, label, quote }
    openings:          [ { arrangements: [{code,label}],
                           places: [ {kind:'worldwide'} | {kind:'region',code,label} | {kind:'country',code,label} | {kind:'city',name,countryCode,cityId} ],
                           placeStrictness, timezones: [{fromUtc,toUtc,label}], quote } ]
    contractType:      { code, label, quote }
    engagement:        { code, label, quote }
    contractMonths:    { months, quote }
    salary:            { min, max, currency, period, quote }
    techStack:         { requirements: [ { technology: {code,label,text}, kind, importance, domain, years, group, quote } ],
                         groups: [{id,min}], quote }
    requiredLanguages: { languages: [{lang,level,quote}], quote }
    workAuthorization: { requirements: [{kind,place}], sponsorship, quote }
    ```
    Labels: `role_kinds`, `seniorities`, `arrangements`, `contract_types`, `engagements`, `tech_tags`, `regions`, `countries` (`label` column). Technology label falls back to `text` when the code is null or unknown; others fall back to `null`. Openings and requirements drop `confidence`/`decidedBy`.

- [ ] **Step 1: Write the failing tests** in `apps/db-tests/src/match-details.db.spec.ts`. Setup in `beforeAll`: users A and B, each a published profile; `jobShared = seedDetailedJob({ channels: ['LINKEDIN_JOB_BOARD','ASHBY'] })` matched by A (`checks: {a:1}`, `stackScore: 0.8`) and B (`checks: {b:1}`, `stackScore: 0.3`); `jobA` matched by A only; `jobRejected` matched by A with `outcome: 'rejected'`; `jobOld` (`lastSeenAt: '2026-01-01T00:00:00Z'`) matched by A; `jobMerged` (`status: 'merged'`) matched by A; `jobNobody` with no match. Call via `x.client.rpc('match_details', {...})`. Tests:
  - `returns the owner's qualified matches with job details`: A, `{p_profile_id: profileA}` → job ids equal `{jobShared, jobA, jobOld}`; the `jobShared` row has `title`, `postingUrl`, `descriptionText` set as seeded, `checks` `{a:1}`, `stackScore` `0.8`, `channels` `['ASHBY','LINKEDIN_JOB_BOARD']`.
  - `returns rejected matches when asked`: `p_outcome: 'rejected'` → only `jobRejected`.
  - `applies the since window`: `p_since: '2026-06-01T00:00:00Z'` → no `jobOld`.
  - `narrows to one job`: `p_job_id: jobA` → one row, `jobA`.
  - `hides merged jobs`: `jobMerged` never appears.
  - `returns nothing for another user's profile`: B with `p_profile_id: profileA` → `[]`; B with `p_profile_id: profileA, p_job_id: jobA` → `[]`.
  - `shows each user only their own match on a shared job`: B with `profileB` → one row, `jobShared`, `checks` `{b:1}`, `stackScore` `0.3`.
  - `never returns an unmatched job`: neither user, any profile, `p_job_id: jobNobody` → `[]`.
  - `rejects anonymous callers`: anon client → `error` set (permission denied), `data` null.
  - `cannot call match_facts directly`: A, `rpc('match_facts', {doc: {}})` → `error` set.
  - `exposes only allowed columns`: `Object.keys(row).sort()` equals the column list above, sorted. Then `JSON.stringify(row)` does not contain `secret-` (every hidden value the fixtures seed starts with it).
  - `builds the facts`: on `jobShared`, `facts` deep-equals the expected object from `detailedDocument()` per the shape above, including: `engagement` is `null`; `contractMonths` is `null`; `seniority.label` equals the `seniorities` label for `senior` (read it with `admin()`); the `ZZ` country place has `label: null`; the Dynatrace technology has `{code: null, label: 'Dynatrace', text: 'Dynatrace'}`; no `confidence`/`decidedBy` key anywhere (walk the object).
  - `turns empty quotes into null`: `seedDetailedJob({ document: { ...detailedDocument(), seniority: { ...detailedDocument().seniority, quote: '' } } })`, matched by A → `facts.seniority.quote` is `null`.

- [ ] **Step 2: Run** `pnpm db:test -- match-details`
      Expected: FAIL; the rpc errors with "Could not find the function public.match_details".

- [ ] **Step 3: Write the migration**, modelled on `20261109T2238_create_profile_from_draft/migration.ts`: start and end contract both the current hash in `refs/db.json`; one `rawSql` op, `id: 'functions.match_details'`, `invariantId: 'match-details'`, `operationClass: 'data'`, the target detail `{ schema: 'public', objectType: 'table', name: 'job_matches' }`. Its `execute` creates `match_facts` first, then `match_details`, then the grants. Keep the top-of-file NOTE about the invariant. Emit `ops.json` and `migration.json` by running `node libs/database/src/migrations/app/<dir>/migration.ts`. Append `"match-details"` to `refs/db.json`'s `invariants`.

- [ ] **Step 4: Apply and regenerate types:** `pnpm db:reset`, then `pnpm db:types`.
      Expected: both succeed; `database.types.ts` gains `match_details` under `Functions` (and `match_facts`, which is fine).

- [ ] **Step 5: Run** `pnpm db:test -- match-details engine-tables isolation`
      Expected: PASS.

- [ ] **Step 6: Run** `npx nx run-many -t lint test build typecheck`
      Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/database/src/migrations/app apps/db-tests/src/match-details.db.spec.ts libs/database/src/supabase/database.types.ts
git commit -m "feat(db): match_details returns a user's matches with job details"
```

### Task 3: Check the query plan, add an index only if needed

**Files:**

- Create (scratchpad, not committed): a SQL script that seeds one profile with 3,000 matches over 3,000 jobs, 90% with `lastSeenAt` older than 30 days.
- Maybe modify: `libs/database/src/contract/contract.prisma` (an index), plus the planned migration.

**Interfaces:**

- Consumes: `match_details` from Task 2.

- [ ] **Step 1: Seed the local stack** with the script (via `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`), then `ANALYZE`.

- [ ] **Step 2: Run** `EXPLAIN (ANALYZE, BUFFERS)` on the function body's query, inlined, with that profile's `userId`, `p_outcome = 'qualified'`, `p_since = now() - interval '14 days'` (set `request.jwt.claims` so `auth.uid()` resolves, or substitute the uuid).
      Expected: an index scan on `job_matches (profileId, outcome, decidedAt)`, primary-key lookups on `normalized_jobs` and `job_extractions`, under 50 ms.

- [ ] **Step 3: Only if the plan shows a sequential scan on a large table or exceeds 50 ms,** add the index the plan asks for to the contract (`@@index` on the model), run `pnpm --filter @xjobs/database db:migration:plan`, apply with `pnpm db:reset`, and re-run Step 2. Otherwise change nothing.

- [ ] **Step 4: Remove the seeded rows** (`pnpm db:reset`) and record the plan's summary (scan types, time) for the PR description.

- [ ] **Step 5: Commit** only if Step 3 changed anything:

```bash
git add libs/database/src/contract libs/database/src/migrations/app
git commit -m "perf(db): index for the recent-matches read"
```

### Task 4: PR

- [ ] **Step 1: Run** `npx nx run-many -t lint test build typecheck` and `pnpm db:test`.
      Expected: PASS.
- [ ] **Step 2: Push and open the PR:** `git push -u origin feat/job-details-access`, then `gh pr create --base main` with a body that covers what the function returns, what stays hidden, the isolation tests, and Task 3's plan summary.

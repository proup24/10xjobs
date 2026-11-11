# Matches View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The signed-in home page lists a user's recent qualified jobs side by side (list left, job right), freshest by real posted time first, with "Last 24 hours" / "Last 7 days" tabs, "New" and "Viewed" markers, a profile switcher with "All profiles", and a source filter.

**Architecture:** The engine's normalizer gains a posted timestamp (`postedAt`) per record, estimated from LinkedIn's "N hours ago" against the raw version's first sighting, or taken from the source's exact time; the merged job keeps the earliest. A new user-owned table `job_views` records "Viewed". `match_details` is replaced to accept a null profile (all the caller's profiles) and to return `postedAt` and `viewedAt`. The web app reads it with `supabase-js` in a server component, groups rows by job, and renders a list/detail view whose state lives in the URL.

**Tech Stack:** NestJS engine (Vitest), Prisma Next contract and migrations, Supabase Postgres (db-tests through `supabase-js`), Next.js App Router, `components/ui`.

**Spec:** `docs/superpowers/specs/2026-11-11-matches-view-design.md`

## Global Constraints

- The Prisma contract (`libs/database/src/contract/contract.prisma`) is the only schema source, RLS policies included. Functions go in an app migration as raw SQL (precedent: `libs/database/src/migrations/app/20261110T2146_match_details/migration.ts`).
- Functions: `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names, `REVOKE … FROM PUBLIC, anon`, `GRANT EXECUTE … TO authenticated`.
- `normalized_jobs`, `job_extractions`, `normalized_job_sources`, `raw_items` keep RLS on with no user policies.
- UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`): no raw `<button>`/`<input>`/`<select>`, no literal colors, no arbitrary values.
- Reads and writes from the web app go through `supabase-js` under the user's session; no service role (`apps/web/src/no-service-role.spec.ts`).
- Windows: "Last 24 hours" = posted time within 24 h; "Last 7 days" = `lastSeenAt` within 7 days; "New" = posted 12 h ago or less; sort = posted time, newest first.
- A null `postedAt` falls back to `publishedAt`'s day at 00:00 UTC for sorting and the 24 h tab; such a job is never "New".
- Closed jobs are hidden.
- Not-checked copy lists: salary, contract type, engagement, required languages, work authorization, residence.
- Work on `feat/matches-view` from `main`; Claude pushes only with `git push -u origin feat/matches-view` and opens the PR with `gh pr create --base main`.

## Review Focus

1. **`postedTime` strings that don't parse** ("Reposted 2 hours ago", "just now", "30+ days ago", a non-English string, `""`). Expected: "Reposted N … ago" parses as N; "just now" / "moments ago" is the scrape time; anything else is `null`, never a thrown error or a wrong time. Tests in Task 1.
2. **An estimate past the end of the published day** ("20 hours ago", scraped `2026-11-10T20:32:26Z`, date `2026-11-09`). Expected: `2026-11-09T23:59:59.999Z`, so the job stays in "Last 24 hours". Test in Task 1.
3. **A job matched by two profiles in "All profiles".** Expected: one row, two profile badges, the higher stack score; the detail shows each profile's checks behind tabs. Test in Task 5.
4. **A user whose only profile is a draft, or who has a draft plus one published profile.** Expected: the draft's "isn't live yet" state; the switcher appears with both and no "All profiles". Tests in Task 5 and Task 6.
5. **A `p_job_id` in the URL that belongs to another user or isn't matched.** Expected: the detail pane shows "This job isn't in your matches", not an error page. Test in Task 6.

---

### Task 1: Posted-time estimate (pure)

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/posted-at.ts`
- Test: `apps/xjobs/src/modules/ingest/normalize/posted-at.spec.ts`

**Interfaces:**

- Produces:
  - `postedAtFromAgo(ago: unknown, scrapedAt: Date, publishedDate: string | null): string | null`: ISO string (`toISOString()`) or null.
  - `exactPostedAt(value: unknown): string | null`: an ISO datetime with a time part → its `toISOString()`; a date-only or bad value → null. Exact source times are not clamped.

- [ ] **Step 1: Write the failing tests** in `posted-at.spec.ts`, `scrapedAt = new Date('2026-11-10T20:32:26.671Z')`:
  - `'8 hours ago'`, date `'2026-11-10'` → `'2026-11-10T12:32:26.671Z'`
  - `'1 hour ago'` → `'2026-11-10T19:32:26.671Z'`; `'45 minutes ago'` → `'2026-11-10T19:47:26.671Z'`; `'1 minute ago'` → `'2026-11-10T20:31:26.671Z'`
  - `'2 days ago'`, date `'2026-11-08'` → `'2026-11-08T20:32:26.671Z'`; `'1 week ago'`, date `'2026-11-03'` → `'2026-11-03T20:32:26.671Z'`; `'1 month ago'` → 30 days back, clamped into its date if given
  - `'Reposted 2 hours ago'` → `'2026-11-10T18:32:26.671Z'`; `'just now'` and `'moments ago'` → the scrape time
  - **past the day's end:** `'20 hours ago'`, date `'2026-11-09'` → `'2026-11-09T23:59:59.999Z'`
  - **before the day's start:** `'3 days ago'`, date `'2026-11-09'` → `'2026-11-09T00:00:00.000Z'`
  - **never after the scrape:** date `'2026-11-11'` with `'1 hour ago'` → `'2026-11-10T19:32:26.671Z'` (date ignored when it is after the scrape day)
  - no date: `'8 hours ago'`, `null` → unclamped `'2026-11-10T12:32:26.671Z'`
  - unparseable → `null`: `''`, `null`, `42`, `'30+ days ago'`, `'il y a 3 heures'`, `'soon'`
  - `exactPostedAt('2026-10-29T23:30:00-04:00')` → `'2026-10-30T03:30:00.000Z'`; `exactPostedAt('2026-10-29')` → `null`; `exactPostedAt('nope')` → `null`

- [ ] **Step 2: Run** `npx nx test xjobs -- posted-at` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** both functions in `posted-at.ts`. Regex `^(?:reposted\s+)?(\d+)\s+(minute|hour|day|week|month)s?\s+ago$` (case-insensitive, trimmed), month = 30 days; "just now" / "moments ago" → 0. Clamp: `lo = date 00:00Z`, `hi = min(date 23:59:59.999Z, scrapedAt)` when the date is on or before the scrape day, else no date bound; result = `min(max(estimate, lo), hi)`, and never after `scrapedAt`.

- [ ] **Step 4: Run** `npx nx test xjobs -- posted-at` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ingest): estimate posted time from relative "ago" text`

### Task 2: `postedAt` in normalized records and jobs

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/record.ts` (field, `RECORD_FIELDS`, `NORMALIZER_VERSION = 3`)
- Modify: `apps/xjobs/src/modules/ingest/normalize/normalize.ts` (context argument)
- Modify: `apps/xjobs/src/modules/ingest/normalize/mappers/cheap-scraper-job.mapper.ts`, `mappers/bebity-job.mapper.ts`, `mappers/linkedin-job.mapper.ts`, `linkedin.ts` (`mapLinkedinPost`), `ats.ts`
- Modify: `apps/xjobs/src/modules/ingest/normalize/merge.ts`
- Modify: `libs/database/src/contract/contract.prisma` (`NormalizedJob.postedAt`), plus the planned migration
- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts`
- Modify: `apps/xjobs/src/modules/ingest/README.md` (record field list, rebuild note)
- Test: `normalize/linkedin.spec.ts`, `normalize/ats.spec.ts`, `normalize/merge.spec.ts`, and the writer's existing spec (whichever covers `fieldColumns` / `remerge`)

**Interfaces:**

- Consumes: Task 1's `postedAtFromAgo`, `exactPostedAt`.
- Produces:
  - `NormalizedRecord.postedAt: string | null`: schema `z.iso.datetime().nullable()` (or the zod 4 equivalent the file already uses), placed right after `publishedAt` in the schema and in `RECORD_FIELDS`.
  - `export interface NormalizeContext { scrapedAt: Date }`; `normalize(channel: Channel, payload: unknown, ctx: NormalizeContext): NormalizeResult`; the `Mapper` type and `LinkedinJobFormat.map` take `(payload, ctx)`.
  - Column `postedAt TimestamptzJsDate(3)?` on `NormalizedJob`, after `publishedAt`, with the comment `// Posted time: exact from the source, or estimated from LinkedIn's "N ago"; null when unknown.`
  - `fieldColumns` writes `postedAt: record.postedAt ? new Date(record.postedAt) : null`.

- [ ] **Step 1: Write the failing tests.**
  - `linkedin.spec.ts`, cheap_scraper: item with `postedTime: '8 hours ago'`, `publishedAt: '2026-11-10T00:00:00.000Z'`, `normalize(..., { scrapedAt: new Date('2026-11-10T20:32:26.671Z') })` → `record.postedAt === '2026-11-10T12:32:26.671Z'`; same item with no `postedTime` → `postedAt === null`.
  - bebity item → `postedAt === null` (date only).
  - LinkedIn post: if `postedAt.date` carries a time (check the fixtures in `linkedin.spec.ts`), `postedAt` is its exact ISO value; else estimated from `postedAt.postedAgoText` like the job board. Assert whichever the fixture holds.
  - `ats.spec.ts`: Greenhouse `first_published: '2026-10-29T23:30:00-04:00'` → `postedAt === '2026-10-30T03:30:00.000Z'`; Ashby `publishedDate` → exact when it has a time, else `null` (assert per the existing fixture).
  - `merge.spec.ts`: two open sources with `postedAt` `'2026-11-10T12:00:00.000Z'` (LinkedIn) and `'2026-11-09T08:00:00.000Z'` (Ashby) → merged `postedAt === '2026-11-09T08:00:00.000Z'` and `fieldSources.postedAt` is the Ashby raw item; a closed source's `postedAt` is ignored; all null → `null`.
  - Existing specs that call `normalize(channel, payload)` get the context argument.

- [ ] **Step 2: Run** `npx nx test xjobs -- normalize` — Expected: FAIL on the new assertions (and typecheck errors on the missing argument).

- [ ] **Step 3: Implement.** Mappers: cheap_scraper → `postedAtFromAgo(p.postedTime, ctx.scrapedAt, datePart(p.publishedAt))`; bebity → `null`; posts → `exactPostedAt(postedAt.date) ?? postedAtFromAgo(postedAt.postedAgoText, ctx.scrapedAt, publishedAt)`; Greenhouse `exactPostedAt(posting.first_published)`, Ashby `exactPostedAt(posting.publishedDate)`. `merge.ts`: `postedAt` is the minimum non-null over `open` sources (special case beside `kind`/`closed`), `fieldSources.postedAt` that source. Bump `NORMALIZER_VERSION` to 3.

- [ ] **Step 4: Run** `npx nx test xjobs -- normalize` — Expected: PASS.

- [ ] **Step 5: Add the column.** Edit the contract, then `pnpm --filter @xjobs/database db:migration:plan`; apply with `pnpm db:reset`; `pnpm db:types`.
      Expected: a new migration adding nullable `"postedAt" timestamptz(3)` to `normalized_jobs`; `database.types.ts` gains it.

- [ ] **Step 6: Wire the writer.** In `normalizedVersion`, call `normalize(input.channel, raw?.payload, { scrapedAt: raw.firstSeenAt })` (the version's first sighting, the scrape that produced its stored `postedTime`; if `raw` is missing, the existing invalid path stands). In `fieldColumns`, write `postedAt`. Extend the writer's spec: a cheap_scraper version with `firstSeenAt 2026-11-10T20:32:26.671Z` and `postedTime '8 hours ago'` produces a job with `postedAt = 2026-11-10T12:32:26.671Z`. Use the Postgres spec recipe the existing writer tests use.

- [ ] **Step 7: Run** `npx nx test xjobs` and `npx nx run-many -t lint typecheck -p @xjobs/xjobs @xjobs/database` — Expected: PASS.

- [ ] **Step 8: Update the ingest README** (record fields list gains `postedAt`; note the estimate rule and that it needs a renormalize after this version bump).

- [ ] **Step 9: Commit** `feat(ingest): store each job's posted time (NORMALIZER_VERSION 3)`

### Task 3: `job_views` table

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (model `JobView`, two policies), plus the planned migration
- Create: `apps/db-tests/src/job-views.db.spec.ts`
- Modify: `libs/database/src/supabase/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: `seedDetailedJob`, `seedMatchOn`, `cleanupDetailedJobs`, `createTestUser`, `seedProfile`, `publishProfile` from `apps/db-tests/src/support`.
- Produces: table `job_views` (`id Uuid @id @onCreate(uuid(7))`, `userId` → `User` cascade, `jobId` → `NormalizedJob` cascade, `viewedAt TimestamptzJsDate(3) @default(now())`, `@@unique([userId, jobId])`, `@@map("job_views")`, `@@rls`). Policies:
  - `policy_select job_views_owner_read`: `"userId" = auth.uid()`.
  - `policy_insert job_views_owner_insert`: `withCheck = sql\`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = "jobId")\``. No update or delete policy.
  - Comment above the model: `// Jobs a user opened the post or apply link of; the matches view's "Viewed" mark. Written by the user, once per job.`
- Web write (used in Task 7): `supabase.from('job_views').upsert({ userId, jobId }, { onConflict: 'userId,jobId', ignoreDuplicates: true })`.

- [ ] **Step 1: Write the failing tests** in `job-views.db.spec.ts`: users A, B; `job` matched by A only; `other` matched by nobody.
  - `the owner records and reads a view`: A inserts `{userId: A, jobId: job}` → no error; A selects → one row.
  - `a second view of the same job is ignored`: the upsert with `ignoreDuplicates` twice → no error, still one row, `viewedAt` unchanged.
  - `refuses a view of an unmatched job`: A inserts for `other` → error (RLS).
  - `refuses a view for someone else`: A inserts `{userId: B, jobId: job}` → error.
  - `hides other users' views`: B selects → `[]`.
  - `anonymous callers see and write nothing`: anon select → `[]` or error; insert → error.
  - `views go with the job`: delete `job` via `admin()` → the view row is gone.

- [ ] **Step 2: Run** `pnpm db:test -- job-views` — Expected: FAIL (relation does not exist).

- [ ] **Step 3: Edit the contract**, `pnpm --filter @xjobs/database db:migration:plan`, `pnpm db:reset`, `pnpm db:types`.

- [ ] **Step 4: Run** `pnpm db:test -- job-views rls-enabled isolation` — Expected: PASS (the `rls-enabled` check covers the new table).

- [ ] **Step 5: Commit** `feat(db): job_views records the jobs a user opened`

### Task 4: `match_details` for all profiles, with posted and viewed times

**Files:**

- Create: `libs/database/src/migrations/app/<UTC yyyymmddThhmm>_match_details_all_profiles/migration.ts` (plus emitted `ops.json`, `migration.json`)
- Modify: `libs/database/src/migrations/app/refs/db.json`
- Modify: `libs/database/src/supabase/database.types.ts` (regenerated)
- Modify: `apps/db-tests/src/match-details.db.spec.ts`
- Modify: `apps/db-tests/src/support/fixtures.ts` (`seedDetailedJob` gains `postedAt?: string | null`)

**Interfaces:**

- Consumes: Tasks 2 and 3 (column `normalized_jobs."postedAt"`, table `job_views`).
- Produces: `public.match_details(p_profile_id uuid DEFAULT NULL, p_outcome text DEFAULT 'qualified', p_since timestamptz DEFAULT NULL, p_job_id uuid DEFAULT NULL)`. Same columns in the same order, with two new ones: `"postedAt" timestamptz` right after `"publishedAt"`, and `"viewedAt" timestamptz` right after `channels`. `p_profile_id IS NULL` → every profile of `auth.uid()`; `viewedAt` = the caller's `job_views.viewedAt` for the job (left join on `"userId" = auth.uid()`), else null. Everything else unchanged (`match_facts` untouched).

- [ ] **Step 1: Write the failing tests** in `match-details.db.spec.ts` (keep every existing test):
  - `returns all the caller's profiles when no profile is given`: A also has `profileA2` (published); `jobA` is matched by `profileA` and `profileA2`, `jobA2` by `profileA2` only. `rpc('match_details', {})` as A → exactly A's qualified, active, matches across both profiles as `(profileId, jobId)` pairs (two rows for `jobA`, one for `jobA2`, plus the existing `profileA` rows), none of B's.
  - `never returns another user's matches for a null profile`: B, `{}` → only B's rows.
  - `returns the posted time`: `seedDetailedJob({ postedAt: '2026-11-10T12:32:26.671Z' })` → `postedAt` equals it (compare as dates); a job seeded with `postedAt: null` → `null`.
  - `returns the caller's view time only`: A views `jobShared` (insert via A's client) → A's row has `viewedAt` set; B's row for `jobShared` has `viewedAt` null.
  - `exposes only allowed columns`: the allowlist gains `postedAt` and `viewedAt`.

- [ ] **Step 2: Run** `pnpm db:test -- match-details` — Expected: FAIL.

- [ ] **Step 3: Write the migration**, modelled on `20261110T2146_match_details/migration.ts`: same-hash start and end, one `rawSql` op, `id: 'functions.match_details_all_profiles'`, `invariantId: 'match-details-all-profiles'`, `operationClass: 'data'`. Its `execute` runs `DROP FUNCTION public.match_details(uuid, text, timestamptz, uuid)` (the return type changes, so `CREATE OR REPLACE` can't), then the new `CREATE FUNCTION`, then the same `REVOKE`/`GRANT`. Emit `ops.json`/`migration.json` with `node <dir>/migration.ts`; append the invariant to `refs/db.json`.

- [ ] **Step 4: Apply** `pnpm db:reset`, `pnpm db:types`.

- [ ] **Step 5: Run** `pnpm db:test -- match-details job-views engine-tables isolation` — Expected: PASS.

- [ ] **Step 6: Commit** `feat(db): match_details reads all profiles and returns posted and viewed times`

### Task 5: Matches data and wording (web, pure)

**Files:**

- Create: `apps/web/src/lib/matches/load.ts`: the server read
- Create: `apps/web/src/lib/matches/group.ts`: rows → jobs, filters, tabs, sort
- Create: `apps/web/src/lib/matches/freshness.ts`: posted time, age, "New"
- Create: `apps/web/src/lib/matches/checks.ts`: check lines and the not-checked list
- Create: `apps/web/src/lib/matches/sources.ts`: channel labels
- Create: `apps/web/src/lib/matches/view-state.ts`: URL query ↔ state
- Tests: a `.spec.ts` beside each

**Interfaces:**

- Consumes: `match_details` (Task 4) through `Database['public']['Functions']['match_details']['Returns']`; `loadProfileList` / `profileLabels` (`apps/web/src/lib/preferences/profiles.ts`); `preferenceProfiles` pattern in `apps/web/src/app/(app)/preferences/data.ts`. Profiles need `state` too: extend `ProfileListItem` with `state: 'draft' | 'published'` (select it in `loadProfileList`).
- Produces:
  - `type MatchRow = Database['public']['Functions']['match_details']['Returns'][number]`
  - `loadMatches(supabase, opts: { since: Date }): Promise<MatchRow[]>`: one `rpc('match_details', { p_since })` for all profiles (`p_profile_id` omitted); profile filtering happens in `group.ts`, so switching profiles needs no refetch. `loadMatch(supabase, jobId): Promise<MatchRow[]>`: `p_job_id`, null `since`.
  - `type MatchedJob = { jobId: string; rows: MatchRow[] /* one per profile */; postedAt: Date /* effective */; postedExact: boolean; channels: string[]; viewed: boolean; bestStackScore: number | null; unverified: boolean }`
  - `groupByJob(rows: MatchRow[]): MatchedJob[]`: drops `closed`; sorted by `postedAt` desc, then `jobId`.
  - `effectivePostedAt(row): { at: Date; exact: boolean }`: `postedAt` if set, else `publishedAt` 00:00Z with `exact: false`, else `firstSeenAt` with `exact: false`.
  - `isNew(job, now): boolean`: `postedExact && !viewed && now - postedAt <= 12 h`.
  - `postedAge(job, now): string`: "12 min ago", "3 h ago", "2 days ago"; date-only → "Nov 9".
  - `selectJobs(jobs, { tab: '24h' | '7d', profileId: string | 'all', source: string | 'all', now }): MatchedJob[]`: `'24h'` keeps `now - postedAt <= 24 h`; `'7d'` keeps all (the read already applied `lastSeenAt >= now - 7 d`); profile keeps jobs with a row for it; source keeps jobs whose `channels` include it.
  - `sourceOptions(jobs): { value: string; label: string }[]`: the channels present, labelled by `CHANNEL_LABELS = { LINKEDIN_JOB_BOARD: 'LinkedIn', LINKEDIN_POSTS: 'LinkedIn posts', GREEN_HOUSE: 'Greenhouse', ASHBY: 'Ashby' }`.
  - `checkLines(checks: unknown, labels: Labels): { rule: 'position' | 'seniority' | 'location' | 'stack'; mark: 'pass' | 'unknown'; text: string }[]`, built from each check's `outcome` and `reason`, with codes replaced by value-list labels (`fullstack_engineer` → its role label). Unknown rules are skipped.
  - `NOT_CHECKED = ['salary', 'contract type', 'engagement', 'required languages', 'work authorization', 'residence']` and `notCheckedText(): string` → `'Not checked yet: salary, contract type, engagement, required languages, work authorization and residence. Check these in the post.'`. Comment: slices 08 and 09 remove entries as the matcher gains rules.
  - `type ViewState = { tab: '24h' | '7d'; profile: string | 'all'; source: string | 'all'; job: string | null }`, `readViewState(params: URLSearchParams, defaults): ViewState`, `viewStateHref(state): string` (query keys `tab`, `profile`, `source`, `job`; defaults omitted).
  - `defaultProfile(profiles): string | 'all'`: `'all'` when two or more are published, else the published one, else the first draft.

- [ ] **Step 1: Write the failing tests**, one spec per file, with these cases:
  - `freshness.spec.ts`: `now = 2026-11-10T21:00Z`; postedAt `12:32:26Z` exact → `isNew` true, age `'8 h ago'`; postedAt `08:59Z` → `isNew` false (12 h 1 min); exact but viewed → false; date-only `'2026-11-10'` → `isNew` false, age `'Nov 10'`; 30 min → `'30 min ago'`; 2 days → `'2 days ago'`.
  - `group.spec.ts`: two rows (profiles P1, P2) on job J → one `MatchedJob` with `rows.length 2`, `bestStackScore` the higher one (null treated as lowest); a closed job dropped; sort by effective posted time with a date-only job placed at its day's 00:00; `selectJobs` 24h keeps `postedAt` 23 h 59 min ago and drops 24 h 1 min; profile `P2` keeps only jobs with a P2 row; source `ASHBY` keeps a job with `['ASHBY','LINKEDIN_JOB_BOARD']`; `sourceOptions` lists only present channels, labelled.
  - `checks.spec.ts`: the two dev `checks` arrays recorded in the spec's research (the Atos match: position pass `fullstack_engineer`, seniority pass `senior`, location unknown, stack pass 0.713) → 4 lines with marks `pass, pass, unknown, pass`, no raw code (`fullstack_engineer`) in any `text`; an unknown rule `languages` is skipped; `notCheckedText()` exact string above.
  - `view-state.spec.ts`: empty params + defaults `{tab:'24h', profile:'all'}` → defaults; `?tab=7d&profile=p1&source=ASHBY&job=j1` round-trips through `viewStateHref`; a bad `tab=x` → default.
  - `defaultProfile`: two published → `'all'`; one published plus a draft → the published id; only a draft → the draft id.
  - `load.spec.ts` with `apps/web/src/test/fake-supabase.ts`: `loadMatches` calls `rpc('match_details', { p_since: <now - 7 d ISO> })`; an rpc error throws through `loadError`.

- [ ] **Step 2: Run** `npx nx test @xjobs/web -- matches` — Expected: FAIL.

- [ ] **Step 3: Implement** the files to the interfaces above.

- [ ] **Step 4: Run** `npx nx test @xjobs/web -- matches preferences` — Expected: PASS (preferences specs still pass with `state` added).

- [ ] **Step 5: Commit** `feat(web): matches data, freshness and check wording`

### Task 6: Matches page

**Files:**

- Modify: `apps/web/src/app/(app)/page.tsx`: the matches page (server component)
- Create: `apps/web/src/components/matches/matches-view.tsx`: client; list + detail, URL state
- Create: `apps/web/src/components/matches/match-list.tsx`, `match-row.tsx`, `match-detail.tsx`, `match-filters.tsx`, `match-empty.tsx`
- Modify: `apps/web/src/components/layout/app-nav.tsx`: `{ href: '/', label: 'Matches', icon: Briefcase }`
- Tests: `apps/web/src/components/matches/*.spec.tsx`, `app-nav.spec.tsx`

**Interfaces:**

- Consumes: Task 5's functions and types; `profileLabels`; `loadValueLists` for code labels; `components/ui`: `tabs`, `select`, `badge`, `button`, `card`, `separator`, `empty`, `skeleton`, `text` (`TextLink`).
- Produces: `MatchesView({ jobs: MatchedJob[]; profiles: { id: string; label: string; state: 'draft' | 'published' }[]; labels: Labels; initial: ViewState; now: string; selected: MatchRow[] | null })`.

Layout and copy (from the spec and the approved mockup):

- From `md` up: two columns, the list (fixed width, scrolls) and the detail. Below `md`: `job` absent → the list; `job` present → the detail with a "Back to matches" link (`viewStateHref({...state, job: null})`).
- Filters above the list: profile `Select` (shown when the user has more than one profile; "All profiles" first when two or more are published; drafts suffixed " (draft)"), source `Select` ("All sources" + `sourceOptions`), `Tabs` "Last 24 hours (n)" / "Last 7 days (n)".
- Row (a link to `viewStateHref({...state, job})`, `aria-current` when selected): title + `Badge` "New" (`success`) or "Viewed" (`secondary`); `company · location · arrangement` muted; source badge(s) (`outline`), profile badge(s) in "All profiles", "Stack 71%" or "Stack n/a", `Badge` "Unverified" (`warning`), age.
- Detail, in order: title; company (`TextLink` when `companyUrl`), location, "posted ~3 hours ago on LinkedIn" (date-only: "posted Nov 9 on LinkedIn"); `Button` "Open post" (default variant) and "Apply" (outline, only with `applyUrl`) as links with `target="_blank" rel="noopener noreferrer"`; facts list (Role, Seniority + years, Arrangement, Places + time zones, Contract type, Engagement, Salary: "Not stated" when null); tech stack (covered / uncovered / not compared, coverage %); "Why it matched · <profile label>" with `Tabs` per profile when several matched, then `checkLines`; `notCheckedText()`; description as `whitespace-pre-line` text.
- States: no profiles → `Empty` "No profile yet" with a link to setup; selected profile is a draft → `Empty` "This profile isn't live yet" ("It starts matching once it's published."); published but no jobs in the tab → `Empty` "No matches in the last 24 hours" with a button to "Last 7 days" (on the 7d tab: "No matches yet. New jobs are matched as they're collected."); filter with no results → `Empty` with "Clear filters"; `job` param not found → detail pane `Empty` "This job isn't in your matches".

- [ ] **Step 1: Write the failing tests** (Testing Library, like `components/preferences/*.spec.tsx`):
  - `matches-view.spec.tsx`: renders rows in posted order; clicking a row's link targets `?job=<id>` (keeping tab/profile/source); the selected row has `aria-current="true"`; the 24 h tab count and the 7 d tab count match `selectJobs`; source select lists "LinkedIn" only for LinkedIn-only data.
  - `match-row.spec.tsx`: "New" for a fresh exact job; "Viewed" (no "New") when viewed; two profile badges in "All profiles"; "Stack n/a" for a null score; "Unverified".
  - `match-detail.spec.tsx`: "Open post" has `href` = `postingUrl`, `target="_blank"`; no "Apply" without `applyUrl`; "Not stated" for a null salary; the not-checked text; profile tabs appear only when two rows; description keeps line breaks (`whitespace-pre-line` class).
  - `match-empty.spec.tsx` (or inside `matches-view.spec.tsx`): only-draft user → "This profile isn't live yet"; draft + one published → switcher with both, no "All profiles"; empty 24 h tab → button to "Last 7 days"; unknown `job` → "This job isn't in your matches".
  - `app-nav.spec.tsx`: first item is "Matches" at `/`.

- [ ] **Step 2: Run** `npx nx test @xjobs/web -- matches app-nav` — Expected: FAIL.

- [ ] **Step 3: Implement.** `page.tsx`: auth check as today; `Promise.all` of `loadMatches(since = now - 7 d)`, `preferenceProfiles()` (with `state`), `preferenceLists()`; `readViewState(searchParams, { tab: '24h', profile: defaultProfile(profiles) })`; when `job` is set and not in the loaded rows, `loadMatch(jobId)` (empty → the not-found pane). Navigation uses `<Link>` / `router.push` with `viewStateHref`; no client fetches for filtering.

- [ ] **Step 4: Run** `npx nx test @xjobs/web` and `npx nx run-many -t lint typecheck build -p @xjobs/web` — Expected: PASS.

- [ ] **Step 5: Look at it.** `pnpm db:reset`, seed a user via `pnpm users link <email>` plus the Task 8 dataset, `npx nx dev @xjobs/web`, check both themes at desktop and 375 px width.

- [ ] **Step 6: Commit** `feat(web): matches view replaces the home page`

### Task 7: Mark viewed on "Open post" and "Apply"

**Files:**

- Create: `apps/web/src/lib/matches/mark-viewed.ts` (+ `.spec.ts`)
- Modify: `apps/web/src/components/matches/match-detail.tsx`

**Interfaces:**

- Consumes: `createSupabaseBrowserClient` (`apps/web/src/lib/supabase/client.ts`); `job_views` (Task 3).
- Produces: `markViewed(supabase, userId: string, jobId: string): Promise<void>`: the upsert from Task 3; logs errors with `console.error` and never throws. The detail's two links call it `onClick` without `preventDefault` (the new tab opens at once), then `router.refresh()` after it resolves so the row shows "Viewed".

- [ ] **Step 1: Write the failing tests**: `mark-viewed.spec.ts` with the fake client: calls `from('job_views').upsert({userId, jobId}, {onConflict: 'userId,jobId', ignoreDuplicates: true})`; an error resolves (no throw) and logs. `match-detail.spec.tsx`: clicking "Open post" and "Apply" each calls `markViewed` with the job id.

- [ ] **Step 2: Run** `npx nx test @xjobs/web -- mark-viewed match-detail` — Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npx nx test @xjobs/web -- matches` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): opening a job's post or apply link marks it viewed`

### Task 8: Realistic dataset, roadmap, PR and hand-off

**Files:**

- Create (scratchpad, not committed): a SQL seed for the local stack
- Modify: `docs/roadmap/phase-2-find/04-matches-view.md`

- [ ] **Step 1: Seed locally** (`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`): one user, two published profiles and one draft; 400 qualified matches in the last 7 days across both profiles (60 sharing a job), postedAt spread over 7 days (30 in the last 12 h, 10 date-only), channels mixed (LinkedIn job board, 20 Ashby, 10 on two channels), 5 closed, 30 viewed; plus 2,000 older matches outside the window. `ANALYZE`.

- [ ] **Step 2: Check speed.** `EXPLAIN (ANALYZE, BUFFERS)` on `match_details` with a null profile and `p_since = now() - 7 days` (set `request.jwt.claims`): under 100 ms. Load `/` in the dev server: the page renders in under 1 s locally. If either fails, add the index the plan asks for (contract `@@index`, `db:migration:plan`) or paging, and record why. Record the numbers for the PR.

- [ ] **Step 3: Walk the page** against the seeded data: every state from Task 6, both themes, 375 px.

- [ ] **Step 4: Update the roadmap entry**: "New" = posted ≤ 12 h; "Viewed" on open post/apply; "Last 24 hours" / "Last 7 days"; all-profiles and source filter; the posted-time engine change; the "last looked" record dropped.

- [ ] **Step 5: Run** `npx nx run-many -t lint test build typecheck` and `pnpm db:test` — Expected: PASS.

- [ ] **Step 6: Commit** `docs(roadmap): matches view as built`, then `git push -u origin feat/matches-view` and `gh pr create --base main`. The body covers the posted-time rule, `job_views`, the `match_details` change, Step 2's numbers, and a **hand-off** section: after merge and deploy, the human runs `pnpm --filter @xjobs/xjobs db:renormalize` against dev (`XJOBS_ALLOW_REMOTE_DB=1`), then checks on dev that `normalized_jobs."postedAt"` is filled for LinkedIn jobs, and once scheduled collection brings fresh qualified jobs, that "Last 24 hours" and "New" show them.

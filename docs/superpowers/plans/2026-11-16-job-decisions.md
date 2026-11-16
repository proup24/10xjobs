# Job Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user marks a matched job **Applied** or **Not for me** (with an optional reason and note); the job leaves Matches and Review and is listed on a new **Applications** page, where the mark can be changed or undone.

**Architecture:** A new user-owned table `job_decisions` (one row per user and job) with RLS and column-scoped update grants. `match_details` returns the caller's decision status and accepts a null outcome (any). A new `SECURITY DEFINER` RPC `job_decision_list()` lists decided jobs through the decision row, not a current match. Ingest's merge moves decisions to the surviving job (Applied wins) and copies them back when a merged job revives. The web app writes through server actions and `supabase-js` under the user's session. `db:analyze` reports dismiss reasons from a snapshot of the matches taken at dismissal.

**Tech Stack:** Prisma Next contract and migrations, Supabase Postgres (db-tests through `supabase-js`), NestJS engine (Vitest, `*.postgres.spec.ts`), Next.js App Router, `components/ui`, zod, sonner.

**Spec:** `docs/superpowers/specs/2026-11-16-job-decisions-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

## Global Constraints

- The Prisma contract (`libs/database/src/contract/contract.prisma`) is the only schema source, RLS policies included. Functions, grants and other raw SQL go in an app migration as `rawSql` ops (precedents: `20261112T2122_match_details_review/migration.ts`, `20261112T1633_users_update_columns/migration.ts`).
- After `db:migration:plan`, set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`, keep every existing invariant and add each new rawSql `invariantId`. Advancing the ref can write `invariants: []`; re-add them. Verify after `pnpm db:reset` by querying the new table/function directly.
- Functions: `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names, `(SELECT auth.uid())`, `REVOKE … FROM PUBLIC, anon`, `GRANT EXECUTE … TO authenticated`.
- Status values: `applied`, `dismissed`. UI labels: **Applied**, **Not for me**.
- Dismiss reason codes, in this order: `role`, `seniority`, `location`, `stack`, `salary`, `contract`, `languages`, `work_authorization`, `company`, `other`. Labels: Not the role I want, Wrong seniority, Location or arrangement, Tech stack, Salary, Contract type or engagement, Language requirements, Work authorization, The company, Something else.
- Note: trimmed, empty → null, at most 500 characters.
- `reason`, `note` and `matchSnapshot` are null when `status = 'applied'`.
- UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`): no raw `<button>`/`<input>`/`<select>`, no literal colors, no arbitrary values.
- No service role in the web app (`apps/web/src/no-service-role.spec.ts`).
- Log lines carry ids and error codes only.
- Work in the worktree `/home/lab/apps/10xjobs-job-decisions` on `feat/job-decisions` (from `origin/main`). Push only with `git push -u origin feat/job-decisions`; open the PR with `gh pr create --base main`.

## Review Focus

1. **Double-click or two tabs marking the same job at once.** Expected: one row, no error shown; the second write updates it. Test in Task 4 (`retries a unique violation as an update`).
2. **Undo after the job left the 7-day window or stopped qualifying.** Expected: the mark is cleared and the toast says nothing went wrong; the job just doesn't reappear. Test in Task 4 (`clears a decision on a job with no match left`).
3. **A job matched by two profiles, dismissed from "All profiles".** Expected: `matchSnapshot` holds both matches. Test in Task 4.
4. **An Applications job opened by URL whose match is gone** (profile deleted). Expected: the detail shows the job without "Why it matched", not an error page. Test in Task 6.
5. **A note of only spaces, or 501 characters.** Expected: spaces → stored null; 501 → field error on `note`, nothing written. Tests in Task 4.

---

### Task 1: `job_decisions` table, reasons constant, RLS and grants

**Files:**

- Create: `libs/database/src/enums/dismiss-reason.enum.ts`; Modify: `libs/database/src/enums/index.ts`
- Modify: `libs/database/src/contract/contract.prisma` (model `JobDecision`, four policies), plus the planned migration directory under `libs/database/src/migrations/app/`
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)
- Create: `apps/db-tests/src/job-decisions.db.spec.ts`
- Modify: `apps/db-tests/src/support/registry.ts` (add `job_decisions` to `ownedTables`)

**Interfaces:**

- Consumes: `createTestUser`, `seedProfile`, `publishProfile`, `seedDetailedJob`, `seedMatchOn`, `cleanupDetailedJobs`, `admin`, `anon` from `apps/db-tests/src/support`.
- Produces:
  - `export const DISMISS_REASONS = ['role', …, 'other'] as const; export type DismissReason = (typeof DISMISS_REASONS)[number]; export const DISMISS_REASON_LABELS: Record<DismissReason, string>` (values from Global Constraints), exported from `@xjobs/database/enums`.
  - Table `job_decisions`: `id Uuid @id @default(sql\`gen_random_uuid()\`) @onCreate(uuid(7))`, `userId` → `User` cascade, `jobId` → `NormalizedJob` cascade, `status String`, `reason String?`, `note String?`, `decidedAt TimestamptzJsDate(3) @default(now())`, `matchSnapshot Jsonb?`, `+Timestamps`, `@@unique([userId, jobId])`, `@@index([jobId])`, `@@map("job_decisions")`, `@@rls`.
  - Checks: `job_decisions_status` (`status IN ('applied','dismissed')`), `job_decisions_reason` (`reason IS NULL OR reason IN (<the ten codes>)`), `job_decisions_note_length` (`note IS NULL OR char_length(note) <= 500`), `job_decisions_applied_bare` (`status = 'dismissed' OR (reason IS NULL AND note IS NULL AND "matchSnapshot" IS NULL)`).
  - Policies (`authenticated`): `job_decisions_owner_read` select `"userId" = auth.uid()`; `job_decisions_owner_insert` withCheck `"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = job_decisions."jobId")`; `job_decisions_owner_update` using and withCheck `"userId" = auth.uid()`; `job_decisions_owner_delete` using `"userId" = auth.uid()`.
  - A rawSql op in the same migration, `invariantId: 'job-decisions-update-columns'`: `REVOKE UPDATE ON public.job_decisions FROM authenticated, anon; GRANT UPDATE ("status", "reason", "note", "decidedAt", "matchSnapshot", "updatedAt") ON public.job_decisions TO authenticated;`
  - Contract comment above the model: `// A user's own mark on a job: applied, or dismissed ("Not for me") with an optional reason. One per user and job; hides the job from Matches and Review. Users write it; the engine only moves it on merges.`

- [ ] **Step 1: Write the failing tests** in `job-decisions.db.spec.ts`. Users A and B. `job` is matched by A only, `other` by nobody:
  - `the owner marks, reads, changes and clears a decision`: A inserts `{userId: A, jobId: job, status: 'applied'}` → ok; select → 1 row; update to `{status: 'dismissed', reason: 'stack', note: 'Java'}` → ok; delete → ok, 0 rows.
  - `one decision per user and job`: a second insert for (A, job) → error code `23505`.
  - `refuses a decision on an unmatched job`: A inserts for `other` → RLS error.
  - `refuses a decision for someone else`: A inserts `{userId: B, jobId: job}` → error.
  - `still updates after the match is gone`: A inserts; `admin()` deletes A's `job_matches` row; A updates to `dismissed` → ok.
  - `the job and user cannot change`: A updates `{jobId: <another matched job>}` → error (permission denied for column).
  - `applied carries no reason`: insert `{status: 'applied', reason: 'stack'}` → check violation `23514`.
  - `rejects an unknown reason and a note over 500 characters` → `23514` each.
  - `the reason check matches DISMISS_REASONS`: read `pg_get_constraintdef` of `job_decisions_reason` via `withCatalog` and assert every code in `DISMISS_REASONS` appears, and no other quoted value does.
  - `hides other users' decisions`: B selects → `[]`. Anon select → `[]` or error; anon insert → error.
  - `decisions go with the job`: `admin()` deletes `job` → row gone.
  - Add to `ownedTables`: `{ table: 'job_decisions', ownerColumn: 'userId', seed: <service-role insert after seeding a matched job>, insertPayload: <payload for a freshly matched job>, patch: { status: 'dismissed', reason: 'other' }, canDelete: true }`.

- [ ] **Step 2: Run** `pnpm db:test -- job-decisions` — Expected: FAIL (relation does not exist).

- [ ] **Step 3: Write the enum file and edit the contract**, then `pnpm --filter @xjobs/database db:migration:plan`, add the grants rawSql op to the planned `migration.ts` and re-emit with `node <dir>/migration.ts`, advance `refs/db.json`, `pnpm db:reset`, `pnpm db:types`.

- [ ] **Step 4: Run** `pnpm db:test -- job-decisions isolation rls-enabled` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(db): job_decisions records a user's applied or not-for-me mark`

### Task 2: `match_details` decision column and any outcome; `job_decision_list()`

**Files:**

- Create: `libs/database/src/migrations/app/<UTC yyyymmddThhmm>_job_decision_reads/migration.ts` (plus emitted `ops.json`, `migration.json`)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts`
- Modify: `apps/db-tests/src/match-details.db.spec.ts`; Create: `apps/db-tests/src/job-decision-list.db.spec.ts`

**Interfaces:**

- Consumes: Task 1's table.
- Produces:
  - `public.match_details(...)`: same parameters and columns as `20261112T2122_match_details_review`, plus `"decisionStatus" text` appended last (the caller's `job_decisions.status` for `m."jobId"`, LEFT JOIN on `"userId" = (SELECT auth.uid())`; null when none). `p_outcome IS NULL` means any effective outcome: both outcome predicates become `(p_outcome IS NULL OR …)`. The function does not filter decided jobs; callers do.
  - `public.job_decision_list()` returns `TABLE("jobId" uuid, status text, reason text, note text, "decidedAt" timestamptz, kind text, title text, "companyName" text, location text, "publishedAt" text, "postedAt" timestamptz, closed boolean, "postingUrl" text, "applyUrl" text, channels text[], "hasMatch" boolean)`. It reads `job_decisions d JOIN normalized_jobs j ON j.id = d."jobId"` with `WHERE d."userId" = (SELECT auth.uid())`, ordered by `d."decidedAt" DESC, d."jobId"`. `closed` uses the same expression as `match_details`, `channels` the same subquery, and `hasMatch` is `EXISTS` on the caller's `job_matches` for the job. There is no `j.status` filter: merges move the decision (Task 3).
  - One migration, two rawSql ops: `invariantId: 'match-details-decisions'` (DROP + CREATE + REVOKE/GRANT, header comment copied from the review migration and extended), and `invariantId: 'job-decision-list'`.

- [ ] **Step 1: Write the failing tests.**
  - `match-details.db.spec.ts`, `returns the caller's decision status only`: A marks `jobShared` applied → A's rows have `decisionStatus: 'applied'`; B's row for `jobShared` has `decisionStatus: null`.
  - `match-details.db.spec.ts`, `returns any outcome for a null outcome`: `rpc('match_details', { p_job_id: rejectedJob, p_outcome: null })` as A → the rejected row; with the default → `[]`.
  - Update the allowlist test with `decisionStatus`.
  - `job-decision-list.db.spec.ts`:
    - `lists the caller's decisions newest first`: A marks `j1` applied, then `j2` dismissed with `stack` → `[j2, j1]` with `status` and `reason`.
    - `keeps a job whose match is gone`: delete A's match on `j1` via `admin()` → `j1` still listed, `hasMatch: false`.
    - `keeps a closed job`: set `j1.closed = true` → listed with `closed: true`.
    - `returns nothing for another user or anon`.

- [ ] **Step 2: Run** `pnpm db:test -- match-details job-decision-list` — Expected: FAIL.

- [ ] **Step 3: Write the migration**, emit with `node <dir>/migration.ts`, add both invariants to `refs/db.json`, `pnpm db:reset`, `pnpm db:types`.

- [ ] **Step 4: Run** `pnpm db:test -- match-details job-decision-list match-reviews isolation` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(db): match_details returns the user's decision; job_decision_list lists decided jobs`

### Task 3: Decisions follow merges and revivals in ingest

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`linkJob`: the merge branch near `status: 'merged', mergedIntoId: job.id`, and the revive branch `else if (job.status === 'merged')`)
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (`describe('normalized jobs')`), add `job_decisions` to the `TRUNCATE` lists

**Interfaces:**

- Consumes: Task 1's table, through `tx.raw.sql` as in `companies.writer.ts`.
- Produces: `async function moveDecisions(tx, fromJobId: string, toJobId: string): Promise<void>` and `async function copyDecisionsBack(tx, fromJobId: string, toJobId: string): Promise<void>`, both private to `jobs.writer.ts`.
  - `moveDecisions`: for each user with a row on `from`, keep on `to` the winner of the two rows. `applied` beats `dismissed`; otherwise the newer `decidedAt` wins, and on a tie `to`'s row wins. Delete the loser and the `from` row. One `INSERT … SELECT … ON CONFLICT ("userId","jobId") DO UPDATE … WHERE <from wins>` followed by `DELETE … WHERE "jobId" = from`.
  - `copyDecisionsBack`: `INSERT INTO job_decisions ("userId","jobId",status,reason,note,"decidedAt","matchSnapshot") SELECT … FROM job_decisions WHERE "jobId" = from ON CONFLICT DO NOTHING`.
  - Call `moveDecisions(tx, old.id, job.id)` right after `old` is set to merged. In the revive branch, call `copyDecisionsBack(tx, job.mergedIntoId, job.id)` before clearing `mergedIntoId`.

- [ ] **Step 1: Write the failing tests**, seeding a user and a decision with `db.raw` inserts (users row plus a `job_decisions` row; the engine connection bypasses RLS):
  - `moves a decision with the job it merged into`: reuse the setup of `moves an item whose apply URL appears later, merging its old job`; a dismissed row on `old` → after the merge, one row on `moved` with the same reason, none on `old`.
  - `keeps applied when an applied and a dismissed job merge`: `old` applied at t1, `moved` dismissed at t2 > t1 → `moved` ends `applied`.
  - `keeps the newer of two dismissals`: both dismissed, `old` newer → `moved` has `old`'s reason.
  - `copies the decision back to a merged job that revives`: after the merge, bring a source back to `old` (the existing `re-merges the old job…` setup) → `old` is `active` with a copy of the row, and `moved` still has its own.

- [ ] **Step 2: Run** `PROCESSOR_TEST_DATABASE_URL=… npx vitest run apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts -t "decision"` (disposable DB per the processor_test recipe, migrated with Tasks 1–2) — Expected: FAIL.

- [ ] **Step 3: Implement** `moveDecisions` and `copyDecisionsBack` and wire them in.

- [ ] **Step 4: Run** the whole `raw.postgres.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(ingest): a user's job decision follows merges and revivals`

### Task 4: Decision writes (web lib and server actions)

**Files:**

- Create: `apps/web/src/lib/applications/decide.ts`, `apps/web/src/lib/applications/decide.spec.ts`
- Modify: `apps/web/src/app/(app)/actions.ts`, `apps/web/src/app/(app)/actions.spec.ts`

**Interfaces:**

- Consumes: `DISMISS_REASONS` from `@xjobs/database/enums`; `SaveResult`, `FAILED`, `SAVED`, `failure`, `fieldErrors`, `logger`, `Deps` from `@/lib/setup/save-result` (as in `lib/matches/review.ts`).
- Produces:
  - `export const Decision = z.discriminatedUnion('status', [z.object({ jobId: z.uuid(), status: z.literal('applied') }), z.object({ jobId: z.uuid(), status: z.literal('dismissed'), reason: z.enum(DISMISS_REASONS).optional(), note: z.string().trim().max(500).optional() })])`
  - `export const NOT_MATCHED = "This job isn't in your matches."`
  - `export async function saveDecision(supabase, userId: string, input: unknown, deps?: Deps): Promise<SaveResult>`. It parses the input, then on `dismissed` reads `job_matches` (`profileId, outcome, matcherVersion, checks`) for the job as the user and builds `matchSnapshot`. It then reads the existing row's `status`. If a row exists, it updates `status`, `reason`, `note` (empty → null) and `matchSnapshot`, and sets `decidedAt: new Date().toISOString()` only when the status changed. If no row exists, it inserts. An insert refused by RLS → `{ status: 'invalid', errors: { _form: NOT_MATCHED } }`. A `23505` from the insert → retry once as the update. On `applied` it writes `reason`, `note` and `matchSnapshot` as null.
  - `export async function clearDecision(supabase, jobId: unknown, deps?: Deps): Promise<SaveResult>`. It deletes by `jobId` (RLS scopes it to the user). Deleting a missing row is `SAVED`.
  - Actions in `actions.ts`, shaped like `decideReviewAction`: `export async function decideJobAction(input: unknown): Promise<SaveResult>`, `export async function clearJobDecisionAction(jobId: unknown): Promise<SaveResult>`.

- [ ] **Step 1: Write the failing tests** in `decide.spec.ts` with the fake client style of `lib/matches/review.spec.ts`:
  - `inserts an applied mark for a matched job`
  - `stores a dismissal with reason, trimmed note and a snapshot of every match`: two matches → `matchSnapshot` has 2 entries with `profileId`, `outcome`, `matcherVersion`, `checks`.
  - `stores a note of only spaces as null`
  - `refuses a 501-character note with a field error and writes nothing`
  - `refuses an unknown reason`
  - `updates an existing row and moves decidedAt only when the status changes`: dismissed → dismissed with a new reason keeps `decidedAt`; dismissed → applied sets it and nulls reason, note and snapshot.
  - `retries a unique violation as an update`
  - `answers NOT_MATCHED when the insert is refused`
  - `clears a decision on a job with no match left` → `SAVED`.
  - In `actions.spec.ts`, `decideJobAction` and `clearJobDecisionAction` return `FAILED` without a session.

- [ ] **Step 2: Run** `npx nx test web -- decide actions` — Expected: FAIL.

- [ ] **Step 3: Implement** `decide.ts` and the two actions.

- [ ] **Step 4: Run** `npx nx test web -- decide actions` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): save and clear a job decision`

### Task 5: Matches leaves out decided jobs and gets the two actions

**Files:**

- Modify: `apps/web/src/app/(app)/page.tsx`, `apps/web/src/lib/matches/group.ts` (+ `group.spec.ts`)
- Create: `apps/web/src/components/matches/dismiss-dialog.tsx` (+ `.spec.tsx`)
- Modify: `apps/web/src/components/matches/match-detail.tsx` (+ `.spec.tsx`), `apps/web/src/components/matches/matches-view.tsx` (+ `.spec.tsx`)

**Interfaces:**

- Consumes: Task 2's `decisionStatus` on `MatchRow`; Task 4's `decideJobAction`, `clearJobDecisionAction`, `DISMISS_REASON_LABELS`.
- Produces:
  - `export function undecidedRows(rows: MatchRow[]): MatchRow[]` in `group.ts`, which drops rows whose `decisionStatus` is non-null. `page.tsx` applies it to both the qualified and the review rows before `publishedRows`/`groupByJob`, so the counts leave decided jobs out.
  - `DismissDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange(o: boolean): void; onConfirm(v: { reason?: DismissReason; note?: string }): Promise<boolean> })`. It is built from `dialog`, `select` (first item "No reason", value `''`), `textarea` and `button`. The confirm button reads **Not for me**, then **Cancel**. A `false` from `onConfirm` keeps it open.
  - `MatchDetail` gains `onDecide?: (status: 'applied' | 'dismissed', extra?: { reason?: DismissReason; note?: string }) => Promise<boolean>`. With it, the buttons **Applied** and **Not for me** render on a row below **Open post**/**Apply**. They show on Matches rows only, not on undecided review rows.
  - `MatchesView`: after a successful decision, it selects the next job in the current filtered list (or none at phone width), calls `router.refresh()`, and toasts `Moved to Applications` with action **Undo**, which calls `clearJobDecisionAction(jobId)` and refreshes. A refused save toasts `errors._form` or "Couldn't save. Try again.".

- [ ] **Step 1: Write the failing tests.**
  - `group.spec.ts`, `undecidedRows drops decided jobs`.
  - `dismiss-dialog.spec.tsx`: `confirms with no reason`, `confirms with a reason and a note`, `stays open when saving fails`.
  - `match-detail.spec.tsx`: `shows Applied and Not for me on a match`, `hides them on a review row`, `Applied calls onDecide('applied')`, `Not for me opens the dialog`.
  - `matches-view.spec.tsx`: `selects the next job after marking one applied`, `offers Undo in the toast`.

- [ ] **Step 2: Run** `npx nx test web -- group dismiss-dialog match-detail matches-view` — Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npx nx lint web`.

- [ ] **Step 5: Commit** `feat(web): mark a match applied or not for me`

### Task 6: Applications page

**Files:**

- Create: `apps/web/src/app/(app)/applications/page.tsx`, `apps/web/src/lib/applications/load.ts` (+ `.spec.ts`), `apps/web/src/lib/applications/view-state.ts` (+ `.spec.ts`), `apps/web/src/components/applications/applications-view.tsx` (+ `.spec.tsx`), `apps/web/src/components/applications/decision-row.tsx`
- Modify: `apps/web/src/components/layout/app-nav.tsx` (+ its spec, if one asserts `NAV_ITEMS`), `apps/web/src/lib/matches/load.ts`

**Interfaces:**

- Consumes: Task 2's `job_decision_list` and `match_details` with `p_outcome: null`; Task 4's actions; Task 5's `DismissDialog`; `MatchDetail`, `BackLink` and the list/detail layout from `components/matches`.
- Produces:
  - `NAV_ITEMS` gains `{ href: '/applications', label: 'Applications', icon: <a lucide icon, e.g. ClipboardCheck> }` between Matches and Preferences.
  - `export type DecisionRow = Database['public']['Functions']['job_decision_list']['Returns'][number]` and `export async function loadDecisions(supabase): Promise<DecisionRow[]>` in `lib/applications/load.ts`.
  - `loadMatch(supabase, jobId, outcome: ListOutcome | null = 'qualified')`: a null outcome passes `p_outcome: null`.
  - `export type AppView = { status: 'applied' | 'dismissed'; job: string | null }`, plus `readAppView(params)` and `appViewHref(v)`. The URL is `?status=dismissed&job=<id>`, and the default `applied` is left out.
  - The page renders a two-way switch (`tabs` or `toggle-group`, per `DESIGN.md`) labelled **Applied** / **Not for me** with counts, then the rows of that status. Each row has the title, company · place, source badges, `Applied 2 days ago` or `Not for me · <reason label> · 3 days ago`, and a **Closed** badge.
  - The detail uses `MatchDetail` with the rows from `loadMatch(…, null)` when `hasMatch`. Otherwise it shows a job-only header (title, company, links), with no "Why it matched". Below it, the actions: on Applied, **Move to Not for me** and **Move back to Matches**. On Not for me, the reason and note, **Edit reason** (opens `DismissDialog` prefilled), **Mark applied** and **Move back to Matches**. The last one asks in a `confirm-dialog`: "Move back to Matches? It shows there again only if it still matches and was seen in the last 7 days."
  - Empty states (`empty`): "Jobs you mark applied show here" and "Jobs you mark not for me show here".

- [ ] **Step 1: Write the failing tests.**
  - `view-state.spec.ts`: round-trip, unknown status → `applied`.
  - `load.spec.ts`: `loadDecisions` calls `rpc('job_decision_list')` and throws `loadError` on error; `loadMatch` with null sends `p_outcome: null`.
  - `applications-view.spec.tsx`: `lists applied jobs by default with counts on both switches`, `shows the reason on a not-for-me row`, `shows Closed on a closed job`, `shows the job without Why it matched when its match is gone`, `Move back to Matches asks first, then clears`, `Edit reason saves the new reason`, `shows the empty state for each status`.
  - App nav spec: `lists Matches, Applications, Preferences in that order`.

- [ ] **Step 2: Run** `npx nx test web -- applications app-nav load` — Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the same command, then `npx nx run-many -t lint typecheck -p web` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): Applications page lists applied and not-for-me jobs`

### Task 7: `db:analyze` dismiss reasons

**Files:**

- Modify: `apps/xjobs/src/scripts/analyze-matches.ts` (a new section appended to `SECTIONS`)

**Interfaces:**

- Consumes: `job_decisions.matchSnapshot` (`[{ profileId, outcome, matcherVersion, checks }]`, where `checks` is the `job_matches.checks` array of `{ rule, outcome, … }`).
- Produces: section `'12. "Not for me" reasons (last 30 days)'`, one row per reason (`coalesce(reason, 'none')`) with `jobs`, `unknownOnRule`, `passOnRule` and `noSnapshot`. The rule map is `role→position`, `seniority→seniority`, `location→location`, `stack→stack`, `salary→salary,currency`, `contract→contractType`, `languages→languages,postingLanguage` and `work_authorization→workAuthorization`. `company` and `other` have no rule, so their counts are null. A job counts in `unknownOnRule` when any snapshot entry with `outcome = 'qualified'` has a check on a mapped rule with `outcome = 'unknown'`.

- [ ] **Step 1: Write the section**: a SQL `VALUES` list for the map, `jsonb_array_elements` over the snapshot and then over `checks`.

- [ ] **Step 2: Run** against the local stack with two seeded dismissals (one `stack` whose snapshot has the stack check `unknown`, one with `reason` null): `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter @xjobs/xjobs db:analyze`. Expected: section 12 shows `stack` with `unknownOnRule: 1` and `none` with `jobs: 1`.

- [ ] **Step 3: Commit** `feat(scripts): db:analyze reports not-for-me reasons`

### Task 8: Seed, roadmap, check and PR

**Files:**

- Modify: `libs/database/src/seeds/` (the dev seed that creates matches: add two applied jobs, two dismissed jobs (one with a reason and note, one without), one closed applied job, and one applied job whose profile was deleted)
- Modify: `docs/roadmap/README.md` (under Phase 5: "Jobs can already be marked applied or not for me ([job decisions](../superpowers/specs/2026-11-16-job-decisions-design.md)).")

- [ ] **Step 1: Seed**, then `pnpm db:reset`.

- [ ] **Step 2: Check in the app** (`run` skill or `npx nx dev web`) at desktop width and at 360px. Mark a job Applied, Undo it, mark it Not for me with a reason, find it on Applications, edit the reason, Move back to Matches. Open the seeded job whose profile was deleted.

- [ ] **Step 3: Run** `npx nx run-many -t lint test build typecheck` and `pnpm db:test` — Expected: all pass.

- [ ] **Step 4: Commit** `chore: seed job decisions and note them in the roadmap`, then push with `git push -u origin feat/job-decisions` and `gh pr create --base main`. The PR body lists the post-merge step: the migrations apply on `10xjobs-dev` through the usual deploy.

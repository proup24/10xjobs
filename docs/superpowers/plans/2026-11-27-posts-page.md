# Social Posts Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give post role matches their own `/posts` page (Matches, Review, Disqualified, Junk), let a user rescue a post by hand for themselves only, show "Email pending" on emailable posts, add per-user blocked authors in Preferences and on posts, and send post matches to webhooks (held while Email pending).

**Architecture:** All post reads are new `SECURITY DEFINER` RPCs over the engine-only tables, written as hand-made `rawSql` migrations. The list rows still come from `match_details` with `p_kind => 'post_role'`. A new user-owned table `post_rescues` records each rescue, and it is also the report; it is written only through RPCs. The web app gets a `/posts` route that reuses the matches list, filters and detail components, plus a post section. The engine's webhook enqueue and payload learn about post roles last, so nothing leaks before the page exists.

**Tech Stack:** Next.js (App Router) web app in `apps/web`, Supabase Postgres, Prisma-next contract and hand-written `rawSql` migrations in `libs/database`, `apps/db-tests` for RLS and RPCs, the NestJS engine in `apps/xjobs`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-posts-page-design.md`

## Global Constraints

- **PRs.** Ship as five PRs to `main`, in order:
  - **PR A** (Tasks 1–2): the database.
  - **PR B** (Tasks 3–5): the read-only posts page.
  - **PR C** (Tasks 6–7): rescues.
  - **PR D** (Tasks 8–9): blocked authors.
  - **PR E** (Tasks 10–11): webhooks and the lifted filters.

  PR A branches from `docs/phase-4-slice-04a-posts-page`, so it carries the spec and plan commits. Each later PR branches from `main` after the one before it merges.

- **Deploy gate.** Nothing in this plan deploys before slice 04 (#139, #147, #149) is deployed and rolled out on dev, and slice 04 itself waits on the credits and capacity fix. Put this line at the top of every PR body.
- **Migrations.**
  - Tables, checks, indexes and RLS go in `libs/database/src/contract/contract.prisma`.
  - Functions, triggers and grants are `rawSql` operations in a hand-written `libs/database/src/migrations/app/<stamp>_<name>/migration.ts`. Use `20261126T1900_job_link_group` as the pattern; each op has its own `invariantId`. To change a function, copy its latest definition into the new migration.
  - After each migration, advance `libs/database/src/migrations/app/refs/db.json` to the new hash, re-add every earlier invariant plus the new ones (the ref rewrite drops them), then run `pnpm db:reset` and `pnpm db:types`. CI diffs `database.types.ts`.
- **Function hygiene.** Every new function is `SECURITY DEFINER SET search_path TO ''`, plpgsql when it is called per row.
  - Helpers are revoked from `PUBLIC`, `anon` and `authenticated`.
  - RPCs the web calls are granted to `authenticated` only and read `auth.uid()`; they never take a user id.
- **Webhooks.** No post role may reach `webhook_enqueue_match` before PR E. PRs A–D leave its `j.kind = 'job'` filter as it is.
- **Matcher.** No `MATCHER_VERSION` bump and no matcher change: the matcher never reads `post_rescues`.
- **UI.** UI follows `apps/web/DESIGN.md` and uses only `components/ui` and theme tokens. Copy, verbatim:
  - The switch reads `Job board` / `Social posts`.
  - The tabs read `Matches (n)`, `Review (n)`, `Disqualified (n)`, `Junk (n)`.
  - Badges read `Email pending`, `Rescued`, `Unverified`.
  - Buttons read `Rescue`, `Undo rescue`, `Block`, `Unblock <name>`.
  - The age line reads `Posted N days ago`.
  - The linked-copy lines read `Also on the job board` and `Also posted by <author>`.
- **Test commands.**
  - db-tests: `pnpm db:test`, which needs the local stack migrated and seeded.
  - Web: `npx vitest run --config apps/web/vitest.config.mts <file>`.
  - Engine: `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts <path>`.
  - CI: `npx nx affected -t lint test build typecheck`.

## Review Focus

1. **A rescue must change nothing for another user.** A second user whose search found the same junk post still sees it in their Junk tab, and the rescue never shows in their Matches. Test: Task 1, `post-rescues.db.spec.ts`, "another user's Junk is unchanged".
2. **The post-deploy rematch must not fire old post webhooks.** The cutoff reads `job_matches."createdAt"`. If a rematch deletes and re-inserts rows instead of updating them, every old role looks new. Test: Task 10. Re-deciding a pre-cutoff `post_role` match through the matcher's real upsert keeps `createdAt`, and the enqueue returns null.
3. **A pasted LinkedIn link must give the key ingest uses.** That covers trailing slashes, `?utm…`, `www.` or a country subdomain, mixed case, a URL-encoded id, and no scheme. Test: Task 8, `parseAuthorLink` cases.
4. **An Email pending post approved from Review must get no delivery, and a post whose verdict is unsure is never Email pending, even when approved.** Tests: Task 2 (`post_email_pending`) and Task 10 (the review trigger path).
5. **Junk attribution through a share.** A post found only through its original's raw item counts; a sighting with a null `queryId` counts for nobody; another user's profile's sighting doesn't count. Test: Task 2, `post-junk-list.db.spec.ts`.

---

## PR A: database

### Task 1: Blocked-author fixes, `post_rescues`, decisions on rescued jobs

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`:
  - `BlockedAuthor.id` gets `@default(sql\`gen_random_uuid()\`)`
  - a new `PostRescue` model and its select policy
  - the `job_decisions_owner_insert` policy
- Create: `libs/database/src/migrations/app/<stamp>_post_rescues/` (plan it with `pnpm --filter @xjobs/database db:migration:plan`, then add the `rawSql` ops)
- Modify: `refs/db.json`, `database.types.ts`
- Test:
  - `apps/db-tests/src/blocked-authors.db.spec.ts`
  - `apps/db-tests/src/post-rescues.db.spec.ts` (new)
  - `apps/db-tests/src/job-decisions.db.spec.ts`

**Interfaces:**

- Produces: an insert into `blocked_authors` without `id` works. A `BEFORE INSERT` trigger `blocked_authors_lower_key` sets `NEW."authorKey" = lower(NEW."authorKey")` (invariant `blocked-authors-lower-key`).
- Produces: table `post_rescues`:
  - Columns:
    - `id uuid` (DB default `gen_random_uuid()`)
    - `userId uuid` → users, cascade
    - `jobId uuid` → normalized_jobs, cascade
    - `origin text`, with check `origin IN ('junk','disqualified')`
    - `snapshot jsonb`
    - `note text null`, with check `char_length(note) <= 500`
    - `undoneAt timestamptz null`
    - timestamps
  - Indexes: a partial unique index `(userId, jobId) WHERE "undoneAt" IS NULL`, plus `index(userId)` and `index(createdAt)`.
  - RLS: owner select only. No insert, update or delete policy: writes go through the RPCs.
- Produces: `post_rescue(p_job_id uuid, p_note text DEFAULT NULL) RETURNS uuid`, granted to `authenticated`.
  - It raises `not rescuable` unless the job is in the caller's Junk or Disqualified tab at that moment:
    - a `kind='post'` job that `post_junk_list` (Task 2) would return for the caller, or
    - a `kind='post_role'` job with a `rejected` `job_matches` row of the caller's.
  - For a job that already has a live rescue, it returns the existing id.
  - Snapshot, junk: `{verdict: {value, confidence, reason}, extractionId}`.
  - Snapshot, disqualified: `{profiles: [{profileId, matchId, matcherVersion, failed: <checks with outcome 'fail'>}], extractionId}`.

  Task 1 lands it with the Disqualified branch only. Task 2 adds the Junk branch once `post_junk_list` exists, by redefining the function in its own migration.

- Produces: `post_rescue_undo(p_job_id uuid) RETURNS void`, granted to `authenticated`.
  - It sets `undoneAt = now()` on the caller's live rescue.
  - It raises `decided` when `group_decision_status(auth.uid(), p_job_id)` is not null.
- Produces: `job_decisions_owner_insert` also passes when `EXISTS (SELECT 1 FROM public.post_rescues r WHERE r."userId" = auth.uid() AND r."jobId" = job_decisions."jobId" AND r."undoneAt" IS NULL)`.

- [ ] **Step 1: Write the failing db-tests.**
  - `blocked-authors.db.spec.ts`:
    - inserting with no `id` and `authorKey: 'profile:Jane-DOE'` stores `profile:jane-doe`;
    - inserting `profile:jane-doe` again for the same user then fails on the unique index.
  - `post-rescues.db.spec.ts`. Seed user A with a profile, a `post_role` job, and a `rejected` match whose checks fail `seniority`.
    - `post_rescue(job)` returns an id, and A reads the row with `origin = 'disqualified'` and `snapshot.profiles[0].failed[0].rule = 'seniority'`.
    - A second call returns the same id.
    - User B can't read A's row, and `post_rescue(job)` as B raises `not rescuable`.
    - A direct insert into `post_rescues` as A is refused.
    - `post_rescue` on a job where A's match is `qualified` raises `not rescuable`.
    - After `post_rescue_undo`, the row has `undoneAt`, and `post_rescue` creates a new row.
  - `job-decisions.db.spec.ts`: user A, with a live rescue on a post job and no match, inserts an `applied` decision on it. An insert on a job with no match whose rescue was undone is refused.
  - `post_rescue_undo` after an `applied` decision raises `decided`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm db:test -- blocked-authors post-rescues job-decisions`. Expected: FAIL.
- [ ] **Step 3: Write the contract changes and the migration.** Use invariant ids `blocked-authors-lower-key`, `post-rescue-rpcs` and `job-decisions-insert-rescued` (if the policy is emitted from the contract, it needs no op). Then advance `refs/db.json` and run `pnpm db:reset` and `pnpm db:types`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm db:test`. Expected: all PASS, including `rls-enabled` and `isolation`.
- [ ] **Step 5: Commit.** Message: `feat(database): post rescues, blocked author key defaults, decisions on rescued jobs`.

### Task 2: Post reads

**Files:**

- Create: `libs/database/src/migrations/app/<stamp>_post_reads/`
- Modify: `refs/db.json`, `database.types.ts`
- Test:
  - `apps/db-tests/src/post-email-pending.db.spec.ts`
  - `apps/db-tests/src/post-junk-list.db.spec.ts`
  - `apps/db-tests/src/post-details.db.spec.ts`
  - `apps/db-tests/src/post-rescue-list.db.spec.ts`

  All four are new.

**Interfaces** (invariant `post-reads`):

- **Helper: `post_role_contact_email(p_job uuid) RETURNS text`.** It reads the parent post's current extraction (`docType='post'`), takes the `data->'roles'` element whose `roleKey` equals the role job's `roleKey`, and returns `howToApply->>'email'`. It returns null when any of those is missing.
- **Helper: `post_email_pending(p_user uuid, p_job uuid) RETURNS boolean`.** It is true only when all of these hold:
  - the job is `kind='post_role'`, active, and not archived;
  - the user has a published profile whose match on it is qualified _after reviews_: `outcome='qualified'`, or `outcome='review'` with the latest applying `match_reviews.choice='qualified'`. Copy the overlay rule from `match_details`' `reviewChoice`;
  - the parent post's verdict is `hiring` with `confidence='sure'`;
  - `post_role_contact_email` is not null;
  - there is no live rescue by the user;
  - `group_decision_status(p_user, p_job)` is null.

  Slice 05 extends this function.

- **RPC: `post_list_extras(p_job_ids uuid[])`**, granted to `authenticated`. It returns `TABLE(jobId uuid, emailPending boolean, applyKinds text[], authorName text, authorUrl text, authorKey text, rescued boolean)`, for the jobs in the array the caller has a match or a live rescue on. The author is the original's for a share, else the post's (the same rule as `originalAuthorOf`).
- **RPC: `post_junk_list(p_since timestamptz)`**, granted to `authenticated`. It returns `TABLE(jobId uuid, profileIds uuid[], verdict text, confidence text, reason text, postingUrl text, postedAt timestamptz, firstSeenAt timestamptz, authorName text, authorUrl text, authorKey text, text text)`.
  - It lists the active `kind='post'` jobs, `processingStatus='processed'`, whose current post extraction's verdict is `not_hiring` or `junk`, with `firstSeenAt >= p_since`.
  - `profileIds` holds the caller's published profiles with `postSearch` on that found the post. A profile found it when one of its `profile_query_search_builders.queryId` matches a `raw_item_sightings.queryId` of any `normalized_job_sources` raw item of the post job.
  - Rows with no such profile are dropped, and so are rows with a live rescue by the caller.
  - Rows are also dropped when any author key in `postSources` (the original's or a sharer's) is on the caller's `blocked_authors`.
  - `text` is the post job's `descriptionText`. The list is ordered `firstSeenAt DESC`.
- **RPC: `post_details(p_job_id uuid)`**, granted to `authenticated`. It returns a single row, or none when the caller has neither a match nor a live rescue on the job, nor a Junk row for it: `(jobId uuid, kind text, postJobId uuid, postingUrl text, postedAt timestamptz, verdict jsonb, howToApply jsonb, authorRelation text, sources jsonb, emailPending boolean, rescue jsonb, linked jsonb)`.
  - `sources` is the post job's `postSources->'sources'`.
  - `howToApply` and `authorRelation` come from the role's entry in the post document, and are null for a post job.
  - `rescue` is `{origin, createdAt, note}` or null.
  - `linked` is `[{jobId, kind, title, authorName}]`: the other jobs of `job_link_group(p_job_id)` that the caller has a match on.
- **RPC: `post_rescue_list()`**, granted to `authenticated`. It returns `TABLE(jobId uuid, kind text, origin text, profileIds uuid[], title text, companyName text, postingUrl text, postedAt timestamptz, firstSeenAt timestamptz, authorName text, decisionStatus text)`.
  - It covers the caller's live rescues, minus any whose post has an author on the caller's `blocked_authors`.
  - `profileIds`: for a disqualified rescue, the profiles with a rejected match on the job; for a junk rescue, the finding profiles, by the rule above.
  - `decisionStatus` is `group_decision_status(auth.uid(), jobId)`.
- **RPC: `group_decision_job(p_job_id uuid) RETURNS uuid`**, granted to `authenticated`. It returns the job in `job_link_group(p_job_id)` that holds the caller's winning decision, with the same precedence as `group_decision_status`.
- **Change:** redefine `post_rescue` (Task 1) so its junk branch accepts a post job that `post_junk_list(now() - interval '30 days')` returns for the caller.

- [ ] **Step 1: Write the failing db-tests.**
  - `post-email-pending`:
    - It is true for a qualified role whose parent verdict is `hiring`/`sure` and whose role entry has `howToApply.email`.
    - It is false when there is no email, when the verdict is `unsure` even with an approved review, when the role is rescued, and when a linked listing has an `applied` decision.
    - It is true for a `review` match approved with `match_reviews.choice='qualified'` on a sure verdict.
  - `post-junk-list`. Seed: a `junk` post found by A's profile P1 query; a share whose original raw item was sighted by P1's query; a sighting with `queryId` null; a post sighted only by user B's query; and a `not_hiring` post whose sharer is on A's block list.
    - A sees the first two, with `profileIds = {P1}`.
    - A doesn't see the null-query post, B's post, or the blocked one.
    - After A rescues the first, it is gone from A's list but still in B's (when B's query also found it).
  - `post-details`: a role row returns its `howToApply`, its `sources` and its `linked` listing. A stranger gets no row.
  - `post-rescue-list`: it returns a disqualified rescue with its profiles. When the original author is blocked, the row is hidden, and unblocking brings it back.
  - `post_rescue` on a Junk post succeeds with `origin='junk'` and the verdict in `snapshot`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm db:test -- post-`. Expected: FAIL.
- [ ] **Step 3: Write the migration** with the functions and grants above. Then advance `refs/db.json` and run `pnpm db:reset` and `pnpm db:types`.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm db:test`. Expected: all PASS.
- [ ] **Step 5: Commit.** Message: `feat(database): post reads for the social posts page`.

---

## PR B: read-only posts page

### Task 3: Posts view state and loaders

**Files:**

- Create: `apps/web/src/lib/posts/view-state.ts` and `apps/web/src/lib/posts/load.ts`, with specs alongside them
- Modify: `apps/web/src/lib/matches/load.ts`: `loadMatches` and `loadMatch` take a `kind`

**Interfaces:**

- Produces in `lib/matches/load.ts`:
  - `ListOutcome = 'qualified' | 'review' | 'rejected'`
  - `loadMatches(supabase, opts: { since: Date; outcome: ListOutcome; kind?: 'job' | 'post_role' | null })`, where `kind` defaults to `'job'` and is passed as `p_kind`
  - `loadMatch(supabase, jobId, outcome, kind: 'job' | 'post_role' | null = 'job')`

  Every current caller keeps `'job'`.

- Produces in `lib/posts/view-state.ts`:
  - `PostList = 'matches' | 'review' | 'disqualified' | 'junk'`
  - `PostsViewState = { list: PostList; tab: Tab; profile: string | 'all'; job: string | null }`
  - `readPostsViewState(params: URLSearchParams, defaults?: Partial<PostsViewState>): PostsViewState`
  - `postsViewStateHref(state, defaults?): string`, which leaves out default values and has base path `/posts`
- Produces in `lib/posts/load.ts`:
  - `type PostExtras = Database['public']['Functions']['post_list_extras']['Returns'][number]`, and likewise `JunkRow`, `RescueRow` and `PostDetails`
  - `loadPostExtras(supabase, jobIds: string[]): Promise<Map<string, PostExtras>>`
  - `loadJunk(supabase, since: Date): Promise<JunkRow[]>`
  - `loadRescues(supabase): Promise<RescueRow[]>`
  - `loadPostDetails(supabase, jobId: string | null): Promise<PostDetails | null>`, which returns null for no id or a non-UUID id
  - `groupJunk(rows: JunkRow[]): MatchedJob[]`-compatible list items (or a `PostListItem` type, if `MatchedJob` doesn't fit; the builder's call, but one type for all four tabs)

  `loadJunk` and `loadRescues` throw `loadError` like `loadMatches`; `loadPostDetails` logs and returns null.

- [ ] **Step 1: Write the failing specs** (using `fakeSupabase`).
  - `loadMatches({ ..., kind: 'post_role' })` sends `p_kind: 'post_role'`, and with no `kind` it sends `p_kind: 'job'`.
  - `readPostsViewState` parses `list=junk` and falls back to `matches` for `list=bogus`.
  - `postsViewStateHref({list:'matches',tab:'24h',profile:'all',job:null})` returns `/posts`, and with `list:'disqualified'` it returns `/posts?list=disqualified`.
  - `loadPostExtras` calls `post_list_extras` with `p_job_ids`, and skips the call for an empty list.
  - `loadPostDetails('not-a-uuid')` returns null with no RPC call.
- [ ] **Step 2: Run the specs and confirm they fail.** Run `npx vitest run --config apps/web/vitest.config.mts src/lib/posts src/lib/matches/load.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the loaders and view state.** Then update every `loadMatches` and `loadMatch` caller so typecheck passes, still with `'job'`.
- [ ] **Step 4: Run the specs and typecheck, and confirm they pass.** Run the specs, then `npx nx typecheck web`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(web): posts view state and loaders`.

### Task 4: `/posts` page, tabs and the source switch

**Files:**

- Create:
  - `apps/web/src/app/(app)/posts/page.tsx`
  - `apps/web/src/components/posts/posts-view.tsx`
  - `apps/web/src/components/posts/post-row.tsx`
  - `apps/web/src/components/matches/source-switch.tsx`
- Modify:
  - `apps/web/src/app/(app)/page.tsx` (render the switch)
  - `components/matches/match-filters.tsx` (list tabs come from a prop)
  - `components/matches/match-empty.tsx` (new kinds)
  - `components/layout/app-nav.tsx` (`isActive`)
  - `app/(app)/preferences/data.ts` (profiles carry `postSearch`, if they don't already)
- Test: `components/posts/posts-view.spec.tsx`, `components/matches/source-switch.spec.tsx`, `components/layout/app-nav.spec.tsx`, `app/(app)/posts/page.spec.tsx`

**Interfaces:**

- Consumes: Task 3.
- Produces: `SourceSwitch({ current: 'job_board' | 'posts' })`. It renders two links, `Job board` → `/` and `Social posts` → `/posts`. The page renders it only when some profile has `postSearch` on.
- Produces: `MatchFilters` gains `lists: { value: string; label: string; count: number }[]`, which replaces `list`/`listCounts` with `list: string` and `onList: (v: string) => void`. The matches page passes its two lists, unchanged in copy.
- Produces: `isActive('/', '/posts')` returns true. The rest of `isActive` is unchanged.
- Produces: the `/posts` page.
  - It redirects to `/` when no profile has `postSearch` on.
  - It reads, in parallel:
    - `loadMatches` for `qualified`, `review` and `rejected`, all with `kind:'post_role'` and since one week;
    - `loadJunk` and `loadRescues`;
    - `loadPostExtras` for every listed job id;
    - `loadPostDetails` for the open job.
  - It renders `PostsView` with these lists:
    - **Matches:** undecided qualified rows, plus rescues with no decision. A job in both appears once, as Rescued.
    - **Review:** undecided review rows with no `reviewChoice`.
    - **Disqualified:** rejected rows minus rescued jobs, newest `decidedAt` first.
    - **Junk:** the junk rows.

  Every tab filters by profile, through `profileIds` for Junk and rescues, and by the 24h / 7d window: `firstSeenAt` for Junk, `postedAt` for the others.

- Produces: `PostRow`, which is `MatchRowLink`'s layout plus:
  - the badges `Email pending` (`extras.emailPending`), `Rescued` and `Unverified`;
  - one how-to-apply word from `applyKinds`: `Email`, `Apply link`, `Job board`, `DM the author`, or none;
  - on Junk, the verdict (`Not hiring` or `Junk`) and its reason;
  - on Disqualified, the first failed check's `reason`.
- Produces: the `EmptyKind` values `no-disqualified-24h`, `no-disqualified-7d`, `no-junk-24h` and `no-junk-7d`, with copy in `TEXT`.

- [ ] **Step 1: Write the failing specs.**
  - `SourceSwitch` marks `Social posts` current on `posts`.
  - `isActive('/', '/posts')` is true.
  - `PostsView`, with fixtures (`matchRow({kind:'post_role'})`), shows the tabs `Matches (2)`, `Review (1)`, `Disqualified (1)`, `Junk (1)`.
  - On Matches, an Email pending row and a Rescued row show their badges.
  - A rescued job that is also a rejected row shows only in Matches.
  - `?list=junk` shows the verdict and reason.
  - The page spec redirects to `/` with no `postSearch` profile, and passes `p_kind: 'post_role'`.
  - The job board page doesn't render the switch with no `postSearch` profile.
- [ ] **Step 2: Run the specs and confirm they fail.**
- [ ] **Step 3: Implement**, reusing `MatchList`, `MatchFilters` and `MatchEmpty`.
- [ ] **Step 4: Run the specs, the existing `matches-view.spec.tsx`, `match-filters` and `page.spec.tsx`, and confirm they pass.** Expected: PASS (the job board is unchanged).
- [ ] **Step 5: Commit.** Message: `feat(web): social posts page with four tabs`.

### Task 5: Post detail, linked copies, Applications

**Files:**

- Create: `apps/web/src/components/posts/post-section.tsx` and `apps/web/src/components/posts/post-detail.tsx`
- Modify:
  - `components/posts/posts-view.tsx`
  - `lib/matches/selected.ts` (`decidedJobHref`)
  - `app/(app)/page.tsx`
  - `app/(app)/applications/page.tsx` (detail read with `kind: null`)
  - `components/applications/decision-row.tsx` (the `Social post` marker)
- Test: `components/posts/post-section.spec.tsx`, `lib/matches/selected.spec.ts`, `components/applications/applications-view.spec.tsx`

**Interfaces:**

- Consumes: `PostDetails` (Task 3) and `group_decision_job` (Task 2).
- Produces: `PostSection({ details: PostDetails; now: Date })`, rendered inside `MatchDetail` through its `actions` slot, in this order:
  1. `Posted N days ago` (`postedAt`).
  2. **How to apply:** the email address with `Email pending` when `emailPending`, the apply links, and `DM, comment or connect with the author` for `connect_dm_comment`.
  3. **The author**, linked, and for a share **the sharer**, each with its `profileUrl`.
  4. **The post:** for a share, the sharer's `text` above the original's `text`.
  5. **Linked copies:** `Also on the job board` (→ `/?job=<id>`) for a `job` and `Also posted by <author>` (→ `/posts?job=<id>`) for a `post_role`.
- Produces: `PostDetail` for a job with no match row (a Junk post or a junk rescue). It shows the back link, the verdict (`Not hiring · <reason>` or `Junk · <reason>`), and `PostSection`. It has no facts or checks.
- Produces: `decidedJobHref(rows, decidedJobId?: string | null)`. It points at `decidedJobId ?? row.jobId`.
  - Both pages call `group_decision_job` only when a selected row has a `decisionStatus`.
  - The posts page redirects to `/applications?...` the same way.
- Produces: Applications reads the detail with `loadMatch(supabase, job, null, null)`, and shows a `Social post` outline badge on rows with `kind === 'post_role'`.

- [ ] **Step 1: Write the failing specs.**
  - `PostSection` for a share shows the sharer's text before the original's, `Posted 2 days ago`, the email with `Email pending`, and an `Also on the job board` link to `/?job=L1`.
  - `PostDetail` for a junk post shows `Junk · <reason>` and no `Why it matched`.
  - `decidedJobHref(rows, 'L1')` returns `/applications?job=L1`.
  - An Applications row of kind `post_role` shows `Social post`.
- [ ] **Step 2: Run the specs and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the specs and confirm they pass**, along with typecheck. Check by hand at 360px (`pnpm users link <email>` locally): the switch, the tabs and the detail fit.
- [ ] **Step 5: Commit.** Message: `feat(web): post details, linked copies, post roles in Applications`.

---

## PR C: rescues

### Task 6: Rescue and undo

**Files:**

- Create: `apps/web/src/lib/posts/rescue.ts`, with its spec, and `apps/web/src/components/posts/rescue-dialog.tsx`
- Modify: `app/(app)/actions.ts`, `components/posts/posts-view.tsx`, `components/posts/post-detail.tsx`
- Test: `lib/posts/rescue.spec.ts`, `components/posts/posts-view.spec.tsx`

**Interfaces:**

- Consumes: `post_rescue` and `post_rescue_undo` (Task 1).
- Produces in `lib/posts/rescue.ts`:
  - `RescueInput = z.object({ jobId: z.uuid(), note: z.string().trim().max(500).optional() })`
  - `saveRescue(supabase, input: unknown, deps?: Deps): Promise<SaveResult>`. A Postgres `not rescuable` error gives `{status:'invalid', errors:{_form:'This post can no longer be rescued.'}}`.
  - `undoRescue(supabase, jobId: unknown, deps?): Promise<SaveResult>`. A `decided` error gives `_form: 'Undo the decision first.'`
- Produces in `actions.ts`: `rescuePostAction(input: unknown)` and `undoRescueAction(jobId: unknown)`, following the existing action pattern. Each calls `revalidatePath('/posts')`.
- Produces in the UI:
  - Disqualified and Junk details have a `Rescue` button that opens `RescueDialog`, with an optional note labelled `Why this one is for you (optional)`.
  - On success, the detail closes, the list refreshes, and the toast reads `Moved to Matches`.
  - A Rescued detail shows `Undo rescue` while it has no decision.
  - On Disqualified, a role whose failed checks include `blockedAuthor` shows no Rescue button. Task 9 adds `Unblock <name>` there.

- [ ] **Step 1: Write the failing specs.**
  - `saveRescue` calls `post_rescue` with `p_job_id` and `p_note`, and maps `not rescuable` to the message above.
  - `undoRescue` maps `decided`.
  - In the view, Rescue on a Junk detail calls the action. A `blockedAuthor` row has no Rescue button. A rescued row shows `Undo rescue`.
- [ ] **Step 2: Run the specs and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the specs and confirm they pass.**
- [ ] **Step 5: Commit.** Message: `feat(web): rescue a post from Junk or Disqualified`.

### Task 7: Owner's rescue reports

**Files:**

- Create:
  - `apps/xjobs/src/modules/admin/rescues.repository.ts`, with an abstract class plus a Prisma implementation and a `.postgres.spec.ts`
  - `apps/xjobs/src/modules/admin/rescues.controller.ts`, with a spec
  - `apps/web/src/app/(app)/admin/rescues/page.tsx`, with a spec
  - `apps/web/src/components/admin/rescue-reports.tsx`
- Modify:
  - `apps/xjobs/src/modules/admin/admin.module.ts`
  - the engine client package (`@xjobs/engine-client`): add `adminRescues()`
  - `apps/web/src/components/layout/app-shell.tsx`, or wherever the admin links live, to add the link

**Interfaces:**

- Produces: `GET /api/admin/rescues?limit=<n≤200, default 100>`, behind `@UseGuards(UserGuard)` and `AdminGuard`. It returns `{ items: [{ id, createdAt, undoneAt, origin, note, snapshot, job: { id, kind, title, postingUrl }, user: { id } }] }`, newest first, including undone rows.
- Produces: the `/admin/rescues` page, which gates like `/admin/prepare`: `notFound()` for non-admins, and an `Empty` "Couldn't reach the engine" when the engine is down. It shows a table with these columns: date, origin, what the system said (the verdict and reason, or the failed checks' reasons), the note, the post link, and `Undone` when set.

- [ ] **Step 1: Write the failing tests.**
  - The repository postgres spec (with `INGEST_TEST_DATABASE_URL`) lists two rescues newest first, with the snapshot.
  - The controller spec returns 403 for a non-admin.
  - The web page spec calls `notFound` when `adminMe` says not admin, and renders `Seniority …` from a disqualified snapshot.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass**, the postgres spec included (it doesn't run in CI, so run it locally).
- [ ] **Step 5: Commit.** Message: `feat(admin): rescue reports`.

---

## PR D: blocked authors

### Task 8: Blocked authors in Preferences

**Files:**

- Create:
  - `apps/web/src/lib/preferences/blocked-authors.ts`, with its spec
  - `apps/web/src/app/(app)/preferences/blocked-authors/page.tsx`
  - `apps/web/src/components/preferences/blocked-authors-section.tsx`, with its spec
- Modify:
  - `lib/preferences/titles.ts` (`SECTION_TITLES.blockedAuthors = 'Blocked authors'`)
  - `components/preferences/preferences-nav.tsx` (a "You" entry)
  - `app/(app)/preferences/actions.ts`

**Interfaces:**

- Produces: `parseAuthorLink(input: string): { authorKey: string; profileUrl: string } | null`.
  - It accepts `linkedin.com` and any `*.linkedin.com` host, with or without a scheme, and ignores the query, the hash and trailing slashes.
  - `/in/<id>` gives `profile:<lower(decodeURIComponent(id))>`, and `/company/<name>` gives `company:<lower(decodeURIComponent(name))>`. Anything else gives null.
  - `profileUrl` is `https://www.linkedin.com/in/<id>/` or `https://www.linkedin.com/company/<name>/`.
- Produces: `loadBlockedAuthors(supabase): Promise<{ authorKey; name; profileUrl; createdAt }[]>`, newest first.
- Produces: `blockAuthor(supabase, userId, input: unknown, deps?)`, with input `{ link } | { authorKey, name?, profileUrl? }`.
  - An invalid link gives `_form: 'Paste a LinkedIn profile or company link.'`
  - A duplicate (unique violation) is `saved`.
- Produces: `unblockAuthor(supabase, authorKey: unknown, deps?)`.
- Produces: the actions `blockAuthorAction` and `unblockAuthorAction`, each with `revalidatePath('/preferences/blocked-authors')` and `revalidatePath('/posts')`.
- Produces: the page. Its heading is `Blocked authors`, with the lead `Posts by these people and companies never match, and are never emailed.` It has a link field with a `Block` button, and a list showing the name (or the key), the link, the date and `Unblock`. It follows the webhook page's own-section layout, not the form-only `Section` component.

- [ ] **Step 1: Write the failing specs.** `parseAuthorLink`:

  | Input                                                | Result             |
  | ---------------------------------------------------- | ------------------ |
  | `https://www.linkedin.com/in/Jane-Doe/?utm_source=x` | `profile:jane-doe` |
  | `linkedin.com/in/j%C3%A9r%C3%B4me`                   | `profile:jérôme`   |
  | `https://fr.linkedin.com/company/Acme-Inc/posts/`    | `company:acme-inc` |
  | `https://www.linkedin.com/feed/`                     | null               |
  | `https://example.com/in/jane`                        | null               |

  Then: `blockAuthor` inserts `{authorKey, profileUrl, name}` with no `id`; the section renders the list; `Unblock` calls the action.

- [ ] **Step 2: Run the specs and confirm they fail.**
- [ ] **Step 3: Implement.** The key must match what ingest's `authorOf` builds from `publicIdentifier` and `universalName`, read in `apps/xjobs/src/modules/ingest/normalize/mappers/linkedin-post.mapper.ts:17-34`. If ingest keys differ from the URL slug, follow ingest and note it in the PR.
- [ ] **Step 4: Run the specs and confirm they pass.**
- [ ] **Step 5: Commit.** Message: `feat(web): blocked authors in preferences`.

### Task 9: Block from a post, unblock from Disqualified

**Files:**

- Create: `apps/web/src/components/posts/block-author-button.tsx`
- Modify: `components/posts/post-section.tsx` and `components/posts/posts-view.tsx`
- Test: `components/posts/post-section.spec.tsx` and `components/posts/posts-view.spec.tsx`

**Interfaces:**

- Consumes: `blockAuthorAction` and `unblockAuthorAction` (Task 8). It also reads `authorKey`, `name` and `profileUrl` from `PostDetails.sources`, for the original's author and each sharer.
- Produces: `BlockAuthorButton({ authorKey, name, profileUrl })`.
  - It opens a `ConfirmDialog` titled `Block <name>?`, with the description `Their posts move to Disqualified within a few minutes, and are never emailed.`
  - On success, the toast reads `Blocked <name>`.
- Produces: on a Disqualified role whose failed checks include `blockedAuthor`, an `Unblock <name>` button, where the name is taken from the check's `jobValue` and `reason`.

- [ ] **Step 1: Write the failing specs.**
  - A share's detail shows two Block buttons, one for the author and one for the sharer.
  - Confirming calls `blockAuthorAction` with the sharer's key.
  - A `blockedAuthor` row shows `Unblock Jane Doe` and calls `unblockAuthorAction('profile:jane')`.
- [ ] **Step 2: Run the specs and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the specs and confirm they pass.**
- [ ] **Step 5: Commit.** Message: `feat(web): block an author from a post`.

---

## PR E: webhooks and lifted filters

### Task 10: Post webhooks

**Files:**

- Create: `libs/database/src/migrations/app/<stamp>_post_webhooks/`
- Modify:
  - `refs/db.json` and `database.types.ts`
  - `apps/xjobs/src/modules/webhooks/payload/build.ts`
  - `apps/xjobs/src/modules/webhooks/repositories/webhooks.repository.ts` (`loadPayloadInput`, `latestQualifiedForUser`)
  - `apps/xjobs/src/modules/webhooks/repositories/testing/memory-webhooks.repository.ts`
  - `docs/webhooks.md` and `apps/xjobs/src/modules/webhooks/README.md`
- Test:
  - `apps/db-tests/src/webhooks-rpcs.db.spec.ts`
  - `apps/xjobs/src/modules/webhooks/payload/build.spec.ts`
  - `apps/xjobs/src/modules/webhooks/repositories/webhooks.postgres.spec.ts`
  - the matcher's upsert postgres spec

**Interfaces** (invariant `post-webhooks`):

- **Cutoff function.** `post_webhooks_since() RETURNS timestamptz` (a helper) returns the moment the migration ran. The migration creates it with `EXECUTE format(...)` and `now()` baked in, so it never changes after that.
- **`webhook_enqueue_match`**, copied from `20261125T1248_post_matching`. The `j.kind = 'job'` line becomes:

  ```sql
  AND (j.kind = 'job'
       OR (j.kind = 'post_role'
           AND m."createdAt" >= public.post_webhooks_since()
           AND NOT public.post_email_pending(m."userId", j.id)))
  ```

  The listing gates (`publishedAt`, `enabledSince`, the merge root) are unchanged. The review trigger already calls this function, so the hold covers approved reviews.

- **Payload.** `WebhookPayloadV1.job` gains `source: 'job_board' | 'social_post'`. A new top-level field `post` is either null or:

  ```
  {
    url,
    author: { name, url },
    sharers: [{ name, url }],
    howToApply: { kinds, email, links },
    rescued: false
  }
  ```

  These fields are additive, so `version` stays `1`. `PayloadInput` gains `job.kind` and the post fields, which `loadPayloadInput` reads through the parent `postSources` and the post document.

- **Test sample.** `latestQualifiedForUser` adds `AND j.kind = 'job'`, so a test delivery stays a listing.
- **Docs.** `docs/webhooks.md` documents `job.source` and `post`. It says that a post with a contact email isn't sent until its email settles (slice 05), and that rescues send nothing.

- [ ] **Step 1: Write the failing tests.**
  - db-tests:
    - a qualified post role match with no email, created after the cutoff, gets a delivery;
    - one with an email (Email pending) gets none;
    - one whose `createdAt` is before the cutoff (set by the test with `UPDATE`) gets none;
    - an approved review of an Email pending role gets no delivery.
  - Matcher postgres spec (Review Focus 2): re-deciding an existing match row keeps `createdAt`. If it doesn't, change the cutoff to read a column the upsert keeps, and say so in the PR.
  - `build.spec.ts`: a post input gives `job.source = 'social_post'` and `post.author.name`, and a listing gives `job.source = 'job_board'` and `post = null`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**, with the migration, `refs/db.json`, `pnpm db:reset` and `pnpm db:types`.
- [ ] **Step 4: Run the tests and confirm they pass**: `pnpm db:test`, the webhooks unit tests, and the postgres specs locally.
- [ ] **Step 5: Commit.** Message: `feat(webhooks): send post matches, held while email pending`.

### Task 11: Paused searches, `db:analyze`, docs

**Files:**

- Modify:
  - `apps/xjobs/src/modules/activity/activity.sql.ts` (`pausedUsersCte`)
  - `apps/xjobs/src/scripts/analyze-matches/sections.ts`
  - `docs/roadmap/phase-4-social-posts/04a-social-posts-page.md` and `README.md` (status: built, with PR numbers)
  - `apps/xjobs/src/modules/matcher/README.md`, if it names the listing-only filters
- Test: `apps/xjobs/src/modules/activity/activity.repository.postgres.spec.ts` (or the existing paused-searches spec), `apps/db-tests/src/paused-searches.db.spec.ts`

**Interfaces:**

- **`pausedUsersCte`.** The waiting match may be `kind IN ('job','post_role')`, but never one where `post_email_pending(userId, jobId)` holds, because those wait on slice 05, not on the user. A live rescue doesn't count as a waiting match. Replace the "Slice 04a lifts this" comment.
- **`db:analyze`.** Each section that filtered `j.kind = 'job'` now reads `j.kind IN ('job','post_role')` and reports its counts split by kind (one column or row group per kind).

- [ ] **Step 1: Write the failing tests.**
  - A user whose only waiting qualified match is a post role with no email is paused after the window.
  - A user whose only waiting match is Email pending is not paused.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**, and run `pnpm --filter @xjobs/xjobs db:analyze` locally to confirm the split prints.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** Message: `feat(engine): post roles in paused searches and db:analyze`.

## Rollout on dev (after PR E, in the PR body)

Follow the spec's "Rollout check on dev". Before deploying PR E, record `SELECT now()`: `post_webhooks_since()` must come out after it, and no post delivery row may exist with a `createdAt` before it.

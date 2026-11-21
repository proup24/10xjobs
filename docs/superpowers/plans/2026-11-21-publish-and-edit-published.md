# Publish on Create and Edit a Published Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finishing setup (or "add a profile") publishes the profile through the engine, and a published profile stays editable: a save moves its shared searches and re-decides its recent jobs, with every decision naming the profile version it read.

**Architecture:** The web app keeps writing profiles under RLS, now for published profiles too. Triggers bump `profiles.matchVersion` on any matching change. The matcher stores the version on each decision (`job_matches.profileVersion`) and its existing sweep re-decides rows on an older version. A new search sync in the engine, run from the match sweep, swaps a profile's shared builders in one transaction whenever `searchesVersion < matchVersion`. Publishing is a server action calling the engine after "Finish". Deleting a published profile goes through a new engine route.

**Tech Stack:** Prisma Next contract and migrations, Supabase Postgres (db-tests through `supabase-js`), NestJS engine (Vitest, `*.postgres.spec.ts`), BullMQ, Next.js App Router, `components/ui`, `@xjobs/engine-client`.

**Spec:** `docs/superpowers/specs/2026-11-21-publish-and-edit-published-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

## Global Constraints

- The Prisma contract (`libs/database/src/contract/contract.prisma`) is the only schema source, RLS policies included. Functions, triggers, grants and backfills go in an app migration as `rawSql` ops (precedent: `20261112T1603_rematch_triggers/migration.ts`).
- After `pnpm --filter @xjobs/database db:migration:plan`, set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`, keep every existing invariant and add each new rawSql `invariantId` (advancing the ref can write `invariants: []`; re-add them). Then `pnpm db:reset` and `pnpm db:types` (CI diffs `database.types.ts`).
- Functions: `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names, `(SELECT auth.uid())`, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` for trigger functions; RPCs keep their current grants.
- Columns that do **not** bump `matchVersion`: `resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`, `state`, `publishedAt`, `matchVersion`, `searchesVersion`, `postSearch`, `createdAt`, `updatedAt`. Every other column of `profiles` bumps it when its value changes (`IS DISTINCT FROM`).
- Re-decided window: matchable jobs only (`MATCH_BACKFILL_DAYS` = 30). No change to the matchable definition, `MATCHER_VERSION` or `MATCH_SWEEP`.
- Search sync limit: 20 profiles per sweep tick (`SEARCH_SYNC_LIMIT = 20`), run at the start of every match sweep (every 60 s, hosted engine only).
- Only the engine attaches and releases searches, and sets `state`, `publishedAt` and `searchesVersion`.
- Copy: on the job and terms pages of a published profile, "Changes apply to the next searches and to jobs from the last 30 days." While `searchesVersion` is null or below `matchVersion` on a published profile: "Your last change is being applied to the searches." Draft mark in the preferences nav: **Not live**. Matches view draft state: title "This profile isn't live yet", description "Finish setting it up to start matching.", action **Finish setup** → `/preferences/new/<id>/resume`.
- Publish errors (shown as the step's `formError`): `conflict/incomplete` → "Set your country of residence and answer the visa sponsorship question in Eligibility, then finish again."; every other failure → "Couldn't publish the profile. It's saved; try Finish again." `ok` and `conflict/already-published` both count as published.
- UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`). No service role in the web app (`apps/web/src/no-service-role.spec.ts`). Log lines carry ids and error codes only.
- Work in the worktree `/home/lab/apps/10xjobs/.worktrees/publish-edit` on `feat/publish-and-edit-published`. Three PRs to `main`, merged in order: **PR A** Tasks 1–3 (database and matcher), **PR B** Tasks 4–7 (engine), **PR C** Tasks 8–12 (web and rollout). Branch each from `main` after the previous merges (see the stacked-PR trap: never stack on an unmerged branch). Push only with `git push -u origin <branch>`; open with `gh pr create --base main`.
- Engine Postgres specs need the disposable `processor_test` DB (see existing `*.postgres.spec.ts` setup). db-tests run with `pnpm db:test` against the local stack.

## Review Focus

1. **Two saves in quick succession, or a save during a search swap.** Expected: the profile ends on the searches for its latest version; a swap that read an older version records that version, so the next tick applies again. Test in Task 5 (`reapplies when the version moved during a swap`).
2. **Finish pressed twice, or pressed on a profile another tab already published.** Expected: the user lands on the matches view, no error. Test in Task 8 (`treats already-published as published`).
3. **One profile's searches can't be built** (a missing place label, or a recipe step throws). Expected: that profile stays behind and is logged by id; the other profiles in the tick still apply, and the match sweep still runs. Tests in Task 5 (`keeps going after one profile fails`) and Task 6 (`runs the match sweep when search sync throws`).
4. **A save that changes nothing, or only replaces the resume.** Expected: no version bump, no re-decide, no swap. Tests in Task 2.
5. **Deleting a published profile while the engine is unreachable.** Expected: the profile stays and the user sees the existing failure toast; a retry after the engine is back deletes it, even though its files are already gone. Test in Task 11 (`retries after files were removed`).

---

## PR A: database and matcher

### Task 1: Migration: profile versions, edit rules, review-choice version

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (models `Profile`, `JobMatch`, `MatchReview`; policies `profiles_owner_update_draft`, `profile_skills_owner_insert|update|delete`)
- Create: `libs/database/src/migrations/app/<timestamp>_profile_edits/migration.ts` (planned, then edited)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)

**Interfaces:**

- Produces columns: `profiles.matchVersion int NOT NULL DEFAULT 0`, `profiles.searchesVersion int NULL`, `job_matches.profileVersion int NULL` (replaces `profileUpdatedAt`, which is dropped), `match_reviews.profileVersion int NULL`.
- Produces: trigger function `public.bump_profile_match_version()` (on `profiles` BEFORE UPDATE, and on `profile_skills` AFTER INSERT/UPDATE/DELETE); trigger function `public.match_reviews_profile_version()` (BEFORE INSERT on `match_reviews`, sets `NEW."profileVersion"` from its match); `replace_profile_skills(p_profile_id, p_skills)` accepting the caller's draft **or published** profile (still P0002 otherwise); `match_details` applying a choice only when `r."profileVersion" = m."profileVersion"`.

- [ ] **Step 1: Edit the contract.** Add the four columns. Rename `profiles_owner_update_draft` to `profiles_owner_update` with `using` and `withCheck` both `"userId" = auth.uid()` (the existing column grants already keep `state`, `publishedAt` and the new version columns out of users' hands: do not grant them). Insert and delete policies on `profiles` stay draft-only. Drop the `p.state = 'draft'` condition from the three `profile_skills` write policies, keeping the ownership check.
- [ ] **Step 2: Plan the migration** with `pnpm --filter @xjobs/database db:migration:plan`, then add `rawSql` ops, each with its own `invariantId`:
  - `bump_profile_match_version()`: on `profiles`, `NEW."matchVersion" := OLD."matchVersion" + 1` when any bumping column (Global Constraints) `IS DISTINCT FROM` its old value; on `profile_skills`, `UPDATE public.profiles SET "matchVersion" = "matchVersion" + 1 WHERE id IN (OLD."profileId", NEW."profileId")`. The profiles trigger is a plain `BEFORE UPDATE` (no column list), with the comparison inside the function, so a new column bumps by default.
  - `replace_profile_skills`: copy the latest definition (`20261108T1236_replace_profile_skills_lock`) and widen the lock query to `state IN ('draft','published')`.
  - `match_reviews_profile_version()` and its trigger.
  - `match_details`: copy the latest definition (`20261116T2230_job_decision_reads`) whole and add `r."profileVersion"` to the inner select and `AND r."profileVersion" = m."profileVersion"` to the applicable-decision filter. Grep later migrations first in case a newer one redefined it.
  - Backfill, before dropping `profileUpdatedAt`: `UPDATE job_matches SET "profileVersion" = 0`; `UPDATE match_reviews r SET "profileVersion" = m."profileVersion" FROM job_matches m WHERE m.id = r."matchId"`. Leave `searchesVersion` null on existing published profiles: the search sync then moves them to the current recipe on its first tick.
- [ ] **Step 3: Emit and apply.** `node <dir>/migration.ts`, advance `refs/db.json`, `pnpm db:reset`, `pnpm db:types`. Verify: `select "matchVersion", "searchesVersion" from profiles limit 1` and `\df public.bump_profile_match_version` on the local DB.
- [ ] **Step 4: Commit** `feat(db): profile match version, editable published profiles, versioned review choices`.

### Task 2: db-tests for the new rules

**Files:**

- Delete: `apps/db-tests/src/profile-freeze.db.spec.ts`
- Create: `apps/db-tests/src/profile-edits.db.spec.ts`
- Modify: `apps/db-tests/src/match-reviews.db.spec.ts`, plus any db-test that still names `profileUpdatedAt` (`resume-swap.db.spec.ts`, fixtures)

**Interfaces:**

- Consumes: Task 1's columns, triggers and functions; fixtures `seedProfile`, `seedSkill`, `createTestUser`, `admin`.

- [ ] **Step 1: Write `profile-edits.db.spec.ts`** (`describe('published profiles are editable by their owner')`), each test reading `matchVersion` through `admin()` before and after:
  - `updates a published profile and bumps matchVersion`: owner sets `noticePeriodDays: 90` → row has 90, version + 1.
  - `a save of the same values does not bump`: update `noticePeriodDays` to its current value → version unchanged.
  - `a resume change does not bump`: the same resume write `resume-swap.db.spec.ts` uses (`set_profile_resume`) on a published profile → version unchanged.
  - `postSearch does not bump`: `admin()` flips `postSearch` → version unchanged.
  - `inserting, updating and deleting a skill each bump`: three writes as the owner → version + 3.
  - `replace_profile_skills works on a published profile`: rpc succeeds, skills replaced, version bumped.
  - `cannot set state, publishedAt, matchVersion or searchesVersion`: each update → `error.code` `42501`, row unchanged.
  - `cannot delete a published profile`: row still there.
  - `another user cannot update it or its skills`: `data` `[]`, rows unchanged.
- [ ] **Step 2: Add to `match-reviews.db.spec.ts`:**
  - `a choice records its match's profileVersion`: insert a choice → `profileVersion` equals the match's.
  - `a choice stops applying once the match is re-decided on a newer version`: `admin()` sets the match's `profileVersion = 1` (outcome stays review, same rule and field) → `match_details` shows it under review again; a new choice now applies.
- [ ] **Step 3: Run** `pnpm db:test`. Expected: all pass, including the existing suites.
- [ ] **Step 4: Commit** `test(db): editable published profiles and versioned review choices`.

### Task 3: The matcher records and compares the profile version

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/types.ts` (`MatchProfile`), `apps/xjobs/src/modules/matcher/repositories/matcher.repository.ts` (`StoredMatch`, `ON_CURRENT_PROFILE`, `listPublishedProfiles`, `upsertMatches`, `matchesForJob`), `apps/xjobs/src/modules/matcher/services/matcher.service.ts`, `apps/xjobs/src/modules/matcher/testing/memory-matcher.repository.ts`
- Modify every other reader of `profileUpdatedAt` (`grep -rn profileUpdatedAt apps libs --include=*.ts`, e.g. `webhooks/services/delivery.service.ts` and the specs)
- Test: `apps/xjobs/src/modules/matcher/repositories/matcher.postgres.spec.ts`, `services/matcher.service.spec.ts`, `testing/memory-matcher.repository.spec.ts`

**Interfaces:**

- Produces: `MatchProfile.matchVersion: number` (replaces `updatedAt`); `StoredMatch.profileVersion: number | null` (replaces `profileUpdatedAt`). `ON_CURRENT_PROFILE`: `m."profileVersion" >= p."matchVersion" AND (eligibility test unchanged)`. A null `profileVersion` is stale.

- [ ] **Step 1: Write the failing tests** in `matcher.postgres.spec.ts`:
  - `stores the profile's matchVersion on each decision`: profile at version 3 → stored row `profileVersion` 3.
  - `a row on an older profile version is stale`: decide, bump `profiles.matchVersion` → `listStaleJobs` returns the job and `matchJob` re-decides only that profile.
  - `an outcome flips when the edit changes it`: a job rejected on location, the profile gains the place (version bumped) → after `matchJob` the row is qualified and `decidedAt` moved.
    Mirror the stale-row case in `memory-matcher.repository.spec.ts`.
- [ ] **Step 2: Run** `npx nx test xjobs -- matcher`. Expected: FAIL (`profileVersion` unknown).
- [ ] **Step 3: Implement** the renames and the new comparison.
- [ ] **Step 4: Run** `npx nx test xjobs` and `npx nx run-many -t lint typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): decide on the profile's matchVersion`, then open **PR A**.

## PR B: engine

### Task 4: One-transaction search swap

**Files:**

- Modify: `apps/xjobs/src/modules/queries/repositories/queries.repository.ts`, `apps/xjobs/src/modules/queries/services/queries.service.ts`, `apps/xjobs/src/modules/queries/types/query-search.types.ts`, `apps/xjobs/src/modules/queries/testing/fakes.ts`
- Test: `apps/xjobs/src/modules/queries/repositories/queries.postgres.spec.ts`, `services/queries.service.spec.ts`

**Interfaces:**

- Produces: `type QuerySearchReplaceResult = QuerySearchAttachResult & { released: number }`.
- Produces: `QuerySearchRepository.replace(profileId: string, recipes: QuerySearchRecipe[], searchesVersion: number): Promise<QuerySearchReplaceResult>`. In one retried transaction: links each wanted recipe's builder (the `attach` logic, factored into a private `attachIn(tx, profileId, recipes)`), unlinks the profile's builders whose hash is not wanted (each `adjust(-1)`), then `UPDATE profiles SET "searchesVersion" = $v WHERE id = $profileId AND state = 'published'`.
- Produces: `QuerySearchRepository.releaseAndDelete(profileId: string): Promise<boolean>`. In one transaction: unlinks every builder (`adjust(-1)` each), then deletes the profile row `WHERE state = 'published'`. Returns whether a row was deleted (on false, roll back: nothing is released).
- Produces: `QuerySearchService.recipesFor(input: QuerySearchProfileInput, options: { posts: boolean }): QuerySearchRecipe[]` (what `generate` attaches today; `generate` now calls it) and pass-throughs `replace(...)` and `releaseAndDelete(...)`.

- [ ] **Step 1: Write the failing tests** in `queries.postgres.spec.ts`:
  - `replace keeps shared builders linked throughout`: profile on builders {a, b}, replace with {b, c} → links {b, c}; `a` count − 1 (inactive at 0), `b` count unchanged and active, `c` created and active; `released` 1.
  - `replace sets searchesVersion`: → the profile's `searchesVersion` equals the argument.
  - `replace with the same recipes changes no counts`.
  - `releaseAndDelete releases every builder and deletes the profile`: counts drop, row gone, returns true.
  - `releaseAndDelete leaves a draft alone`: returns false, counts and row unchanged.
- [ ] **Step 2: Run** `npx nx test xjobs -- queries`. Expected: FAIL.
- [ ] **Step 3: Implement**, with the fakes in `testing/fakes.ts` following the same rules.
- [ ] **Step 4: Run** `npx nx test xjobs -- queries`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(queries): swap a profile's searches in one transaction`.

### Task 5: Search sync, publish and regenerate on the swap

**Files:**

- Create: `apps/xjobs/src/modules/users/services/profile-search-sync.ts`, `profile-search-sync.spec.ts`
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts` (`listSearchesBehind`, `publish` gains `searchesVersion`), `apps/xjobs/src/modules/users/services/profiles.service.ts` (`publish`, `regeneratePublished`, `RegenerateDeps`), `apps/xjobs/src/modules/users/users.module.ts` (export `ProfileSearchSync`), `apps/xjobs/src/modules/users/index.ts`, `apps/xjobs/src/modules/users/testing/fakes.ts`
- Test: `profiles.service.spec.ts`, `regenerate.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchService.recipesFor`, `replace` (Task 4); `PostSearchAccess.allows`.
- Produces: `ProfilesRepository.listSearchesBehind(limit: number): Promise<ProfileWithSkills[]>`: published profiles with `searchesVersion IS NULL OR searchesVersion < matchVersion`, oldest `updatedAt` first.
- Produces: `ProfilesRepository.publish(userId, profileId, at: Date, searchesVersion: number)`.
- Produces: `export const SEARCH_SYNC_LIMIT = 20;` and `@Injectable() class ProfileSearchSync { applyPending(limit = SEARCH_SYNC_LIMIT): Promise<{ applied: number; failed: number }> }`. For each profile: labels, `recipesFor(toQuerySearchInput(profile, labels), { posts: profile.postSearch && allows(profile.userId) })`, `replace(profile.id, recipes, profile.matchVersion)`. A failure is caught, logged as `Search sync failed profile=<id>: <message>`, and counted; the loop goes on.
- `publish` passes the `matchVersion` it read to `profiles.publish`. `regeneratePublished` uses `recipesFor` + `replace(profile.id, recipes, profile.matchVersion)` instead of detach-then-generate; `RegenerateDeps.querySearch` becomes `Pick<QuerySearchService, 'recipesFor' | 'replace' | 'retireOutdated'>`.

- [ ] **Step 1: Write the failing tests** in `profile-search-sync.spec.ts` with the users and queries fakes:
  - `applies a profile whose searches are behind`: profile at version 2, searches at 1 → `replace` called with version 2; `{ applied: 1, failed: 0 }`.
  - `skips a profile that is up to date`.
  - `applies a published profile with no searchesVersion yet`.
  - `reapplies when the version moved during a swap`: the version moves to 3 after the read of 2 → after the tick `searchesVersion` is 2, the next tick applies 3.
  - `keeps going after one profile fails`: first profile's labels throw → `{ applied: 1, failed: 1 }`, the second is applied.
  - `drops post builders for an owner not allowed`: `postSearch` true, not allowed → recipes contain no `linkedin_posts` channel.
    In `profiles.service.spec.ts`: `publish records the version it attached for`. In `regenerate.spec.ts`: update for `replace`, plus `regenerate sets searchesVersion`.
- [ ] **Step 2: Run** `npx nx test xjobs -- users`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(users): sync a published profile's searches to its version`.

### Task 6: Run the search sync in the match sweep

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/match/processor.ts` (`MatchJobDeps`, sweep branch), `apps/xjobs/src/infrastructure/worker/match.service.ts`, `apps/xjobs/src/infrastructure/worker/worker.module.ts`
- Test: `apps/xjobs/src/infrastructure/jobs/steps/match/processor.spec.ts`

**Interfaces:**

- Consumes: `ProfileSearchSync.applyPending` (Task 5).
- Produces: `MatchJobDeps.searches: Pick<ProfileSearchSync, 'applyPending'>`. The sweep result becomes `{ searches: { applied, failed } | { error: string }, deleted, enqueued }`.

- [ ] **Step 1: Write the failing tests** in `processor.spec.ts`:
  - `the sweep applies pending searches before matching`: `applyPending` called once, the result carries its counts.
  - `runs the match sweep when search sync throws`: `applyPending` rejects → `deleteInactive` and `listStaleJobs` still run, and the result carries `searches.error`.
- [ ] **Step 2: Run** `npx nx test xjobs -- match/processor`. Expected: FAIL.
- [ ] **Step 3: Implement.** Import `UsersModule` in `WorkerModule` and inject `ProfileSearchSync` into `MatchWorkerService`. If importing `UsersModule` into the worker drags in HTTP-only providers (its controller's guard), move `ProfileSearchSync` and its providers into a small `ProfileSearchModule` that the users module and the worker both import.
- [ ] **Step 4: Run** `npx nx test xjobs`, then start `npx nx worker-match xjobs` locally with `XJOBS_RUN_SCHEDULES=1` against the local stack and confirm the `Match sweep:` log line shows `searches`.
- [ ] **Step 5: Commit** `feat(worker): match sweep applies pending profile searches`.

### Task 7: Delete a published profile through the engine

**Files:**

- Modify: `apps/xjobs/src/modules/users/controllers/profiles.controller.ts`, `profiles.service.ts`, `apps/xjobs/src/common/enums` (the `ErrorCode` enum), `libs/engine-client/src/client.ts`, `libs/engine-client/src/index.ts`
- Test: `profiles.service.spec.ts`, `apps/xjobs-e2e` profile routes spec (where the publish route is tested), `libs/engine-client/src/client.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchService.releaseAndDelete` (Task 4).
- Produces: `ErrorCode.PROFILE_NOT_PUBLISHED`. `ProfilesService.deletePublished(userId: string, profileId: string): Promise<{ id: string }>`: 404 like `getOrThrow`; 409 `PROFILE_NOT_PUBLISHED` for a draft; else `releaseAndDelete`, and a false result (deleted or unpublished meanwhile) is a 404.
- Produces: `DELETE /profiles/:profileId` → 200 `{ id }` (same guards and Swagger decorators as publish).
- Produces: `EngineClient.deleteProfile(profileId: string): Promise<EngineResult<{ id: string }>>`; `EngineResult`'s conflict reason union gains `'not-published'` (409 with `PROFILE_NOT_PUBLISHED`). Logging matches `publishProfile` (`engine deleteProfile profile=<id> outcome=<kind> status=<n>`).
- `PROFILE_PUBLISHED` keeps its code but its message becomes "This profile is already published" (it now only means a repeated publish).

- [ ] **Step 1: Write the failing tests**: service `deletePublished releases searches and deletes`, `refuses a draft with PROFILE_NOT_PUBLISHED`, `404s another user's profile`; e2e `DELETE /api/profiles/:id` 200 then 404 on repeat; client `sends DELETE … and maps 200/404/409/timeouts` mirroring the publish cases.
- [ ] **Step 2: Run** `npx nx test xjobs -- profiles`, `npx nx test engine-client`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): delete a published profile and release its searches`, then open **PR B**.

## PR C: web app and rollout

### Task 8: Publish on Finish

**Files:**

- Create: `apps/web/src/lib/profiles/publish.ts`, `publish.spec.ts`; `apps/web/src/app/(app)/preferences/publish-action.ts` (server action)
- Modify: `apps/web/src/components/setup/review.tsx` (and the review page that renders it, to pass the profile id), `apps/web/src/components/setup/step-frame.tsx` if `submitHref` needs a submit alternative, `apps/web/src/components/preferences/new-profile-steps.tsx` (`NewProfileResumeStep`)
- Test: `review.spec.tsx`, `new-profile-steps.spec.tsx` (or the existing specs for these components)

**Interfaces:**

- Consumes: `EngineClient.publishProfile`.
- Produces: `type PublishOutcome = { status: 'published'; href: string } | { status: 'failed'; message: string }`, `publishProfile(engine: Pick<EngineClient, 'publishProfile'>, profileId: string): Promise<PublishOutcome>` with `href` = `/?profile=<id>` and the messages from Global Constraints; `publishProfileAction(profileId: string): Promise<PublishOutcome>` (validates the id, needs a session, calls `engineClient()`, `revalidatePath('/', 'layout')` on success).
- Review's "Finish" and `NewProfileResumeStep`'s "Finish" call the action; on `published` they `router.push(href)`, on `failed` they show `message` as the frame's `formError` with the button enabled again.

- [ ] **Step 1: Write the failing tests** in `publish.spec.ts`: `maps ok to the matches view`, `treats already-published as published`, `maps incomplete to the eligibility message`, `maps unavailable, not-found and unauthorized to the generic message`. Component specs: `Finish publishes and goes to the matches view`; `a failed publish shows the message and Finish works again`.
- [ ] **Step 2: Run** `npx nx test web -- publish review new-profile`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the setup guard letting a done user (draft with a resume) reach `/setup/review`; add a `guard.spec.ts` case if the current one doesn't cover it.
- [ ] **Step 4: Run** `npx nx test web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): finishing setup or a new profile publishes it`.

### Task 9: Show which profiles are live

**Files:**

- Modify: `apps/web/src/components/preferences/preferences-nav.tsx`, `apps/web/src/components/matches/match-empty.tsx`, `apps/web/src/components/matches/matches-view.tsx`
- Test: `preferences-nav.spec.tsx`, `match-empty` / `matches-view.spec.tsx`

**Interfaces:**

- Consumes: `ProfileListItem.state` (already loaded).
- Produces: `EmptyKind` `{ kind: 'draft'; finishHref: string }`, with the copy from Global Constraints. The nav shows a `Badge` "Not live" beside a draft profile's label.

- [ ] **Step 1: Write the failing tests**: `marks a draft profile Not live` (published shows no badge); `the draft empty state links Finish setup to the profile's resume step`.
- [ ] **Step 2: Run** `npx nx test web -- preferences-nav matches`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx test web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show draft profiles as not live`.

### Task 10: Edit a published profile from preferences

**Files:**

- Modify: `apps/web/src/lib/setup/save.ts` (`saveProfileJob`, `saveProfileTerms`: log text "matched no profile of yours" instead of "no draft"), the job and terms pages under `apps/web/src/app/(app)/preferences/profiles/[profileId]/`, `apps/web/src/lib/setup/load.ts` (load `state`, `matchVersion`, `searchesVersion`)
- Create: `apps/web/src/components/preferences/published-notice.tsx`, `published-notice.spec.tsx`
- Test: `apps/web/src/lib/setup/save.spec.ts`

**Interfaces:**

- Produces: `PublishedNotice({ applying }: { applying: boolean })`: always the "Changes apply…" line; plus "Your last change is being applied to the searches." when `applying`. Rendered only for published profiles, on the job and terms pages. `applying = searchesVersion === null || searchesVersion < matchVersion`.

- [ ] **Step 1: Write the failing tests**: `save.spec.ts` `saves a published profile's job` (no draft-only failure path left); `published-notice.spec.tsx` `shows the applying line only while searches are behind`.
- [ ] **Step 2: Run** `npx nx test web -- save published-notice`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx test web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): edit a published profile`.

### Task 11: Delete a published profile through the engine

**Files:**

- Create: `apps/web/src/lib/resume/delete-published.ts`, `delete-published.spec.ts`
- Modify: `apps/web/src/lib/preferences/delete-profile.ts`, `apps/web/src/app/(app)/preferences/actions.ts` (`deleteProfileAction`)

**Interfaces:**

- Consumes: `EngineClient.deleteProfile` (Task 7).
- Produces: `deletePublishedProfile(supabase, userId, profileId, engine: Pick<EngineClient, 'deleteProfile'>, deps?): Promise<'deleted' | 'failed'>`: removes the profile's resume files exactly as `deleteDraftProfile` does, then calls the engine; `ok` and `not-found` → `deleted`, anything else → `failed`. `deleteProfile` (the dispatcher) reads `state` and picks the draft or published path; its result union drops `'not-draft'`.

- [ ] **Step 1: Write the failing tests**: `deletes a published profile through the engine`, `fails when the engine is unavailable and keeps the row`, `retries after files were removed` (empty folder, engine ok → deleted). Keep the existing last-profile and only-resume tests passing for published profiles.
- [ ] **Step 2: Run** `npx nx test web -- delete`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): delete a published profile through the engine`.

### Task 12: Dev rollout script and docs

**Files:**

- Create: `apps/xjobs/src/scripts/publish-drafts.ts`, `publish-drafts.spec.ts`; script `db:publish-drafts` in `apps/xjobs/package.json`
- Modify: `CLAUDE.md` (Commands), `docs/roadmap/phase-2-find/06-publish-on-create.md` (no `releaseAll` exists; the new route), `07-edit-published.md` (requalified jobs are not marked new), `docs/roadmap/phase-2-find/README.md` (status)

**Interfaces:**

- Produces: `pnpm --filter @xjobs/xjobs db:publish-drafts -- [--dry-run]`: publishes, through `ProfilesService.publish`, every draft that has a resume; prints each profile id and outcome; refuses a remote DB unless `XJOBS_ALLOW_REMOTE_DB=1`, like the other `db:*` scripts.

- [ ] **Step 1: Write the failing test**: `publishes drafts with a resume and skips the rest; dry run publishes none`.
- [ ] **Step 2: Implement**, run `npx nx test xjobs -- publish-drafts`. Expected: PASS.
- [ ] **Step 3: Update the docs.** CLAUDE.md line: "`pnpm --filter @xjobs/xjobs db:publish-drafts -- [--dry-run]`: publish every draft that has a resume (one-off for profiles made before publish-on-finish; remote needs `XJOBS_ALLOW_REMOTE_DB=1`)."
- [ ] **Step 4: Write the rollout in the PR C body**:
  1. Before deploying PR B, confirm `POST_SEARCH_USERS` is set on the hosted worker (the sync drops post builders of owners it doesn't list) and `ENGINE_URL`/`ENGINE_API_KEY` on the web app.
  2. After PR B deploys: the existing published profile's `searchesVersion` is set within a minute (the sync's first tick moves it to the current recipe); check with `select "matchVersion", "searchesVersion" from profiles where state = 'published'`.
  3. After PR C: `db:publish-drafts -- --dry-run`, then for real, on dev.
  4. Done-when check on the hosted app: add a technology to a published profile → within a minute its searches include the new builders (`profile_query_search_builders`), and within about 35 minutes the recent jobs that failed only on it are qualified; remove a place → recent jobs that passed only on it drop out; every `job_matches` row has a `profileVersion`.
- [ ] **Step 5: Commit** `chore: publish-drafts script, docs and rollout`, then open **PR C**.

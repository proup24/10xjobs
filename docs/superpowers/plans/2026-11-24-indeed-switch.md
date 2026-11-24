# Indeed switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared per-profile search switch (post search and Indeed) in the engine, client and web app, with `POST_SEARCH_USERS` removed and both switches hidden until their channel is ready.

**Architecture:** A registry of search switches in the queries module (`posts` → `postSearch`, `indeed` → `indeedSearch`) is the one source every path reads: recipes, the swap check, publish, search sync, regenerate, publish-drafts and the endpoints. A switch is _in effect_ when its flag is on. `available` only gates showing and changing it. Both are unavailable in this slice.

**Tech Stack:** NestJS, Prisma Next contract and migrations (Postgres on Supabase), Vitest, Next.js App Router, `@xjobs/engine-client`.

**Spec:** `docs/superpowers/specs/2026-11-24-indeed-switch-design.md`

## Global Constraints

- `profiles.indeedSearch boolean NOT NULL DEFAULT false`, engine-written only (no user column grant), exactly like `postSearch`.
- `indeedSearch` joins `postSearch` in both exclusion arrays of `public.bump_profile_match_version()`. Toggling a switch never bumps `matchVersion` or sets `users.searchesResumedAt`.
- Switch keys are `posts` and `indeed`. They are not `Channel` values: `INDEED` is added to `Channel` in slice 03.
- Both switches have `available: false`. It is set in code only, with no env var.
- A switch is in effect whenever its flag is on, available or not.
- `POST_SEARCH_USERS`, `PostSearchAccess`, `postSearchEnvironmentSchema` and `ErrorCode.POST_SEARCH_NOT_ALLOWED` are removed. `ADMIN_USERS` keeps the same comma-separated parsing.
- The swap skip reason `post_search_changed` is renamed `switch_changed`. Nothing outside the code and specs reads it (checked 2026-11-24).
- Indeed copy: label **"Search Indeed"**, description "Searches Indeed for this profile's technologies in the countries it names, and for remote jobs in the US, Brazil, Poland, the UK and Canada."
- Posts copy is unchanged from `post-search-switch.tsx`.
- Web UI is built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).
- Work in the worktree `.worktrees/indeed-switch`. Branch `feat/indeed-switch` from `origin/main`, and carry the spec and plan commits over from `docs/indeed-switch`. Push with `git push -u origin feat/indeed-switch` only.

## Review Focus

1. **A hidden switch that is on** (the owner's profile, `postSearch = true`, posts unavailable) must keep its post builders through search sync, regenerate, publish and publish-drafts. Pinned in Task 3 (`keeps post recipes for a hidden switch that is on`).
2. **A PUT on a hidden switch**, from an old web app or a crafted request, must 404 and leave the flag and builders as they were. Pinned in Task 4 (`refuses an unavailable switch without writing`).
3. **A toggle landing mid-swap on the other column** (`indeedSearch` while the recipes were read with posts only) must still skip the swap. Pinned in Task 2 (`skips when indeedSearch moved since the read`).
4. **Another user's profile id** on the new routes must 404, with no difference between "not yours" and "doesn't exist". Pinned in Task 4.
5. **An engine that answers an unknown key or an older shape** (web deployed before the engine) must make the web section render nothing instead of throwing. Pinned in Task 6 (`renders nothing when the engine has no searches route`).

---

### Task 1: Migration: `indeedSearch` and the trigger exclusion

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (model `Profile`, next to `postSearch` at line 242, with a comment: "Indeed search; only the engine writes it (no column grant).")
- Create: `libs/database/src/migrations/app/<timestamp>_profile_indeed_search/migration.ts` (planned with `pnpm --filter @xjobs/database db:migration:plan`, then edited)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)
- Test: `apps/db-tests/src/search-switches.db.spec.ts` (same setup as `paused-searches.db.spec.ts`)

**Interfaces:**

- Produces column `profiles."indeedSearch"`.
- Produces `public.bump_profile_match_version()`, redefined from the copy in `20261123T1042_paused_searches` (grep later migrations first in case a newer one redefined it). The only change is `'indeedSearch'` added after `'postSearch'` in both arrays.

- [ ] **Step 1: Write the failing db-tests**
  - `indeedSearch defaults to false`: a new profile reads `false`.
  - `switching indeedSearch on a published profile bumps nothing`: as the service role, set `indeedSearch = true`; `matchVersion` is unchanged and `users.searchesResumedAt` is unchanged (set it to a fixed past time first).
  - `switching postSearch still bumps nothing`: the same check for `postSearch`.
  - `a preference edit still bumps`: update `yearsOfExperience`; `matchVersion` goes up by 1 and `searchesResumedAt` is within 5 s of now.
  - `owner cannot write indeedSearch`: an authenticated update of the column fails with a permission error.
- [ ] **Step 2: Run and expect FAIL:** `pnpm db:test`, with the column-missing error.
- [ ] **Step 3: Edit the contract and plan the migration.** Add the column op, plus one `rawSql` op with `id: 'functions.bump_profile_match_version_switches'` and `invariantId: 'profile-switches-no-bump'`. Advance the `db` ref hash, and re-add every earlier invariant plus the new one (see the NOTE in the paused-searches migration). Run `pnpm db:reset` and `pnpm db:types`. If `db:migrate` runs out of memory (#124), split the trigger into a second migration. Don't drop it.
- [ ] **Step 4: Run and expect PASS:** `pnpm db:test`.
- [ ] **Step 5: Commit:** `feat(database): profiles.indeedSearch, switches never bump matchVersion`

### Task 2: The switch registry, recipes and the swap and publish checks

**Files:**

- Create: `apps/xjobs/src/modules/queries/switches.ts`, `apps/xjobs/src/modules/queries/switches.spec.ts`
- Modify: `apps/xjobs/src/modules/queries/index.ts` (export the registry)
- Modify: `apps/xjobs/src/modules/queries/services/queries.service.ts`, `types/query-search.types.ts`, `repositories/queries.repository.ts`, `testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts` (`publish`, `setPostSearch`)
- Test: `queries.service.spec.ts`, `queries.postgres.spec.ts`, `profiles.postgres.spec.ts` (existing `post_search_changed` cases move to `switch_changed`)

**Interfaces:**

- Produces in `switches.ts`:
  ```ts
  export type SearchSwitchKey = 'posts' | 'indeed';
  export type SwitchColumn = 'postSearch' | 'indeedSearch';
  export type SwitchFlags = Record<SwitchColumn, boolean>;
  export type SearchSwitch = {
    key: SearchSwitchKey;
    column: SwitchColumn;
    /** Builders' channel, for detach; null until the channel exists (Indeed: slice 03). */
    channel: Channel | null;
    /** Shown and changeable, for every user. Slice 03 (Indeed) and Phase 4 slice 04b (posts) set it. */
    available: boolean;
    recipes(input: QuerySearchProfileInput): QuerySearchRecipe[];
  };
  export const SEARCH_SWITCHES: readonly SearchSwitch[]; // posts: postSearch, LINKEDIN_POSTS, false, postRecipes; indeed: indeedSearch, null, false, () => []
  export const SEARCH_SWITCHES_TOKEN: unique symbol; // Nest provider token, default value SEARCH_SWITCHES
  export function switchFlags(row: Pick<ProfileRow, SwitchColumn>): SwitchFlags;
  export function switchesInEffect(flags: SwitchFlags, registry?: readonly SearchSwitch[]): SearchSwitch[]; // flag on, whatever `available` says
  ```
  Put a comment on `SEARCH_SWITCHES`: a new switch column must also join `bump_profile_match_version`'s exclusion arrays.
- Changes `QuerySearchService.recipesFor(input, flags?: SwitchFlags): QuerySearchRecipe[]`. Board recipes come first, then each in-effect switch's recipes in registry order; no flags means board recipes only. `generate(profileId, input, flags?)` follows.
- Replaces `attachPosts` with `attachSwitch(profileId: string, sw: SearchSwitch, input: QuerySearchProfileInput): Promise<QuerySearchAttachResult>`.
- Changes `QuerySearchReplaceExpected` to `{ searchesVersion: number; switches: SwitchFlags }` and `QuerySearchReplaceSkip` to `'not_published' | 'switch_changed'`.
- Changes `ProfilesRepository.publish(userId, profileId, publishedAt, searchesVersion, switches: SwitchFlags)`. Its `CASE` requires every column to equal what was read.
- Replaces `ProfilesRepository.setPostSearch` with `setSwitch(userId: string, profileId: string, column: SwitchColumn, enabled: boolean): Promise<ProfileWithSkills | null>`.

- [ ] **Step 1: Write the failing tests**
  - `switches.spec.ts`:
    - `lists posts and indeed, both unavailable`.
    - `in effect when the flag is on, available or not`: `switchesInEffect({ postSearch: true, indeedSearch: false })` returns `['posts']` by key.
    - `indeed adds no recipes`.
  - `queries.service.spec.ts`: `recipesFor adds post recipes when postSearch is on`; `recipesFor with no flags is board recipes only`.
  - `queries.postgres.spec.ts`: `skips when indeedSearch moved since the read`. Read with both false, set `indeedSearch = true` on the row, then call `replace` with `switches: { postSearch: false, indeedSearch: false }`. Expect `skipped: 'switch_changed'` and no link changes.
  - `profiles.postgres.spec.ts`: `publish leaves searchesVersion null when indeedSearch moved`.
- [ ] **Step 2: Run and expect FAIL:** `npx nx test xjobs -- switches queries profiles`. The Postgres specs need the `processor_test` DB; see memory `processor-test-db-recipe`.
- [ ] **Step 3: Implement.** In the swap, the early short-cut and the final `UPDATE … WHERE` compare `"postSearch"` and `"indeedSearch"` against `expected.switches`, written out for the two columns (the spec allows it). The fake repository mirrors that.
- [ ] **Step 4: Run and expect PASS**, then `npx nx typecheck xjobs`. Callers in `users` break until Task 3. Make Tasks 2 and 3 one commit if the typecheck must stay green.
- [ ] **Step 5: Commit:** `feat(queries): search switch registry, swap and publish check every switch`

### Task 3: Every search path reads the registry; the allow-list goes

**Files:**

- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts` (`regeneratePublished`, `RegenerateDeps`, `RegenerateResult`, `publish`)
- Modify: `apps/xjobs/src/modules/users/services/profile-search-sync.ts`
- Modify: `apps/xjobs/src/scripts/regenerate-query-search.ts`, `apps/xjobs/src/scripts/publish-drafts.ts`
- Modify: `apps/xjobs/src/modules/users/profile-search.module.ts` (drop `PostSearchAccess`, provide `SEARCH_SWITCHES_TOKEN`)
- Modify: `apps/xjobs/src/config/environment.validation.ts`, `apps/xjobs/src/config/index.ts`
- Delete: `apps/xjobs/src/modules/users/services/post-search-access.ts`, `post-search-access.spec.ts`
- Test: `profile-search-sync.spec.ts`, `regenerate.spec.ts`, `profiles.service.spec.ts`

**Interfaces:**

- Consumes: `switchFlags`, `switchesInEffect`, `recipesFor(input, flags)`, `replace(…, { searchesVersion, switches })`, and the new `publish` signature (Task 2).
- `RegenerateDeps` loses `postsAllowed`.
- `RegenerateResult` replaces `postsKept` and `postsDropped` with `switchesOn: Record<SearchSwitchKey, number>`: the profiles regenerated with each switch in effect. The script logs one line, `Switches on: posts <n>, indeed <n>`.
- `environment.validation.ts`: `postSearchShape` becomes `const userIdList = z.string().default('').transform(…)` (same split, trim and filter). `ADMIN_USERS: userIdList`. `POST_SEARCH_USERS` and `postSearchEnvironmentSchema` are removed.

- [ ] **Step 1: Write the failing tests**
  - `profile-search-sync.spec.ts`: `keeps post recipes for a hidden switch that is on`. A profile has `postSearch: true`, with no access object; the recipes passed to `replace` include post recipes and `expected.switches` is `{ postSearch: true, indeedSearch: false }`.
  - `regenerate.spec.ts`: `counts switches on per key` (`switchesOn.posts === 1`, `switchesOn.indeed === 0`). Also rename the skip case to `switch_changed`.
  - `profiles.service.spec.ts`: `publish attaches post recipes for any user with postSearch on`. The user is no longer on any list.
- [ ] **Step 2: Run and expect FAIL:** `npx nx test xjobs -- profile-search-sync regenerate profiles.service`.
- [ ] **Step 3: Implement:** replace every `profile.postSearch && …allows(…)` with `switchFlags(profile)`, and remove the files and env above. `publish-drafts.ts` drops its `PostSearchAccess` construction and its header note about `POST_SEARCH_USERS`.
- [ ] **Step 4: Run and expect PASS:** `npx nx test xjobs` and `npx nx typecheck xjobs`. Then `grep -rn 'POST_SEARCH_USERS\|PostSearchAccess' apps libs` must return nothing.
- [ ] **Step 5: Commit:** `feat(users): search paths read the switch registry; drop POST_SEARCH_USERS`

### Task 4: Engine endpoints and the `/post-search` wrappers

**Files:**

- Create: `apps/xjobs/src/modules/users/dto/search-switch.dto.ts` (replaces `post-search.dto.ts`, which keeps only what the wrappers need)
- Modify: `apps/xjobs/src/modules/users/controllers/profiles.controller.ts`, `services/profiles.service.ts`, `types/profile.types.ts`
- Modify: `apps/xjobs/src/common/enums/error-code.enum.ts` (remove `POST_SEARCH_NOT_ALLOWED`)
- Test: `profiles.controller.spec.ts`, `profiles.service.spec.ts`

**Interfaces:**

- Produces types:
  - `SearchSwitchView = { key: SearchSwitchKey; enabled: boolean; searches: number }`. `searches` is `sw.recipes(input).length`.
  - `PostSearchView` stays `{ enabled; allowed; searches }` for the wrappers.
- Produces `ProfilesService` methods (inject `SEARCH_SWITCHES_TOKEN` so tests can pass a registry with an available switch):
  - `searchSwitches(userId, profileId): Promise<SearchSwitchView[]>`: only available switches, in registry order.
  - `setSearchSwitch(userId, profileId, key: string, enabled: boolean): Promise<SearchSwitchView>`. An unknown or unavailable key throws `NotFoundException` before any write. On a published profile it calls `attachSwitch` or `detachChannel(profileId, sw.channel)` (skipped when the channel is null), and on failure it puts the flag back and rethrows.
  - `postSearchStatus` returns `{ enabled, allowed: <posts available>, searches }`. `setPostSearch` delegates to `setSearchSwitch(…, 'posts', …)` and maps the view back.
- Produces routes `GET /api/profiles/:profileId/searches` and `PUT /api/profiles/:profileId/searches/:key` (body `{ enabled: boolean }` with `IsBoolean`; `key` is a plain string param, and the service 404s anything not in the registry), both with Swagger decorators like the existing ones.

- [ ] **Step 1: Write the failing tests** (`profiles.service.spec.ts`, with a test registry where `posts` is available):
  - `lists only available switches`; with the real registry, the list is `[]`.
  - `refuses an unavailable switch without writing`: with the real registry, `setSearchSwitch(…, 'posts', true)` throws `NotFoundException`, and the repository's `setSwitch` and `attachSwitch` are never called.
  - `refuses an unknown key` (`'glassdoor'`) the same way.
  - `another user's profile is not found` on both methods.
  - `attaches on, detaches off on a published profile`, and `puts the flag back when attach fails`.
  - `any user may change an available switch`.
  - Wrappers: `postSearchStatus answers allowed false while posts is unavailable`; `setPostSearch is not found while posts is unavailable`.
  - Controller spec: the two routes call the service with the user id, profile id, key and body.
- [ ] **Step 2: Run and expect FAIL:** `npx nx test xjobs -- profiles`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS:** `npx nx test xjobs`, then `npx nx e2e xjobs-e2e` if it covers profile routes.
- [ ] **Step 5: Commit:** `feat(engine): search switch endpoints for every user`

### Task 5: Engine client

**Files:**

- Modify: `libs/engine-client/src/client.ts`, `libs/engine-client/src/index.ts`
- Test: `libs/engine-client/src/client.spec.ts`

**Interfaces:**

- Produces `SearchSwitchKey`, `SearchSwitchView` (same shapes as Task 4), and:
  - `searchSwitches(profileId: string): Promise<EngineResult<SearchSwitchView[]>>`
  - `setSearchSwitch(profileId: string, key: SearchSwitchKey, enabled: boolean): Promise<EngineResult<SearchSwitchView>>`
- Both use the same auth, timeout, logging and invalid-UUID handling as the existing `postSearch` helper; generalise it rather than copying it. A 404 maps to `not-found`, and a body that fails the shape check maps to `failed`.
- `postSearchStatus` and `setPostSearch` stay. Drop the 403 `POST_SEARCH_NOT_ALLOWED` test case, since the engine no longer sends it.

- [ ] **Step 1: Write the failing tests:**
  - `searchSwitches returns the list`.
  - `searchSwitches maps a malformed list to failed` (an item missing `searches`).
  - `setSearchSwitch PUTs to /searches/<key> with { enabled }`.
  - `an invalid profile id is not-found without a request`.
- [ ] **Step 2: Run and expect FAIL:** `npx nx test engine-client` (check the project name with `npx nx show projects`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS.**
- [ ] **Step 5: Commit:** `feat(engine-client): search switches`

### Task 6: Web: the shared switch section

**Files:**

- Create: `apps/web/src/components/preferences/search-switches-section.tsx`, `search-switch.tsx`, `search-switch.spec.tsx`, `search-switches-section.spec.tsx`
- Delete: `post-search-section.tsx`, `post-search-switch.tsx`, `post-search-switch.spec.tsx`
- Modify: `apps/web/src/app/(app)/preferences/profiles/[profileId]/layout.tsx` (render `SearchSwitchesSection` in the same `Suspense` slot), `apps/web/src/app/(app)/preferences/actions.ts`

**Interfaces:**

- Consumes: `searchSwitches` and `setSearchSwitch` (Task 5).
- Produces:
  - `setSearchSwitchAction(profileId: string, key: SearchSwitchKey, enabled: boolean): Promise<'saved' | 'failed'>`. It validates the id and key (`'posts' | 'indeed'`) and the boolean.
  - `SearchSwitch({ profileId, view }: { profileId: string; view: SearchSwitchView })`: the same optimistic flip, revert and `notifySaveFailed()` as today. Label and copy come from a per-key map: posts is today's copy, including the zero-searches line; indeed uses the Global Constraints copy.
  - `SearchSwitchesSection({ profileId })`: one call, one `SearchSwitch` per item, and `null` on any non-ok result, an empty list or a throw.

- [ ] **Step 1: Write the failing tests:**
  - `search-switch.spec.tsx`: port the three existing cases (label and description, the zero-searches line for posts, revert on failure); add `shows the Indeed label and description`.
  - `search-switches-section.spec.tsx`:
    - `renders one switch per item`.
    - `renders nothing for an empty list`.
    - `renders nothing when the engine has no searches route` (the client returns `not-found`).
    - `renders nothing when the engine throws`.
- [ ] **Step 2: Run and expect FAIL:** `npx nx test web -- search-switch`.
- [ ] **Step 3: Implement.** Remove `setPostSearchAction` once nothing imports it.
- [ ] **Step 4: Run and expect PASS:** `npx nx run-many -t lint test typecheck -p web`.
- [ ] **Step 5: Commit:** `feat(web): shared search switches on the profile page`

### Task 7: Docs, full CI and the PR

**Files:**

- Modify: `CLAUDE.md`:
  - `worker-linkedin-posts`: "needs a published profile with post search on"; drop the `POST_SEARCH_USERS` clause.
  - `db:regenerate` and `db:publish-drafts`: drop the `POST_SEARCH_USERS` requirement.
- Modify: `.env.example`, `deploy/engine/.env.example`: remove `POST_SEARCH_USERS`.
- Modify: `deploy/engine/README.md`, LinkedIn posts section: step 2 goes. Post search is a per-profile switch, hidden until Phase 4 slice 04b makes it available.
- Modify: `docs/roadmap/phase-4-social-posts/04b-open-post-search.md`: the allow-list was removed in Phase 5 slice 02. 04b sets the posts switch's `available` and shares the budget.
- Modify: `docs/roadmap/phase-5-indeed/README.md` and `02-indeed-switch.md`: status "Built (spec)", and link the spec.
- Modify: `docs/superpowers/specs/2026-11-24-indeed-switch-design.md`: set `Status:` to approved.

- [ ] **Step 1: Make the edits above.**
- [ ] **Step 2: Run CI locally:** `npx nx run-many -t lint test build typecheck`, and expect all green. `pnpm db:test` must pass too.
- [ ] **Step 3: Run the grep check:** `grep -rn 'POST_SEARCH_USERS' --exclude-dir=node_modules --exclude-dir=docs .` returns nothing, apart from past specs and plans under `docs/superpowers`.
- [ ] **Step 4: Commit:** `docs: post search allow-list gone, search switches`
- [ ] **Step 5: Push and open the PR:** `git push -u origin feat/indeed-switch`, then `gh pr create --base main`. The body lists the rollout:
  1. The migration applies on dev at deploy.
  2. Remove `POST_SEARCH_USERS` from the hosted engine `.env` (harmless if left).
  3. On dev, the owner's profile page shows no search switch.
  4. The owner's `LINKEDIN_POSTS` builders are still attached (join `ProfileQuerySearchBuilder` to `query_search_builder` for profile `9074f82b-…`), and the next hourly posts tick still collects.
  5. No regenerate is needed.

  End the body with the Claude Code attribution line.

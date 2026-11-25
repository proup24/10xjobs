# Ingest and Qualify LinkedIn Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide every processed post role job against each profile with post search on, with the listing rules plus three post checks. Add per-user blocked authors. Link a role to any job sharing one of its keys, so a decision on one counts for the whole group. Let lead-level roles satisfy `tech_lead` profiles.

**Architecture:** Role jobs (`kind = 'post_role'`) join the matcher's matchable set. Their facts come from the role extraction alone, and three checks (`hiringVerdict`, `blockedAuthor`, `postAge`) are appended to role decisions only. Links are resolved on read: each role stores `linkKeys`, and a SQL function computes a job's linked group from `jobKey`, LinkedIn source ids and other roles' `linkKeys`. Post matches stay out of the web app's matches views (`match_details` gets `p_kind`, default `'job'`) and out of webhooks until slice 04a.

**Tech Stack:** NestJS engine (`apps/xjobs`), Prisma-next contract and migrations (`libs/database`), Postgres SQL functions, Vitest, Postgres specs on the disposable `processor_test` DB, `apps/db-tests` for RLS and RPCs.

**Spec:** `docs/superpowers/specs/2026-11-25-posts-qualify-design.md`

## Global Constraints

- Ship as three PRs to `main`, in order: **PR A** (Tasks 1–4) matching posts, **PR B** (Tasks 5–6) links and shared decisions, **PR C** (Task 7) tech lead. PR A's branch starts from `docs/phase-4-slice-04-ingest-qualify`, so it carries the spec and plan commits; PRs B and C branch from `main` after the previous one merges.
- **Deploy gate:** no PR of this plan deploys before the separate credits and capacity brainstorm's fix is live (spec, Constraints). Put this at the top of each PR body.
- Contract changes only in `libs/database/src/contract/contract.prisma` (RLS included). Each migration: advance `libs/database/src/migrations/app/refs/db.json` to the new hash, re-add every earlier invariant (the ref rewrite drops them), and run `pnpm db:types` (CI diffs `database.types.ts`).
- A listing's decision keeps exactly its ten checks, in today's order. Role decisions have thirteen: the ten, then `hiringVerdict`, `blockedAuthor`, `postAge`.
- `POST_MAX_AGE_DAYS = 30`.
- `MATCHER_VERSION`: 11 → 12 in Task 4, 12 → 13 in Task 7.
- Reasons, verbatim: `you blocked <name>` (fall back to the author key when the name is empty); `posted <n> days ago`; `the post's hiring verdict is unsure`; `the post is hiring`; `the post's date is unknown`; `lead-level <roleKind> counts for tech_lead`.
- Engine Vitest runs with `CI=1` (watch mode hangs otherwise): `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts <path>`.
- Postgres specs need `PROCESSOR_TEST_DATABASE_URL` (the `processor_test` DB). They skip without it, and a skipped spec doesn't count as passing: run them.

## Review Focus

1. **A profile with post search off must not make the sweep loop.** If `STALE_ROW` counts profiles that never get a role row, the sweep re-enqueues every role job every minute forever. Test: Task 4, `listStaleJobs` returns nothing once every postSearch profile has its row.
2. **Turning post search off, or archiving a role, must delete its rows.** Otherwise old qualified posts linger for slice 05. Test: Task 4, `deleteInactive`.
3. **A share's age is the original's.** A fresh reshare of a 40-day-old post is rejected, and a role qualified on day 29 is re-decided after day 30 with no new observation. Tests: Task 2 (role `postedAt`) and Task 4 (age staleness).
4. **A blocked sharer blocks the post, not only the original author.** Test: Task 3, `checkBlockedAuthor` with the key only on a sharer.
5. **A `linkedin-job:<id>` key must find a listing keyed by its apply URL.** Test: Task 6, `job_link_group`, with a listing whose `jobKey` is `url:…` and whose harvestapi source is `id:<id>`.

---

## PR A: matching posts

### Task 1: Contract — blocked authors, `match_details` kind filter, listing-only webhooks

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (new `BlockedAuthor` model and policies, relation on `User`)
- Create: `libs/database/src/migrations/app/<stamp>_post_matching/{migration.ts,migration.json,ops.json}` (via `pnpm --filter @xjobs/database db:migration:plan`, then edit like `20261124T1043_profile_indeed_search`)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts`
- Test: `apps/db-tests/src/blocked-authors.db.spec.ts` (new), `apps/db-tests/src/match-details.db.spec.ts`, `apps/db-tests/src/eligibility-version.db.spec.ts`

**Interfaces:**

- Produces: table `blocked_authors` (`id uuid`, `userId uuid` → users cascade, `authorKey text`, `profileUrl text null`, `name text null`, timestamps, unique `(userId, authorKey)`, index `userId`, check `authorKey ~ '^(profile|company):.+$'`). RLS: owner `select`, `insert` and `delete` (`"userId" = auth.uid()`). No update policy.
- Produces: an `AFTER INSERT OR DELETE` trigger on `blocked_authors` running the existing `public.bump_eligibility_version()` (its non-`users` branch already bumps `OLD/NEW."userId"`).
- Produces: `match_details(p_profile_id, p_outcome, p_since, p_job_id, p_details, p_kind text DEFAULT 'job')`, which adds `AND (p_kind IS NULL OR j.kind = p_kind)`. Drop the old 5-argument signature in the same migration, and re-grant to `authenticated` only. The body is otherwise copied from the latest definition (`20261121T1131_profile_edits`).
- Produces: `webhook_enqueue_match` (latest body, from `20261116T0829_webhook_hardening` if that one redefines it, else `20261116T0641_match_webhooks`) with `AND j.kind = 'job'` added to its `INSERT … SELECT`.

- [ ] **Step 1: Write the failing db-tests**
  - `blocked-authors.db.spec.ts`:
    - user A inserts `{authorKey:'profile:jane'}` and reads it back;
    - user B sees 0 rows of A's;
    - B can't insert with `userId = A`;
    - A can't update;
    - a second insert of the same key fails (unique);
    - `authorKey:'jane'` fails the check.
  - `eligibility-version.db.spec.ts`: inserting and deleting a blocked author each raise `users.eligibilityVersion` by 1.
  - `match-details.db.spec.ts`: seed one `kind='job'` and one `kind='post_role'` match for the user. `match_details()` returns only the job, `match_details(p_kind => 'post_role')` only the role, `p_kind => null` both.
  - Webhook: in the existing webhook db spec (or a new case in `match-details.db.spec.ts` if none exists), `webhook_enqueue_match` on a `post_role` match with an enabled webhook returns null and inserts no delivery.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm db:test -- blocked-authors match-details eligibility-version`. Expected: FAIL (no table, no `p_kind`).
- [ ] **Step 3: Contract and migration.** Edit the contract, plan the migration, add the trigger and the two functions as `rawSql` operations (pattern: `20261124T1043_profile_indeed_search`), with invariant ids `blocked-authors-eligibility`, `match-details-kind` and `webhook-listings-only`. Advance `refs/db.json`, re-add the earlier invariants, then run `pnpm db:reset` and `pnpm db:types`.
- [ ] **Step 4: Run the db-tests and see them pass.** Run `pnpm db:test`. Expected: all PASS, including the existing `match-details` and `isolation` suites.
- [ ] **Step 5: Check the web callers.** `apps/web/src/lib/matches/load.ts`, `report.ts` and `webhook/load.ts` call `match_details` without `p_kind`, so they get listings only. Confirm that `npx nx run-many -t typecheck -p web` passes with the regenerated types.
- [ ] **Step 6: Commit.** Message: `feat(database): blocked authors, match_details kind filter, listing-only webhooks`.

### Task 2: Processor — role job dates, and matching each role

**Files:**

- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts` (`upsertRoleJob`, a new `listRoleJobIds`)
- Modify: `apps/xjobs/src/modules/processor/testing/fakes.ts` (fake repo)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/process/processor.ts`
- Modify: `apps/xjobs/src/modules/processor/README.md` (Role jobs bullet)
- Test: `apps/xjobs/src/modules/processor/repositories/processor.postgres.spec.ts` (existing role-job cases), `apps/xjobs/src/infrastructure/jobs/steps/process/processor.spec.ts`

**Interfaces:**

- Produces: `upsertRoleJob` sets the role's `postedAt` to the **original post's date**: the earliest non-null `original.postedAt` across `parent.postSources.sources`, else the earliest source `postedAt`, else `parent.postedAt`.
- Produces: `ProcessorRepository.listRoleJobIds(postJobId: string): Promise<string[]>` — `kind = 'post_role'`, `parentJobId = postJobId`, `processingStatus = 'processed'`, `status = 'active'`.
- Produces: in `processProcessJob`, after `processed`/`reused`, the role ids of that job are enqueued on `matchQueue` too. For a listing the list is empty. The existing enqueue of the job id stays.

- [ ] **Step 1: Write the failing tests**
  - Postgres: `upsertRoleJob sets postedAt to the original's date`. The parent `postSources.sources = [{postedAt:'2026-11-20T…', original:{postedAt:'2026-10-01T…'}}]`, so the role's `postedAt` is `2026-10-01`. A second case with no original falls back to the source's `postedAt`.
  - Postgres: `listRoleJobIds lists processed active roles only`. Of three roles (processed, archived, processed), it returns the two processed ids.
  - `processor.spec.ts`: `a processed post enqueues its role jobs for matching`. With the fake repo returning `['r1','r2']`, `matchQueue.enqueue` is called with the post id, `r1` and `r2`.
- [ ] **Step 2: Run them and see them fail.** Run `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor src/infrastructure/jobs/steps/process`. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement** the date choice in `upsertRoleJob` (read the parent's `postSources` in the same transaction it already locks), `listRoleJobIds`, its fake, and the enqueue loop. Each role enqueue is wrapped in the same try/warn as the existing one.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(processor): role jobs carry the original's date and are sent to matching`.

### Task 3: Matcher rules — the three post checks

**Files:**

- Create: `apps/xjobs/src/modules/matcher/rules/post.ts`
- Modify: `apps/xjobs/src/modules/matcher/rules/types.ts`, `rules/decide.ts`, `rules/fixtures.testing.ts`, `config/matcher.config.ts`
- Modify: `libs/database/src/matches/checks.ts` (`RULE_LABELS`)
- Test: `apps/xjobs/src/modules/matcher/rules/post.spec.ts` (new), `rules/decide.spec.ts`, `libs/database/src/matches/checks.spec.ts`

**Interfaces:**

- Produces in `types.ts`:
  - `RuleName` gains `'hiringVerdict' | 'blockedAuthor' | 'postAge'`.
  - `export interface PostContext { verdictConfidence: 'sure' | 'unsure'; authors: { key: string; name: string }[]; ageDays: number | null }`.
  - `MatchJob.post: PostContext | null` (null for listings).
  - `MatchProfile.blockedAuthors: string[]` (the user's keys).
  - `MatchProfile.postSearch: boolean`.
- Produces in `post.ts`:
  - `checkHiringVerdict(post: PostContext): Check`. Unsure gives `fail` with `restsOn('verdict')` and the reason `the post's hiring verdict is unsure`. Sure gives `pass` with `the post is hiring`.
  - `checkBlockedAuthor(post: PostContext, blocked: string[]): Check`. A blocked key gives a sure `fail` with `you blocked <name>` (`jobValue` = the matched keys). Otherwise `pass` with `no author you blocked`.
  - `checkPostAge(post: PostContext): Check`. `null` gives `unknown` with `the post's date is unknown`. More than `POST_MAX_AGE_DAYS` gives a sure `fail` with `posted <n> days ago` (n = `Math.floor(ageDays)`). Otherwise `pass` with `posted <n> days ago`.
- Produces in `matcher.config.ts`: `export const POST_MAX_AGE_DAYS = 30`.
- Produces in `decide.ts`: when `job.post !== null`, the three checks are appended after `workAuthorization`. Update the `checks` doc comment to "ten checks for a listing, thirteen for a post role".
- Produces in `checks.ts`: `RULE_LABELS` gains `hiringVerdict: 'Hiring post'`, `blockedAuthor: 'Blocked author'`, `postAge: 'Post age'`.

- [ ] **Step 1: Write the failing tests**
  - `post.spec.ts`:
    - `unsure verdict fails as unsure on verdict`: outcome `fail`, `unsure: true`, `unsureField: 'verdict'`.
    - `sure verdict passes`.
    - `a blocked sharer blocks the post`: authors `[{key:'profile:orig'},{key:'profile:sharer',name:'Sam'}]`, blocked `['profile:sharer']`, so a sure `fail` with reason `you blocked Sam`.
    - `empty name falls back to the key`.
    - `age 30.9 passes, 31 fails with "posted 31 days ago"`.
    - `null age is unknown`.
  - `decide.spec.ts`:
    - `a listing keeps ten checks`: `post: null` gives `checks.length === 10`.
    - `a role has thirteen, in order`, ending in `hiringVerdict`, `blockedAuthor`, `postAge`.
    - `unsure verdict on an otherwise qualified role is review on hiringVerdict/verdict`.
    - `a blocked author rejects an otherwise qualified role`.
    - `old original rejects`.
    - `unknown post age leaves the role qualified and unverified`.
  - `checks.spec.ts`: `ruleLabel('blockedAuthor') === 'Blocked author'`.
- [ ] **Step 2: Run them and see them fail.** Run `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts src/modules/matcher/rules` and `npx nx test database`. Expected: FAIL.
- [ ] **Step 3: Implement** `post.ts`, the type changes and the decide append. Fixtures default to `post: null`, `blockedAuthors: []` and `postSearch: false`, plus a `rolePost(overrides)` fixture helper returning a sure, unblocked, 2-day-old `PostContext`. Add the labels.
- [ ] **Step 4: Run them and see them pass.** Same commands. Expected: PASS. All existing `decide.spec.ts` cases are unchanged.
- [ ] **Step 5: Commit.** Message: `feat(matcher): hiring verdict, blocked author and post age checks for post roles`.

### Task 4: Matcher repository and service — role jobs become matchable

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/repositories/matcher.repository.ts`, `testing/memory-matcher.repository.ts`, `services/matcher.service.ts`, `config/matcher.config.ts` (`MATCHER_VERSION = 12`)
- Modify: `apps/xjobs/src/scripts/match-shares.ts` (split by job kind)
- Modify: `apps/xjobs/src/modules/matcher/README.md` (Matchable jobs, Rules, Flow step 3, the new checks, `blocked_authors`)
- Test: `repositories/matcher.postgres.spec.ts`, `services/matcher.service.spec.ts`

**Interfaces:**

- Consumes: `PostContext`, `MatchProfile.blockedAuthors` and `MatchProfile.postSearch` (Task 3), `blocked_authors` (Task 1), role `postedAt` (Task 2).
- Produces: `matchable(raw)` becomes `j.status = 'active' AND ((j.kind = 'job' AND j.id IN (linkedInJobIds)) OR j.kind = 'post_role') AND …`, with the rest unchanged. `archived` stays excluded because only `processingStatus = 'processed'` is allowed.
- Produces: `MatchCandidate` gains `kind: 'job' | 'post_role'` and `post: { verdictConfidence: 'sure' | 'unsure'; authors: { key: string; name: string }[]; postedAt: Date | null } | null`. For a role, `loadCandidate` reads:
  - `verdictConfidence` from the parent's current extraction (`docType = 'post'`); a null confidence counts as `unsure`;
  - the authors from the parent's `postSources->'sources'`: each `author` and each non-null `original.author`, deduplicated by key;
  - `postedAt` from the role job.
- Produces: `MatcherService.matchJob` builds `job.post` with `ageDays = (this.now() - postedAt) / 86_400_000` (null when `postedAt` is null). For a role job it keeps only the profiles with `postSearch`.
- Produces: `listPublishedProfiles` fills `postSearch` and `blockedAuthors` (one query over `blocked_authors` for the batch's users).
- Produces: `STALE_ROW` and the `onlyStaleFor` query count a profile for a `post_role` job only when `p."postSearch"`. A role row is also stale when `j.kind = 'post_role' AND j."postedAt" + make_interval(days => POST_MAX_AGE_DAYS) <= now() AND m."updatedAt" < j."postedAt" + make_interval(days => POST_MAX_AGE_DAYS)`.
- Produces: `deleteInactive()` also deletes rows whose job has `processingStatus = 'archived'`, and rows of `post_role` jobs whose profile has `postSearch = false`. It returns the total.
- Produces: `db:match-shares` prints its tables once per job kind (`job`, `post_role`).

- [ ] **Step 1: Write the failing Postgres tests** in `matcher.postgres.spec.ts`:
  - `a processed post_role job is matchable; an archived one is not`.
  - `loadCandidate reads the parent's verdict confidence, every author, and the role's postedAt`: the parent has two sources, one a share with an original author.
  - `listStaleJobs ignores profiles with post search off for role jobs`: after matching for the one postSearch profile, `listStaleJobs` is `[]` (Review Focus 1).
  - `a role row decided before its original turned 30 is stale after`: the role `postedAt` is now − 31 days, and the row's `updatedAt` is now − 2 days.
  - `deleteInactive deletes rows of archived roles and of profiles with post search off` (Review Focus 2).
  - `listPublishedProfiles loads each user's blocked authors`.
- [ ] **Step 2: Write the failing service tests** in `matcher.service.spec.ts`, with the memory repo:
  - `a role job is decided only for postSearch profiles`.
  - `a role carries thirteen checks; a listing ten`.
  - `ageDays is computed from the matcher clock`: a clock at `postedAt` + 31 days gives a `postAge` fail.
- [ ] **Step 3: Run them and see them fail.** Run `CI=1 PROCESSOR_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts src/modules/matcher`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement** the repository, memory repo and service changes and the `MATCHER_VERSION` bump. Then add the kind split to `match-shares.ts`.
- [ ] **Step 5: Run them and see them pass.** Same command. Expected: PASS, with no skipped Postgres spec.
- [ ] **Step 6: Run the whole engine suite.** Run `CI=1 npx nx test xjobs` and `npx nx run-many -t lint typecheck build`. Expected: green.
- [ ] **Step 7: Update the READMEs.** The matcher README covers matchable jobs, the three checks, `postSearch`, age staleness and blocked authors. The processor README covers role `postedAt` and the match enqueue.
- [ ] **Step 8: Commit, push and open PR A.** Commit message: `feat(matcher): decide post role jobs for profiles with post search on`. Push with `git push -u origin feat/posts-qualify-match`, then `gh pr create`. The body has:
  - the deploy gate;
  - the rollout steps: deploy, `db:rematch -- --all`, then the spec's "Rollout check on dev" items for PR A;
  - a reminder that existing role jobs get their new `postedAt` only from PR B's backfill, so until then their age is the share's date.

## PR B: links and shared decisions

### Task 5: Link keys on role jobs, with a backfill

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/job-key.ts` (export `linkKeysOf`)
- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts` (`RoleJobInput.linkKeys`, written by `upsertRoleJob`), `services/post-store.service.ts` (`writeRoleJobs`), `testing/fakes.ts`
- Modify: `libs/database/src/contract/contract.prisma` (`NormalizedJob.linkKeys String[] @default([])`), plus a new migration `<stamp>_role_link_keys` with a GIN index on `"linkKeys"` (`rawSql` if the contract can't express GIN). Then refs and types as in Task 1.
- Create: `apps/xjobs/src/scripts/role-links.ts`, plus the `db:role-links` entry in `apps/xjobs/package.json` and a line in `CLAUDE.md` Commands
- Test: `apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts`, `post-store.service.spec.ts`, `processor.postgres.spec.ts`, `apps/xjobs/src/scripts/role-links.spec.ts`

**Interfaces:**

- Produces: `linkKeysOf(links: string[]): string[]`, sorted and unique. For each link:
  - a LinkedIn `/jobs/view/<id>` URL gives `linkedin-job:<id>`;
  - else `atsKey(link)` gives `ats:…`;
  - else `canonicalApplyUrl(link)` gives `url:<canonical>` when it matches `normalizeConfig.identifierPattern`, the same rule as `jobKey`;
  - anything else is dropped.
- Produces: `RoleJobInput.linkKeys: string[]`. `writeRoleJobs` passes `linkKeysOf(role.howToApply.links)`.
- Produces: `db:role-links [--dry-run]` recomputes, for every `post_role` job, `linkKeys` from its parent's current post extraction (the matching `roleKey`) and `postedAt` by Task 2's rule. It prints the count changed. Remote needs `XJOBS_ALLOW_REMOTE_DB=1`, like `db:publish-drafts`.

- [ ] **Step 1: Write the failing tests**
  - `job-key.spec.ts`, `linkKeysOf`:
    - `https://www.linkedin.com/jobs/view/4490421090/?trk=x` gives `linkedin-job:4490421090`;
    - a Greenhouse posting gives its `ats:` key;
    - a Lever URL with an id gives `url:…`;
    - `https://example.com/careers` gives nothing;
    - duplicates are removed and the output sorted.
  - `post-store.service.spec.ts`: `role jobs get the link keys of their links`.
  - `processor.postgres.spec.ts`: `upsertRoleJob writes linkKeys`.
  - `role-links.spec.ts`: on a role with empty `linkKeys` and the share's `postedAt`, the script fills both. `--dry-run` writes nothing.
- [ ] **Step 2: Run them and see them fail.** Run `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/normalize/job-key.spec.ts src/modules/processor src/scripts/role-links.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the contract and migration, `linkKeysOf`, the writer and the script.
- [ ] **Step 4: Run them and see them pass.** Same command, then `pnpm db:test`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `feat(processor): role jobs store the job keys their links resolve to`.

### Task 6: Linked groups and shared decisions

**Files:**

- Create: migration `<stamp>_job_link_group` (`rawSql`), then refs and types
- Modify: the `match_details` body: `decisionStatus` becomes the group's
- Test: `apps/db-tests/src/job-link-group.db.spec.ts` (new), `apps/db-tests/src/match-details.db.spec.ts`

**Interfaces:**

- Produces: `public.job_link_keys(p_job uuid) RETURNS text[]` (STABLE, SECURITY DEFINER, `search_path = ''`, not granted to clients). For a role it returns `linkKeys`. For a job it returns `jobKey` plus `'linkedin-job:' || substr(r."sourceKey", 4)` for each of its LinkedIn job-board sources whose `sourceKey` starts with `id:`.
- Produces: `public.job_link_group(p_job uuid) RETURNS SETOF uuid` (same attributes). A recursive CTE over active jobs: start from `p_job`; a step adds active jobs whose `jobKey` is in the current keys, roles whose `linkKeys && keys`, and jobs whose LinkedIn source ids are in the keys; stop at depth 4. It always includes `p_job`.
- Produces: `public.group_decision_status(p_user uuid, p_job uuid) RETURNS text`, the status of the user's most recent `job_decisions` row (by `decidedAt`) on any job in the group, else null. Granted to nobody: `match_details` (SECURITY DEFINER) calls it with `(SELECT auth.uid())`.
- Produces: `match_details."decisionStatus"` becomes `COALESCE(jd.status, public.group_decision_status((SELECT auth.uid()), m."jobId"))`.

- [ ] **Step 1: Write the failing db-tests** in `job-link-group.db.spec.ts`:
  - `a role linking linkedin-job:<id> finds the listing keyed url:… through its harvestapi source id:<id>` (Review Focus 5);
  - `two roles sharing an ats: key are one group with no listing`;
  - `role A → listing → role B is one group`;
  - `an unlinked job's group is itself`;
  - `a merged (status <> 'active') job is not in a group`.
  - In `match-details.db.spec.ts`: `an applied decision on the listing shows as decisionStatus 'applied' on the linked role's row` (with `p_kind => 'post_role'`), and the reverse.
- [ ] **Step 2: Run them and see them fail.** Run `pnpm db:test -- job-link-group match-details`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration: three functions plus the `match_details` replacement (same signature as Task 1), with invariant `job-link-group`.
- [ ] **Step 4: Run them and see them pass.** Run `pnpm db:test`. Expected: PASS. Then run `EXPLAIN ANALYZE SELECT * FROM match_details()` locally on seeded data to confirm the per-row group lookup uses the `jobKey` unique index, the `raw_items (channel, sourceKey)` index and the `linkKeys` GIN index. Note the timing in the PR body.
- [ ] **Step 5: Commit, push and open PR B.** Commit message: `feat(database): linked job groups share the user's decision`. Push with `git push -u origin feat/posts-qualify-links`, then `gh pr create`. The body has:
  - the deploy gate;
  - the rollout steps: deploy, `db:role-links --dry-run`, then `db:role-links`, then `db:rematch -- --all` (role `postedAt` changed);
  - the check: count of roles with a non-empty group, and a hand check of five.

## PR C: tech lead

### Task 7: A lead-level role counts for a `tech_lead` profile

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/position.ts`, `config/matcher.config.ts` (`MATCHER_VERSION = 13`), `README.md` (Position table)
- Test: `apps/xjobs/src/modules/matcher/rules/position.spec.ts`, `rules/decide.spec.ts`

**Interfaces:**

- Produces: in `checkPosition`, after the exact-kind pass and before the "other code" fail: when `profile.position === 'tech_lead'`, `isSoftwareEngineeringRole.value === true`, and `doc.seniority.value === 'lead'`, the check passes with `lead-level <roleKind> counts for tech_lead`. Its sureness rests on `position`, else `seniority`, else `isSoftwareEngineeringRole`, whichever is unsure first. Seniority is not changed.

- [ ] **Step 1: Write the failing tests** in `position.spec.ts`:
  - `tech_lead passes on lead fullstack_engineer`;
  - `tech_lead still fails on senior fullstack_engineer`;
  - `backend_engineer still fails on lead fullstack_engineer`;
  - `an unsure lead seniority makes the pass unsure on seniority`.
  - In `decide.spec.ts`: `a tech_lead profile without lead in its seniorities is rejected on seniority for a lead role`.
- [ ] **Step 2: Run them and see them fail.** Run `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts src/modules/matcher/rules`. Expected: FAIL.
- [ ] **Step 3: Implement** the branch in `checkPosition` and the version bump.
- [ ] **Step 4: Run them and see them pass.** Same command, then `CI=1 npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit, push and open PR C.** Commit message: `feat(matcher): lead-level roles count for tech_lead profiles`. Push with `git push -u origin feat/posts-qualify-tech-lead`, then `gh pr create`. The body has:
  - the rollout: deploy, then `db:rematch -- --all`;
  - the check: listing outcome counts before and after, differing only on `tech_lead` profiles (save the counts before deploying).

## After PR C

- Update `docs/roadmap/phase-4-social-posts/README.md` and `04-ingest-and-qualify.md` to "Built", in the last PR or a docs follow-up.

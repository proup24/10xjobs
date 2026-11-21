# Prepare LinkedIn Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw LinkedIn posts into prepared post jobs (cleaned text, author, sorted links, exact-only duplicates) or drops with a reason, let the owner review drops and silence junk authors engine-wide, and ship drop rules only once they pass on a labelled sample of real posts.

**Architecture:** Prepare is the `LINKEDIN_POSTS` mapper in `apps/xjobs/src/modules/ingest/normalize/`: pure, deterministic, versioned by `NORMALIZER_VERSION`. A kept post is a valid normalized version linked to a `kind = 'post'` job through the existing `linkJob`; a drop is an invalid normalized version with reason `prepare: <rule>: "<match>"`. Duplicates merge through the job key. Silencing is a derived check over a new engine-only `silenced_authors` table, read by an admin-only review API and page.

**Tech Stack:** NestJS engine (`apps/xjobs`), Prisma-next contract + generated migration (`libs/database`), DB specs in `apps/db-tests`, Supabase Postgres, Next.js (`apps/web`), `@xjobs/engine-client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-posts-prepare-design.md`

## Global Constraints

- Three PRs to `main`, in order, each from its own worktree under `.worktrees/` and branched from `main` once the previous PR has merged (no stacked PRs). Push only with `git push -u origin <branch>`. Never touch the main checkout, never read `.env*` except `.env.example`.
  - **PR A** `feat/posts-prepare-normalize`: Tasks 1–5. Buildable now.
  - **PR B** `feat/posts-silence-review`: Tasks 6–9. Buildable now.
  - **PR C** `feat/posts-drop-rules`: Tasks 10–13. Needs real posts on dev (the owner raises the Apify limit first).
- The spec and plan commit (`docs/phase-4-slice-02-prepare`) goes in PR A.
- Every `NORMALIZER_VERSION` bump gets a line in its doc comment in `record.ts` saying whether `db:renormalize` must run; PR A sets **8**, Task 11 **9**, every rule change after that bumps again.
- Contract changes follow the slice 01 recipe (commit `63badbb`): edit `contract.prisma`, `pnpm --filter @xjobs/database db:migration:plan`, advance `libs/database/src/migrations/app/refs/db.json`, regenerate `database.types.ts`, add an `apps/db-tests` spec.
- Mappers stay pure: no network, no database, no clock beyond `ctx.scrapedAt`.
- The processor's and matcher's scope (`kind = 'job'`) is untouched. Post jobs always have a null processing status, except `archived` while they have no source.
- Drop reasons, exactly: `prepare: no-text` and `prepare: <rule>: "<match>"`, the match trimmed to at most **80** characters.
- Job keys, exactly: `linkedin-post:text:<fingerprint>` when the original's comparable text is at least **100** characters and its author key is known; otherwise `linkedin-post:<original id, else the post's own id>`. The fingerprint is the first 32 hex characters of SHA-256 over `<original author key>\n<original comparable text>`.
- Author keys, exactly: `profile:<publicIdentifier, lowercased>` for a person, `company:<universalName, lowercased>` for a company page, else null.
- `ADMIN_USERS`: comma-separated Supabase user ids, empty by default (nobody), parsed like `POST_SEARCH_USERS` in `environment.validation.ts`.
- UI in `apps/web` only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).

## Review Focus

- A share or repost whose payload has no original reference: it is read as an original and never errors. Pinned in Task 2.
- A post text that is only hashtags, emoji and "…see more": cleaned to empty, dropped as `prepare: no-text`, not crashed on. Pinned in Task 1 and Task 2.
- A kept post that a later normalizer version drops: it leaves its job; a job left with no source is `archived`, and un-dropping links it again with a null status. Pinned in Task 4.
- Two people posting the same short generic text: separate jobs (author in the key, short texts keyed by id). Pinned in Task 3.
- A non-admin calling the review API, or an admin un-silencing an author who isn't silenced: 403, and 404 with no write. Pinned in Task 8.

---

## PR A: prepared posts

### Task 1: Post text cleaning and link sorting

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/posts/clean.ts`, `clean.spec.ts`

**Interfaces:**

- Produces:
  - `cleanPostText(raw: string): string`
  - `comparableText(clean: string): string`
  - `type PostLinks = { emails: string[]; linkedinJobIds: string[]; atsPostings: { provider: 'ashby' | 'greenhouse'; url: string }[]; other: string[] }`
  - `sortLinks(text: string, urls: readonly string[]): PostLinks`

- [ ] **Step 1: Write the failing tests** in `clean.spec.ts`:
  - `cleanPostText('We are hiring 🚀 #ReactJS engineers\n\n\n\nDM me…see more')` → `'We are hiring ReactJS engineers\n\nDM me'`.
  - `hashtag#nodejs` (LinkedIn's scraped hashtag form) → `nodejs`; `@Jane Doe` stays `Jane Doe`.
  - `cleanPostText('🔥🔥 #hiring …see more')` → `'hiring'`; `cleanPostText('🔥 …see more')` → `''`.
  - `comparableText('Développeur  Full-Stack!')` → `'developpeur full stack'` (NFKD, accents removed, lowercase, every run of non-letters and non-digits becomes one space, trimmed).
  - `sortLinks('Apply: jobs@acme.io or https://jobs.ashbyhq.com/acme/1a2b3c4d-0000-4000-8000-000000000000. See https://www.linkedin.com/jobs/view/4012345678/ and https://lnkd.in/abc.', [])`: `emails` is `['jobs@acme.io']`, `linkedinJobIds` is `['4012345678']`, `atsPostings` has one Ashby entry, `other` is `['https://lnkd.in/abc']`. Trailing punctuation is never part of a URL.
  - `linkedin.com/jobs/search/?currentJobId=4012345678` gives `linkedinJobIds: ['4012345678']`. Duplicates appear once, in order of first appearance.
- [ ] **Step 2: Run** `CI=1 npx vitest run apps/xjobs/src/modules/ingest/normalize/posts/clean.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** in `clean.ts`. Emoji removal covers `\p{Extended_Pictographic}`, variation selectors and ZWJ. The "see more" tail matches `…see more`, `...see more` and `… more` at the end only. Lines keep their breaks, at most one blank line in a row. ATS detection uses `atsIdentity` from `src/modules/ingest/utils`. Emails are lowercased.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): post text cleaning and link sorting`.

### Task 2: The post mapper and the record's `post` object

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/posts/payload.ts`, `payload.spec.ts`, `normalize/mappers/linkedin-post.mapper.ts`, `linkedin-post.mapper.spec.ts`, `normalize/posts/rules.ts`, `normalize/posts/fixtures/plain-post.json`
- Modify: `normalize/record.ts` (the `post` field, `RECORD_FIELDS`, `NORMALIZER_VERSION = 8`), `normalize/normalize.ts` (register the mapper), `normalize/merge.ts` (field merge leaves `post` alone, see Task 3)

**Interfaces:**

- Consumes: Task 1's `cleanPostText`, `sortLinks`, `PostLinks`.
- Produces:
  - `type PostAuthor = { key: string | null; name: string | null; profileUrl: string | null; headline: string | null; type: 'person' | 'company' | null }`
  - `type PostOriginal = { id: string | null; url: string | null; author: PostAuthor | null; text: string | null; postedAt: string | null }`
  - `type PostDetail = { id: string; url: string; author: PostAuthor; text: string | null; postedAt: string | null; original: PostOriginal | null; links: PostLinks }`. `text` is this post's own cleaned text (a share's added text); `original` is null for an original post.
  - `NormalizedRecord.post: PostDetail | null`, required non-null when `kind === 'post'` (zod refine).
  - `readPostPayload(payload: Record<string, unknown>): RawPost`, the only place that knows the actor's field names. `RawPost = { id, url, text, postedAt, author: { publicIdentifier, universalName, type, name, linkedinUrl, info }, imageUrls: string[], original: null | { id, url, text, postedAt, author } }`, every leaf `string | null`.
  - `readOriginal(payload): RawPost['original']`, returning null until Task 11 fills it from real data.
  - `mapLinkedinPost(payload: Record<string, unknown>, ctx: NormalizeContext): NormalizedRecord | { invalid: string }`
  - `type RuleInput = { text: string; headline: string | null }`, `type DropRule = { name: string; match(input: RuleInput): string | null }`, `const DROP_RULES: readonly DropRule[] = []`, `firstDrop(input: RuleInput): { rule: string; match: string } | null`.

- [ ] **Step 1: Write the fixture** `plain-post.json` with the documented harvestapi item shape: `type: 'post'`, `id`, `linkedinUrl`, `content`, `author` (`publicIdentifier`, `universalName`, `type: 'profile'`, `name`, `linkedinUrl`, `info`), `postedAt` (`timestamp`, `date`, `postedAgoShort`, `postedAgoText`), `postImages: []`, `engagement`. The text is a hiring post with an email.
- [ ] **Step 2: Write the failing tests:**
  - `payload.spec.ts`: the fixture reads into `RawPost`; author `type: 'profile'` → `'person'`, `'company'` → `'company'`; a missing `author` gives all-null author fields, not a throw; `readOriginal` returns null for the fixture.
  - `linkedin-post.mapper.spec.ts`:
    - The fixture maps to `kind: 'post'`, `descriptionText` = the cleaned content, `postingUrl` = `linkedinUrl`, `postedAt` = `postedAt.date`, `poster` = `{ name, profileUrl, type: 'person' }`, `post.author.key = 'profile:<publicIdentifier lowercased>'`, `post.author.headline = info`, `post.original = null`, `post.links.emails = ['…']`. Every job-board-only field is null.
    - Content that cleans to `''`, with no original, gives `{ invalid: 'prepare: no-text' }`.
    - With `DROP_RULES` stubbed to one rule `test-rule` matching a 120-character span, the reason is `prepare: test-rule: "<first 80 characters>"`.
    - A payload with no `id` and no `linkedinUrl` gives an invalid result (never a throw).
  - `normalize.spec`, or the existing mapper registry test: `normalize(Channel.LINKEDIN_POSTS, fixture, ctx)` returns a record.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Rules run on the original post: the original's text and author headline when `original` is non-null, otherwise the post's own.
  - `no-text` drops only when both the own text and the original text are empty.
  - `descriptionText` is the original's cleaned text when there is an original, otherwise the own text. A share's added text lives only in `post.text`.
  - Links are sorted from the own text plus the original text.
  - Add `post` to `RECORD_FIELDS` after `company`, and `post: null` in `emptyRecord`. The job-board mappers give `post: null`.
- [ ] **Step 5: Run** `CI=1 npx nx test xjobs`. Expected: PASS, including the existing normalize, merge and canonical-JSON specs.
- [ ] **Step 6: Commit** `feat(ingest): LinkedIn post mapper, normalizer version 8`.

### Task 3: Post job keys and merged post details

**Files:**

- Modify: `normalize/job-key.ts`, `job-key.spec.ts`, `normalize/merge.ts`, `merge.spec.ts`

**Interfaces:**

- Consumes: `NormalizedRecord.post`, `comparableText`.
- Produces:
  - `postJobKey(sourceKey: string, record: NormalizedRecord): string`, called by `jobKey` for `LINKEDIN_POSTS`.
  - `mergePostSources(sources: MergeSource[]): { sources: PostDetail[] } | null`: every post source's `post`, originals first, then by `postedAt` ascending, then by raw item id. Null when no source is a post.
  - `MergedJob.postSources` holds the result.

- [ ] **Step 1: Write the failing tests:**
  - Same author key and same comparable text (at least 100 characters) from two different post ids give the same `linkedin-post:text:<32 hex>` key.
  - The same text under two different author keys gives two keys.
  - A 60-character text gives `linkedin-post:<own id>`. With `original.id = 'X'`, it gives `linkedin-post:X`.
  - A null author key gives the id form.
  - Texts differing only in accents, case, emoji and punctuation give the same fingerprint.
  - `mergePostSources` with an original and two shares returns three details, with the original first. With job-board sources only, it returns null.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The fingerprint uses `node:crypto` `createHash('sha256')`. The original's author key and text come from `post.original` when it is set, otherwise from the post itself. Field merge copies `post` like any other field; `postSources` is computed separately.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): exact-only post job keys and merged post details`.

### Task 4: Posts become jobs

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`NormalizedJob.postSources Jsonb?`), the migration, refs and `database.types.ts`; `ingest/repositories/raw.repository.ts` (`saveItem` links posts); `ingest/repositories/jobs.writer.ts` (`fieldColumns`/`remerge` write `postSources`; post processing and drops); `ingest/services/renormalize.service.ts` (posts in the first pass)
- Test: `ingest/repositories/raw.postgres.spec.ts`, `apps/db-tests/src/post-sources.db.spec.ts`

**Interfaces:**

- Consumes: Tasks 2–3.
- Produces:
  - `normalized_jobs."postSources"` (`{ sources: PostDetail[] }` or null).
  - Post jobs on ingest and renormalize.

- [ ] **Step 1: Write the failing Postgres specs** (`INGEST_TEST_DATABASE_URL`, per `ingest/README.md`):
  - Ingesting the fixture creates one `kind = 'post'` active job with `processingStatus` null and `postSources.sources` of length 1. Ingesting it again changes nothing.
  - Two posts with the same author and long text join one job with two sources.
  - **Kept then dropped:** link a post, then make the current normalized version of its latest raw version invalid (stub the mapper or write the row). Relinking with `rebuild: true` removes its `normalized_job_sources` row. The job, now sourceless, has `processingStatus = 'archived'` and keeps `status = 'active'`. When the version is made valid again and relinked, the same job is linked with a null status.
  - A dropped post on a two-source job leaves the other source, and the job re-merges.
  - `renormalizeJobs` links post items (`items` counts them).
  - A job-board item that turns invalid still keeps its link, as today.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Contract.** Add the column, plan the migration, advance the ref hash, regenerate types, and add the db-tests spec for the column.
- [ ] **Step 4: Implement.**
  - `saveItem` links every kind.
  - In `linkJob`, for a post item:
    - With an invalid version and an existing link, delete the link, then `remerge` the job, or archive it when it has no source left. Return `{ invalid }`.
    - With a valid version, the processing state written is always `{ status: null, reason: null, requestedAt: null }`.
  - `remerge` writes `postSources`.
  - Remove `LINKEDIN_POSTS` from the excluded channels in `renormalize.service.ts`.
- [ ] **Step 5: Run** the Postgres specs and `CI=1 npx nx run-many -t test typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ingest): link posts to post jobs; a dropped post leaves its job`.

### Task 5: Docs, final check, PR A

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/README.md` (posts are mapped and linked, the key rule, drops, the archived sourceless post job), `docs/roadmap/phase-4-social-posts/README.md` (02 status: "Building ([spec](…))")

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2: Run** `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 3:** Push and open PR A. The body's rollout section says: after deploy, run `db:renormalize` on dev (`XJOBS_ALLOW_REMOTE_DB=1`); check with SQL that post jobs exist with a null `processingStatus` and that `normalized_versions` reasons for posts start with `prepare:`.

## PR B: silenced authors and the review page

### Task 6: `silenced_authors` and the derived check

**Files:**

- Modify: `contract.prisma` (model `SilencedAuthor`, `@@map("silenced_authors")`, RLS on, no policies), the migration, refs and types
- Create: `apps/xjobs/src/modules/ingest/repositories/silenced-authors.repository.ts`, `silenced-authors.postgres.spec.ts`, `apps/db-tests/src/silenced-authors.db.spec.ts`

**Interfaces:**

- Produces:
  - Table columns: `id`, `authorKey` (unique), `name?`, `reason`, `origin` (check `IN ('manual','automatic')`), `evidence Jsonb?`, `createdBy Uuid?`, `createdAt`.
  - `SilencedAuthorsRepository`:
    - `list(): Promise<SilencedAuthorRow[]>`
    - `silence(input: { authorKey: string; name: string | null; reason: string; origin: 'manual' | 'automatic'; evidence: unknown; createdBy: string | null }): Promise<'silenced' | 'already'>`
    - `unsilence(authorKey: string): Promise<boolean>`
    - `silencedPostJobIds(page: { before: string | null; limit: number }): Promise<string[]>`
  - `silencedPostJobSql(raw, jobIdColumn: string)`: an SQL predicate, true when every source of the post job has a silenced author key (`record->'post'->'author'->>'key'`). Exported for slice 03.

- [ ] **Step 1: Write the failing Postgres spec:**
  - A one-source job by silenced `profile:a` is silenced.
  - A job whose second source's author isn't silenced is not.
  - A source with a null author key never counts as silenced.
  - `unsilence` makes the job live again.
  - `silence` twice returns `'already'`.
  - In the db-tests spec, `authenticated` cannot read the table.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the contract, migration and repository, using raw SQL in the style of `processor.repository.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): silenced authors, checked across a post job's sources`.

### Task 7: `ADMIN_USERS` and the admin guard

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts`, `apps/xjobs/.env.example`
- Create: `apps/xjobs/src/modules/admin/admin-access.ts`, `admin.guard.ts`, `admin.guard.spec.ts`, `admin.module.ts`

**Interfaces:**

- Produces:
  - `AdminAccess.isAdmin(userId: string): boolean`
  - `AdminGuard`, applied after `UserGuard`: 403 for a user not in `ADMIN_USERS`.

- [ ] **Step 1: Write the failing spec:** the listed user passes, any other user gets `ForbiddenException`, and an empty setting lets nobody through.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, mirroring `PostSearchAccess` and `postSearchShape`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): ADMIN_USERS and an admin guard`.

### Task 8: The review API

**Files:**

- Create: `apps/xjobs/src/modules/admin/prepare-review.controller.ts`, `prepare-review.service.ts`, `prepare-review.repository.ts`, `dto/*.ts`, specs
- Modify: `app.module` wiring

**Interfaces:**

- Consumes: Task 6's repository, Task 7's guard, Task 2's `readPostPayload`.
- Produces, every route under `UserGuard` + `AdminGuard`, with Swagger decorators as in `profiles.controller.ts`:
  - `GET /api/admin/me` → `{ admin: boolean }`. This one is under `UserGuard` only, so any user can ask.
  - `GET /api/admin/prepare/drops?rule=&before=&limit=` → `{ items: DropView[]; next: string | null }`. `DropView = { rawItemId, reason, rule, postedAt, url, author: { key, name, headline, profileUrl } }`, read from each post item's latest raw version payload whose current normalized version is invalid. Newest `lastSeenAt` first; `limit` defaults to 50, max 200.
  - `GET /api/admin/prepare/silenced-posts?before=&limit=` → `{ items: { jobId, url, author, postedAt }[]; next }`.
  - `GET /api/admin/silenced-authors` → `SilencedAuthorView[]`.
  - `POST /api/admin/silenced-authors` with `{ authorKey, name?, reason }` → 201, or 200 when it was already silenced. The key must match `^(profile|company):.+`, else 400.
  - `DELETE /api/admin/silenced-authors/:authorKey` → 204, or 404 when the author isn't silenced.

- [ ] **Step 1: Write the failing specs:**
  - A non-admin gets 403 on every admin route and `{ admin: false }` from `/me`.
  - Drops come out paginated and filtered by `rule` (the part after `prepare: `, before the colon).
  - Silence then delete round-trips.
  - Deleting an author who isn't silenced gives 404 with no write.
  - A bad `authorKey` gives 400.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): Prepare review API`.

### Task 9: The review page, final check, PR B

**Files:**

- Modify: `libs/engine-client/src/client.ts` + `client.spec.ts` (methods `adminMe`, `prepareDrops`, `silencedPosts`, `silencedAuthors`, `silenceAuthor`, `unsilenceAuthor`, sharing one request helper; results use `EngineResult`), `apps/web/src/components/layout/user-menu.tsx` (an "Admin: Prepare review" item, only when `adminMe` says so)
- Create: `apps/web/src/app/(app)/admin/prepare/page.tsx` (server component; `notFound()` unless admin), `apps/web/src/components/admin/*.tsx` + specs, server actions for silence and un-silence

- [ ] **Step 1: Write the failing specs:**
  - Client: each method's URL, method and body, and each status mapped to an `EngineResult` kind.
  - Web: a non-admin gets `notFound`. The page renders three sections: dropped posts (rule, matched text, author and headline, date, a link opening the post in a new tab), held posts, and silenced authors (reason, origin, evidence for automatic ones). A rule filter.
  - "Silence" asks for a reason and calls the action; "Un-silence" calls the other. Both show a toast on failure.
- [ ] **Step 2: Run** `CI=1 npx nx test web engine-client`. Expected: FAIL.
- [ ] **Step 3: Implement**, from `components/ui` only.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 5:** Update `CLAUDE.md` (Conventions: `ADMIN_USERS` gates the admin pages). Push and open PR B. Rollout: set `ADMIN_USERS` to the owner's id on the API and worker, then open `/admin/prepare` as the owner and as another user.

## PR C: real posts, shares and drop rules (after collection runs)

### Task 10: The actor doc from a real batch

**Files:**

- Create: `docs/actors/harvestapi-linkedin-post-search.md`, `normalize/posts/fixtures/{share,repost,company-author,image-only}.json` (real payloads, unscrubbed, _user_)

- [ ] **Step 1:** Read about 200 post payloads on dev with the read-only `supabase-dev` MCP. Use `raw_item_versions` joined to `raw_items` where `channel = 'LINKEDIN_POSTS'`.
- [ ] **Step 2:** Write the doc: every field and its nesting, which fields mark a plain repost and a share with added text, whether the original's id, text, author and date are present, and the company author's shape.
- [ ] **Step 3:** Save one real payload per case as a fixture. If no repost or share appears in 200 posts, say so in the doc and skip Task 11's share tests for the missing case.
- [ ] **Step 4: Commit** `docs(actors): harvestapi post search output from real posts`.

### Task 11: Shares and reposts

**Files:**

- Modify: `normalize/posts/payload.ts` (`readOriginal`), the payload, mapper and job-key specs, `record.ts` (`NORMALIZER_VERSION = 9`)

- [ ] **Step 1: Write the failing tests** from Task 10's fixtures:
  - A plain repost maps with `original` set and gets its original's key.
  - A share keeps its added text in `post.text` and gets its original's key.
  - Both land in one job with the original in the Postgres spec, with `postSources` holding both.
  - `readOriginal` fills `original.truncated` and `original.attachedUrls` from the original's own payload, the way the original scraped alone gets them (PR A keys a post by its text plus its attached links, and the mapper hard-codes `original.attachedUrls: []`). Decide from the real payloads whether a repost's top-level `article` belongs to the share or to the original. Otherwise a repost of a post with an article link keys differently from that post and doesn't join it.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** `readOriginal`. **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): shares and reposts join their original, normalizer version 9`.

### Task 12: The sample export and the labelled sample

**Files:**

- Create: `apps/xjobs/src/scripts/post-sample.ts` (+ `post-sample` script in `apps/xjobs/package.json`, `db:post-sample`), `normalize/posts/sample/sample.json`, `normalize/posts/sample/sample.spec.ts`

**Interfaces:**

- Produces:
  - `pnpm --filter @xjobs/xjobs db:post-sample -- --size <n> [--days <n>] --out <path>`: read-only. It writes a random sample of post items as `{ rawItemId, payload, label: null }[]` and refuses a remote database without `XJOBS_ALLOW_REMOTE_DB=1`.
  - `sample.json`: `{ rawItemId, payload, label: 'hiring' | 'not_hiring' | 'unsure', note?: string }[]`.

- [ ] **Step 1:** Write the script with an argument-parsing spec in the style of `rematch-args.ts`. Commit.
- [ ] **Step 2:** Export 150 posts from dev. Claude pre-labels each one with a one-line note.
- [ ] **Step 3: The owner confirms every label in a session.** Nothing in Task 13 starts before this.
- [ ] **Step 4:** Write `sample.spec.ts`. For every rule in `DROP_RULES`, it fails listing each post labelled `hiring` or `unsure` that the rule drops, with the match. It also prints how many `not_hiring` posts each rule drops. Commit with the confirmed sample.

### Task 13: Drop rules, final check, PR C

**Files:**

- Modify: `normalize/posts/rules.ts`, `rules.spec.ts`, `record.ts` (bump the version)

- [ ] **Step 1:** For each candidate (`open-to-work`, `course-ad`, `job-digest`), and any other junk pattern the sample shows, write `rules.spec.ts` cases taken from the sample: what it must match and what it must not.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** the rule as words and patterns over `RuleInput` (author rules read `headline`).
- [ ] **Step 4: Run** `rules.spec.ts` and `sample.spec.ts`. Expected: PASS, with zero hiring or unsure posts dropped. A rule that can't reach zero is left out and noted in the PR body.
- [ ] **Step 5:**
  - Bump `NORMALIZER_VERSION`.
  - Update `CLAUDE.md` (`db:post-sample`) and the roadmap (02 built).
  - Run `npx nx run-many -t lint test build typecheck`.
  - Push and open PR C. Rollout: run `db:renormalize` on dev, then read the first day's drops on `/admin/prepare`; any wrong drop gets its rule fixed.

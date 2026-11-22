# Posts Extract (Phase 4 slice 03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The processor reads prepared LinkedIn posts: one `claude -p` call per post gives a verdict (hiring, not hiring, junk) with a reason, and for a hiring post one job per role with listing-shaped facts, how to apply and the contact email. A daily cap, an owner view of verdicts, automatic silencing (off by default) and a golden eval come with it.

**Architecture:** Posts join the existing processor (spec approach A). A second document type (`docType = 'post'`) gets its own prompt, model output schema and assembler. The listing generation, reuse and storage code is shared through a small `GenerationSpec` seam. Each role of a hiring post becomes a `kind = 'post_role'` job linked to its post job (`parentJobId`), with a normal listing extraction as its current extraction, so slice 04 can match it unchanged. The listing path's prompt, schema version and reuse keys don't change.

**Tech Stack:** NestJS, Prisma Next contract (`libs/database/src/contract/contract.prisma`) on Supabase Postgres, BullMQ, zod, Vitest, Next.js (`apps/web`, `components/ui`).

**Spec:** `docs/superpowers/specs/2026-11-22-posts-extract-design.md`

## Global Constraints

- Listing extractions must not change: `promptHash()` (listing), `EXTRACTION_SCHEMA_VERSION = 4` and existing reuse keys stay exactly as on `main`. `processor:eval` on listings must give the same result.
- Post scope: `kind = 'post'`, `status = 'active'`, `firstSeenAt >= now() - interval '7 days'`, and not `silencedPostJobSql` (applied after the window filter).
- Verdicts: `hiring` | `not_hiring` | `junk`. Reason codes: `hiring`, and `open_to_work`, `advice_or_commentary`, `course_or_training_ad`, `job_digest`, `role_filled`, `other` (not hiring), and `no_clear_employer`, `many_roles_across_companies`, `funnel`, `messaging_group`, `other` (junk). Confidence `sure` | `unsure`.
- How to apply kinds: `email`, `external_link`, `linkedin_job`, `connect_dm_comment`, `unstated` (`unstated` only alone).
- Author relation: `employer` | `recruiter` | `unstated`.
- The contact email must be one of Prepare's `links.emails` for the job (compared trimmed and lower-cased), with a verbatim quote that contains it. Every apply link must be one of Prepare's links. Breaking either makes the document invalid (retried).
- `POST_EXTRACTION_DAILY_CAP` default `250` post model calls started per UTC day, `0` = post extraction paused. Separate from `PROCESSOR_DAILY_BUDGET_USD`.
- `POST_AUTO_SILENCE` default off. Threshold: at least 10 counted posts over at least 7 days (first to last `firstSeenAt`), every counted one `not_hiring` or `junk`, `role_filled` not counted, no role job of the author ever `qualified`; counted against the original post's author key only.
- Eval bars: wrong sends `0`; contact email exact `1.0`; hiring kept (sure `hiring`) `>= 0.95`; role facts use the processor's existing `BARS` where labelled. An unreviewed label fails the bars.
- Contract is the only schema source: advance `app/refs/db.json`'s hash and regenerate `database.types.ts` with every contract change (CI diffs it).
- Engine-only tables keep RLS on with no policies. UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).
- Run Vitest with `CI=1`. Postgres specs need their disposable databases (see the processor README's `processor_test` recipe). Commit from this worktree, never the main checkout.

## Review Focus

1. **The only email is in a sharer's added text** ("DM me or email jobs@acme.com" on a share of a plain announcement). Expect a contact email, because the input carries every source's added text. Test in Task 3 and Task 5.
2. **An email written with different case or trailing punctuation** (`Jobs@Acme.com.` in the text, `jobs@acme.com` in Prepare's list). Expect it accepted when it matches after trimming punctuation and lower-casing, and rejected when it is any other address. Test in Task 5.
3. **A pending post whose author was silenced after it was queued.** Expect it not claimed, and claimable again after un-silencing while still in the 7-day window. Test in Task 7.
4. **A re-extraction that keeps a role but rewords another.** Expect the kept role to keep its job id and the reworded one to get a new job, with the old one archived. Test in Task 9.
5. **The cap reached while listings are pending.** Expect posts refused with `post_cap` and listings still processed, and the count resetting at UTC midnight. Test in Task 8.

---

## PR A: Posts through the processor

Branch `feat/posts-extract` from `main`, worktree `.worktrees/posts-extract-engine`.

### Task 1: Contract for post extractions and role jobs

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`NormalizedJob`, `JobExtraction`, `ProcessingAttempt`)
- Modify: `app/refs/db.json`, the generated `database.types.ts` (regenerate per `migration-ref-hash` practice)
- Test: `libs/database` contract spec that already checks constraints, or a new `apps/xjobs/src/modules/processor/repositories/post-contract.postgres.spec.ts`

**Interfaces:**

- Produces:
  - `normalized_jobs.kind` check `kind IN ('job', 'post', 'post_role')`;
  - `normalized_jobs."parentJobId" uuid NULL` (FK to `normalized_jobs.id`, `onDelete: Restrict`) and `"roleKey" text NULL`, unique `(parentJobId, roleKey)`, check `(kind = 'post_role') = ("parentJobId" IS NOT NULL)`;
  - `job_extractions."docType" text NOT NULL DEFAULT 'listing'`, check `IN ('listing', 'post')`, and `verdict text NULL`, `"verdictReason" text NULL`, `"verdictConfidence" text NULL` (set only on `post` rows);
  - `processing_attempts."docType" text NOT NULL DEFAULT 'listing'`, same check;
  - a partial index on `normalized_jobs ("firstSeenAt" DESC) WHERE kind = 'post' AND "processingStatus" = 'pending'`.

- [ ] **Step 1: Write the failing Postgres spec**: inserting a `post_role` job without `parentJobId` fails the check; two role jobs with the same `(parentJobId, roleKey)` fail the unique; an extraction row inserted without `docType` reads back `'listing'`; `docType = 'other'` fails.
- [ ] **Step 2: Run it**: `CI=1 PROCESSOR_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts post-contract`. Expected: FAIL (columns missing).
- [ ] **Step 3: Change the contract**, generate the migration, advance the ref hash, regenerate `database.types.ts`.
- [ ] **Step 4: Run the spec and `npx nx run-many -t typecheck`**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): contract for post extractions and role jobs`.

### Task 2: Post document schema and role keys

**Files:**

- Create: `apps/xjobs/src/modules/processor/schema/post-extraction.ts`, `apps/xjobs/src/modules/processor/rules/role-key.ts`
- Modify: `apps/xjobs/src/modules/processor/schema/index.ts` (export), `schema/model-output.ts` (export `buildModelOutput` or a `roleFactsOutput(options)` builder)
- Test: `schema/post-extraction.spec.ts`, `rules/role-key.spec.ts`

**Interfaces:**

- Consumes: `buildModelOutput(options)` (listing model output), `extractionDocumentSchema`.
- Produces:
  - `POST_SCHEMA_VERSION = 1`;
  - `VERDICTS`, `NOT_HIRING_REASONS`, `JUNK_REASONS`, `APPLY_KINDS`, `AUTHOR_RELATIONS` (the Global Constraints values, as `as const` arrays);
  - `postModelOutputSchema(options: ListOptions)`: `{ verdict: { value, reason, quote, confidence }, roles: Array<ListingModelOutput & { employer: { name: string | null; quote: string }; authorRelation; howToApply: { kinds: ApplyKind[]; email: string | null; emailQuote: string; links: string[]; quote: string } }> }`;
  - `postDocumentSchema` (stored `data` for `docType = 'post'`): `{ verdict: { value, reason, quote, confidence }, roles: { roleKey: string; title: string; employer; authorRelation; howToApply; facts: ExtractionDocument }[], truncated: boolean, models: { generator: string } }`, with `superRefine`: `hiring` ⇒ `roles.length >= 1`; `not_hiring` | `junk` ⇒ `roles.length === 0`; the reason belongs to its verdict; `unstated` is alone in `kinds`; `email` in `kinds` ⇔ `email !== null`;
  - `type PostDocument`, `type PostModelOutput`, `type ApplyKind`, `type Verdict`;
  - `roleKeys(titles: string[]): string[]` in `rules/role-key.ts`: lower-cases, folds accents, keeps `[a-z0-9]` runs joined by `-`, and suffixes `-2`, `-3` for repeats in order.

- [ ] **Step 1: Write failing specs**: `postDocumentSchema` rejects `junk` with a role, `hiring` with none, `reason: 'funnel'` under `not_hiring`, `kinds: ['unstated','email']`, `kinds: ['email']` with `email: null`; accepts a fixture with two roles. `roleKeys(['Senior Backend Engineer', 'Sénior backend engineer!', 'Frontend Dev'])` equals `['senior-backend-engineer', 'senior-backend-engineer-2', 'frontend-dev']`.
- [ ] **Step 2: Run** `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts post-extraction role-key`. Expected: FAIL.
- [ ] **Step 3: Implement** the schemas (role entries extend the listing model output object) and `roleKeys`. Add a `fixture-post.testing.ts` with one hiring two-role document and one junk document, used by later tasks.
- [ ] **Step 4: Run the specs**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post document schema and role keys`.

### Task 3: Post input

**Files:**

- Create: `apps/xjobs/src/modules/processor/rules/post-input.ts`
- Modify: `apps/xjobs/src/modules/processor/models/types.ts` (`JobForProcessing` gains `kind: 'job' | 'post'` and `postSources: PostDetail[] | null`)
- Test: `rules/post-input.spec.ts`

**Interfaces:**

- Consumes: `PostDetail` (`ingest/normalize/record.ts`), `DESCRIPTION_CAP_BYTES` and `cut` logic in `rules/input.ts` (export `cut`).
- Produces:
  - `buildPostInput(job: JobForProcessing): { input: PostingInput; links: PostLinks }`, where `input.title = null` and `input.description` is the rendered text;
  - `type PostLinks = { emails: string[]; linkedinJobIds: string[]; urls: string[] }` (the union over sources and the original: `emails`, `linkedinJobIds`, ATS urls, `other`, `attachedUrls`; de-duplicated, order kept).
- Render, in this order: `Original post by <name> (<headline>, <person|company>), posted <date>:` then the original text (or the post's own text when it is not a share); then for each share with added text `Shared by <name> (<headline>) with this added text:` and the text; then `Links in the post:` with emails, LinkedIn job links (`https://www.linkedin.com/jobs/view/<id>`), ATS and other links one per line. Add `Note: this text was cut at "see more".` after any truncated text. `input.truncated` is true when any text was truncated or the cap cut the whole.

- [ ] **Step 1: Write failing specs**: a share whose added text holds `jobs@acme.com` renders the added text and lists the email; a plain original renders one section; two jobs with the same sources in a different order give the same `inputHash` (sort sources by post id); a truncated original renders the note and sets `truncated`; `links.emails` is de-duplicated across sources.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement `buildPostInput`.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post input`.

### Task 4: Post prompt

**Files:**

- Create: `apps/xjobs/src/modules/processor/prompts/post-system.prompt.ts`
- Modify: `apps/xjobs/src/modules/processor/prompts/prompt.ts` (add `postSystemPrompt()`, `postPromptHash()`)
- Test: `prompts/prompt.spec.ts`

**Interfaces:**

- Produces: `postSystemPrompt(): string` = `POST_PROMPT_HEAD + '\n\n' + SYSTEM_PROMPT`; `postPromptHash()` = sha256 of that string.
- `POST_PROMPT_HEAD` says, in the listing prompt's style: the input is one LinkedIn post with its shares and links; first decide the verdict (table and junk signs from the spec's "The verdict", the owner's examples #11, #13, #16, #32, #63 described in words, not by number); a third-party recruiter's real role is `hiring`, a list across companies is junk; "role filled" is `not_hiring`/`role_filled`; `unsure` only for a genuine toss-up; then one role per distinct role ("two senior backend engineers" is one role); each role's facts follow the listing rules below, where "posting" means the post; how to apply and its kinds; the contact email only when offered as the way to apply, quoted, copied exactly from the links list, never composed; links only from the links list; the employer as stated, `authorRelation`; nothing guessed.

- [ ] **Step 1: Write failing specs**: `promptHash()` equals the listing hash recorded from `main` before this task (put the literal in the test, computed on `main` at the start of this task); `postSystemPrompt()` ends with `SYSTEM_PROMPT`; `postPromptHash() !== promptHash()`; the head names every reason code and every apply kind from `schema/post-extraction.ts` (loop over the arrays).
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Write the head.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post prompt`.

### Task 5: Post assembler and its hard checks

**Files:**

- Create: `apps/xjobs/src/modules/processor/services/post-assembler.service.ts`
- Test: `services/post-assembler.service.spec.ts`

**Interfaces:**

- Consumes: `FactAssembler.assemble` (per role, with `input` so quotes check against the whole post), `roleKeys`, `postDocumentSchema`, `normalizeForQuote`, `PostLinks`.
- Produces:
  - `interface AssembledPost { doc: PostDocument; roles: AssembledDocument[] /* same order as doc.roles */; quoteFailures: number }`;
  - `PostAssembler.assemble(output: PostModelOutput, meta: ModelCallMeta, input: PostingInput, links: PostLinks, vocabulary: Vocabulary): AssembledPost`. It throws `ExtractionInvalidError` with a path when the verdict quote isn't verbatim in the input, when an email isn't in `links.emails` after `trim`, stripping `.,;:)>` at either end and lower-casing, when `emailQuote` isn't verbatim or doesn't contain the email, when a link isn't in `links.urls` or a `linkedin.com/jobs/view/<id>` url with an id in `links.linkedinJobIds`, or when `postDocumentSchema` fails. The stored email is the address as it appears in `links.emails`.
  - `role.facts = FactAssembler.assemble(roleListingFields, …).doc`, and `title = facts.position.value?.title ?? ''`.

- [ ] **Step 1: Write failing specs**: `Jobs@Acme.com.` against links `['jobs@acme.com']` is accepted and stored as `jobs@acme.com`; `press@acme.com` not in links throws with path `roles.0.howToApply.email`; an email whose quote is not in the text throws; a made-up `https://acme.com/careers` not in links throws; a junk output with zero roles assembles; an email found only in a sharer's added text (the Task 3 fixture) is accepted; role keys come out as `roleKeys` of the titles.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement `PostAssembler`.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post assembler with contact checks`.

### Task 6: Generation for both document types

**Files:**

- Modify: `apps/xjobs/src/modules/processor/services/generation.service.ts`, `services/extraction-pipeline.service.ts`
- Create: `apps/xjobs/src/modules/processor/services/post-pipeline.service.ts`
- Test: `services/generation.service.spec.ts` (new cases), `services/post-pipeline.service.spec.ts`

**Interfaces:**

- Consumes: Tasks 2, 4 and 5.
- Produces:
  - `interface GenerationSpec<T> { systemPrompt(): string; schema(v: Vocabulary): z.ZodType; assemble(parsed: unknown, meta: ModelCallMeta, input: PostingInput, v: Vocabulary): T }`;
  - `GenerationService.generateWith<T>(spec: GenerationSpec<T>, input, vocabulary, log): Promise<{ ok: true; assembled: T } | { ok: false; errors: string[] }>`. The existing `generate(input, vocabulary, log)` becomes `generateWith(listingSpec, …)` with identical logs, steps and retries.
  - `PostPipeline.run(input: PostingInput, links: PostLinks, vocabulary, log): Promise<AssembledPost>` (throws `ExtractionFailed`), running `checkConsistency` on each role's facts.
  - `AttemptLog` gains a `docType: 'listing' | 'post'` constructor option, default `'listing'`, written on every entry (`NewAttempt.docType`).

- [ ] **Step 1: Write failing specs**: the existing generation specs still pass unchanged; `PostPipeline.run` with a fake `ExtractionModel` returning an invalid email retries once with the assembler error in `retryErrors` and then succeeds; attempts from a post log carry `docType: 'post'`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement the seam and `PostPipeline`.**
- [ ] **Step 4: Run** `CI=1 npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/services`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(processor): generation spec seam; feat: post pipeline`.

### Task 7: Repository: post scope, role jobs, post reuse

**Files:**

- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts`, `testing/` in-memory fake if one exists
- Test: `repositories/processor.postgres.spec.ts` (new `describe('posts')`)

**Interfaces:**

- Consumes: `silencedPostJobSql(raw, 'j.id')`, `linkedInJobIds(raw)`.
- Produces (abstract methods and their Prisma bodies):
  - `processorScopeSql(raw: Raw, alias: string)`: `((alias.kind = 'job' AND alias.id IN (linkedInJobIds)) OR (alias.kind = 'post' AND alias."firstSeenAt" >= now() - interval '7 days' AND NOT <silenced>))`, used by `claim`, `markPending`, `processingCounts` and `jobState.inScope`. `listPendingInScope` keeps its listing-only query.
  - `listPendingPosts(limit: number): Promise<string[]>`: in-scope pending posts, `firstSeenAt DESC, id DESC`.
  - `loadJob` returns `kind` and `postSources` (`postSources.sources`).
  - `ReuseKey` gains `docType: 'listing' | 'post'`; `findReusable` filters on it. The listing `reuseKey()` passes `'listing'`, so existing rows match.
  - `NewExtraction` gains `docType`, `verdict`, `verdictReason`, `verdictConfidence` (null for listings).
  - `upsertRoleJob(args: { postJobId: string; roleKey: string; title: string; companyName: string | null; extractionId: string }): Promise<string>`: creates or updates the `post_role` job (copying `postingUrl`, `postedAt`, `firstSeenAt`, `lastSeenAt`, `descriptionText` from the post job; `status 'active'`, `processingStatus 'processed'`, `processedAt now()`, `currentExtractionId`); job key `<post jobKey>#role:<roleKey>`.
  - `archiveRoleJobs(postJobId: string, keep: string[]): Promise<number>`: sets `processingStatus = 'archived'` on its role jobs whose `roleKey` isn't in `keep`.
  - `postCallsSince(since: Date): Promise<number>`: count of non-eval `processing_attempts` with `docType = 'post'`.
  - `ProcessingCounts` becomes `{ listings: Counts; posts: Counts & { outOfWindow: number; silenced: number } }`.

- [ ] **Step 1: Write failing Postgres specs**: a pending post first seen 8 days ago is not claimed and counts `outOfWindow`; a pending post whose only author is in `silenced_authors` is not claimed and counts `silenced`, and after deleting that row it is claimed; `listPendingPosts` returns newest first; a listing reuse key still finds a listing row written before this change (`docType` default); `upsertRoleJob` twice with the same key returns the same id; `archiveRoleJobs(post, ['a'])` archives `b` only; `markPending({ nullStatus: true })` marks in-window posts and skips out-of-window ones.
- [ ] **Step 2: Run** with `PROCESSOR_TEST_DATABASE_URL`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `EXPLAIN` on the claim and `listPendingPosts` statements against a copy of dev data and paste the plans into the PR body (spec: check the silenced query plan).
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post scope, role jobs and post reuse in the repository`.

### Task 8: The daily post cap

**Files:**

- Modify: `apps/xjobs/src/modules/processor/services/processor-guard.service.ts`, `config/processor.config.ts`, the config factory that reads env (where `PROCESSOR_DAILY_BUDGET_USD` is read), `.env.example`
- Test: `services/processor-guard.service.spec.ts`

**Interfaces:**

- Produces: `ProcessorConfig.postDailyCap: number` from `POST_EXTRACTION_DAILY_CAP` (default `250`); `GuardBlock` adds `'post_cap'`; `ProcessorGuard.check(docType: 'listing' | 'post' = 'listing')` also returns `'post_cap'` for posts when `postDailyCap === 0` or `postCallsSince(startOfUtcDay(now)) >= postDailyCap`. Listings ignore the cap. `ProcessorBlockedError` message for `post_cap`: `"Today's post extraction cap is reached"`.

- [ ] **Step 1: Write failing specs**: with cap 2 and 2 post calls today, `check('post')` is `'post_cap'` and `check('listing')` is null; at 00:00:01 UTC the next day it is null; cap 0 always blocks posts.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): daily post extraction cap`.

### Task 9: The post path in the processor service

**Files:**

- Create: `apps/xjobs/src/modules/processor/services/post-store.service.ts`
- Modify: `services/processor.service.ts`, `services/extraction-store.service.ts` (split `save` into `saveDocument` without attempts plus `save`), `processor.module.ts`, `createProcessorService`
- Test: `services/processor.service.spec.ts` (new `describe('posts')`), `services/post-store.service.spec.ts`

**Interfaces:**

- Consumes: Tasks 3 and 5 to 8.
- Produces:
  - `ProcessorService.process(jobId)` claims first; for a `post` job it calls `guard.check('post')`. A `post_cap` refusal finishes the claim back to `pending` with the attempt given back and returns `'post_cap'`. Posts never use `findJoinedReusable`, whatever the claim's reason.
  - `PostStore.reuseKey(input): ReuseKey` (`docType 'post'`, `POST_SCHEMA_VERSION`, `postPromptHash()`, model).
  - `PostStore.save(postJobId, key, assembled: AssembledPost, vocabulary, log): Promise<string>`: saves the `post` row (`data = doc`, `needsReview = verdict.confidence === 'unsure'`, verdict columns, typed columns empty or false), then for each role saves a `listing` row through `ExtractionStore.saveDocument` with key `{ docType: 'listing', schemaVersion: EXTRACTION_SCHEMA_VERSION, promptHash: postPromptHash(), inputHash: sha256(key.inputHash + ':' + roleKey), extractionModel }`, then `upsertRoleJob` and `archiveRoleJobs(postJobId, keptKeys)`, then records the attempts once.
  - `PostStore.syncRoles(postJobId, postExtractionId)`: used on exact reuse, so the role jobs match the reused document (copies each role row for a copied post row).
  - The guard's existing check before the claim (pauses, budget) still runs for every job. Only the post cap is checked after the claim, which is when the kind is known.

- [ ] **Step 1: Write failing specs** (in-memory fakes): a two-role hiring post creates two role jobs with the right titles and extractions; re-running with one role renamed keeps the other's job id and archives the renamed one's old job; a junk result creates none and archives existing ones; an unsure hiring post's `post` row has `needsReview: true` and `verdictConfidence: 'unsure'`; a `joined` claim with a different input calls the model (no joined reuse); the cap returns `'post_cap'`, leaves the job `pending` and refunds the attempt.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the processor test folder. Expected: PASS, with the listing specs unchanged.
- [ ] **Step 5: Commit** `feat(processor): extract posts into role jobs`.

### Task 10: Ingest sends posts to Extract

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`NO_PROCESSING` for posts, the archived-post branch near line 626), `apps/xjobs/src/infrastructure/jobs/steps/ingest/processor.ts` (line 46 nudge)
- Test: `jobs.writer` Postgres spec, `steps/ingest/processor.spec.ts`

**Interfaces:**

- Produces:
  - a post job created by a non-rebuild observation is `pending` / `new`;
  - a share with non-empty `PostDetail.text` joining an existing post job whose status is non-null sets `pending` / `joined`;
  - an archived post job seen again reopens as `nextProcessing` does;
  - a rebuild (`db:renormalize`) changes nothing;
  - a post job that becomes `archived` also archives its role jobs in the same transaction;
  - post batches (`Channel.LINKEDIN_POSTS`) nudge the process queue.

- [ ] **Step 1: Write failing specs** for each of the cases above.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the ingest Postgres specs and the sample spec (`ingest/normalize/posts/sample`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): send post jobs to Extract`.

### Task 11: Sweeper order, status and docs

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/process/processor.ts` (sweep), `services/processor.service.ts` (`status()`), `controllers/processor.controller.ts` (429 on `post_cap`), `apps/xjobs/src/modules/processor/README.md`, `CLAUDE.md` (env vars only if the commands list needs it), `deploy/engine/README.md` (the new env vars)
- Test: the sweep spec, the controller spec

**Interfaces:**

- Produces:
  - each sweep enqueues `listPendingInScope` first, then `listPendingPosts`, so a post never goes ahead of a listing already waiting;
  - `ProcessorStatus.posts = { counts, callsToday, dailyCap, estimatedCostTodayUsd }` and `jobs` becomes `ProcessingCounts`;
  - `spendSince(since, docType?)`.

- [ ] **Step 1: Write failing specs**: the sweep enqueues listings before posts; `GET /processor/status` shows the post counts, calls and cap.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement, and update the processor README** (scope, post path, role jobs, cap, statuses) and the deploy runbook (`POST_EXTRACTION_DAILY_CAP`, `POST_AUTO_SILENCE`).
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit, push and open PR A** with the rollout checks from the spec's "Rollout check on dev" and the `EXPLAIN` plans. After merge: `db:reprocess -- --null-status` on dev.

## PR B: Post golden set and eval

Branch `feat/posts-extract-eval` from `main` after PR A merges.

### Task 12: Post golden cases from the labelled sample

**Files:**

- Create: `apps/xjobs/src/modules/processor/golden/posts/golden-posts.ts`, `apps/xjobs/src/scripts/processor-post-golden-import.ts`, `golden/posts/cases.json`
- Modify: `apps/xjobs/package.json` (`processor:post-golden-import`)
- Test: `golden/posts/golden-posts.spec.ts`

**Interfaces:**

- Produces:
  - `interface PostGoldenCase { rawItemId: string; sources: PostDetail[]; verdict: { value: Verdict; reason: string; reviewed: boolean }; roles: { title: string; employer: string | null; applyKinds: ApplyKind[]; contactEmail: string | null; facts: Partial<GoldenFacts>; reviewed: boolean }[]; note: string | null }`;
  - `loadPostGolden(): PostGoldenCase[]`.
- The import reads `ingest/normalize/posts/sample/sample.json`, runs the posts mapper on each payload to get its `PostDetail` (dropped ones are kept with their verdict label, since they test Extract too), and maps labels. `owner:` notes keep the owner's verdict: #11, #13 and #32 are `junk`. Every label starts `reviewed: false`, except verdicts the owner wrote a note on.

- [ ] **Step 1: Write a failing spec**: 150 cases load; #11, #13 and #32 (by index in the sample) are `junk`; every case's `sources` parses with `postDetailSchema`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement the format and the import, and run it** to write `cases.json`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `test(processor): post golden cases from the labelled sample`.

### Task 13: Post scorer and eval suite

**Files:**

- Create: `apps/xjobs/src/modules/processor/golden/posts/score-posts.ts`
- Modify: `apps/xjobs/src/scripts/processor-eval.ts` (`--posts`), `processor-args.ts`
- Test: `golden/posts/score-posts.spec.ts`

**Interfaces:**

- Produces:
  - `POST_BARS = { wrongSends: 0, contactEmailExact: 1, hiringKept: 0.95 } as const`;
  - `scorePost(c: PostGoldenCase, got: AssembledPost | { failed: string[] })` and `summarizePosts(scores): PostEvalReport` with bars, a pass flag, counts per verdict and label (unsure counted by label), role fact scores using the existing `score.ts` functions where labelled, and calls and cost per post.
- Rules:
  - **wrongSends** counts cases labelled `not_hiring` or `junk` that came out a sure `hiring` with any role whose `howToApply.email` is non-null;
  - **contactEmailExact** compares every case labelled hiring, role by role, by `roleKeys` order, including got-an-email-where-none-labelled;
  - **hiringKept** counts sure `hiring` out of the cases labelled hiring;
  - a failed generation counts as not kept;
  - any unreviewed label used by a bar fails the bars.
- `processor:eval -- --posts` runs `PostPipeline` in memory over the set and writes `golden/posts/last-report.<model>.json` (git-ignored).

- [ ] **Step 1: Write failing specs**: a junk case with a sure-hiring result and an email fails `wrongSends`; the same case with an unsure result does not; an unsure result on a hiring case is not kept; an extra email on a hiring case with none labelled fails `contactEmailExact`; an unreviewed verdict fails the report.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): post eval and its bars`.

### Task 14: Label session with the owner

This is a human step, not code. It needs the owner.

- [ ] **Step 1:** Claude pre-labels every case: the verdict and reason for all 150, and for hiring cases the roles, employer, apply kinds, contact email and the facts `GoldenFacts` covers. It writes them to `cases.json` as `reviewed: false`.
- [ ] **Step 2:** Publish a review sheet as an artifact (as for slice 02's sample), with one row per post: the text, the proposed labels and an owner note. The owner confirms or corrects every row.
- [ ] **Step 3:** Apply the owner's answers and set `reviewed: true` on each confirmed label. Commit `test(processor): owner-reviewed post golden labels`.
- [ ] **Step 4:** Run `pnpm --filter @xjobs/xjobs processor:eval -- --posts`. Iterate the post prompt (Task 4's head) until the bars pass or the misses are understood. Each prompt change gets its own commit with the report's numbers in the message. Record the final report's numbers in the PR body.
- [ ] **Step 5: Push and open PR B.** After merge: `db:reprocess` posts if the prompt changed after PR A.

## PR C: Owner verdict list, automatic silencing, report

Branch `feat/posts-extract-review` from `main` after PR A merges. It can run alongside PR B.

### Task 15: Owner's verdict list

**Files:**

- Modify: `apps/xjobs/src/modules/admin/prepare-review.repository.ts`, `prepare-review.service.ts`, `prepare-review.controller.ts`, `prepare-review.types.ts`
- Modify: `apps/web/src/app/(app)/admin/prepare/page.tsx`
- Create: `apps/web/src/components/admin/extract-verdicts.tsx`
- Test: `prepare-review.http.spec.ts`, `prepare-review.repository.postgres.spec.ts`, `extract-verdicts.spec.tsx`

**Interfaces:**

- Produces:
  - `GET /api/admin/extract/verdicts?verdict=&reason=&before=&limit=` → `Page<VerdictView>`, where `VerdictView = { jobId; verdict: 'not_hiring' | 'junk'; reason; quote; confidence; author: AuthorView; postedAt; url; extractedAt }`. It lists post jobs whose current extraction is a `post` row with that verdict, newest extraction first, admin only (403 otherwise).
  - The web page gains an "Extract verdicts" section with verdict and reason filters and the existing silence action per author.

- [ ] **Step 1: Write failing specs**: a junk post lists with its reason and quote; a hiring post doesn't; a non-admin gets 403; the component renders the filter and a row's silence button.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the engine and web specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): Extract verdicts on the owner's review page`.

### Task 16: Automatic silencing, off by default

**Files:**

- Create: `apps/xjobs/src/modules/processor/services/auto-silence.service.ts`, `repositories/auto-silence.repository.ts`
- Modify: `apps/xjobs/src/infrastructure/worker/scheduler.ts` and `processor.service.ts` (a daily job at 04:00 UTC, registered only with `XJOBS_RUN_SCHEDULES=1`, like the process sweep), the config (`POST_AUTO_SILENCE`), the admin controller (`GET /api/admin/extract/auto-silence-candidates`), `extract-verdicts.tsx` (a candidates list)
- Test: `auto-silence.repository.postgres.spec.ts`, `auto-silence.service.spec.ts`

**Interfaces:**

- Produces:
  - `AutoSilenceRepository.candidates(): Promise<{ authorKey; name; counted: number; firstSeenAt: Date; lastSeenAt: Date; verdicts: Record<string, number> }[]>`. The author key is `postSources.sources[*].original.author.key`, falling back to the source's own `author.key` for a non-share. It uses current `post` extractions only, skips authors already silenced, and applies the Global Constraints threshold. "Never qualified" means no `job_matches` row with outcome `qualified` on any role job of the author's posts.
  - `AutoSilenceService.run(): Promise<{ silenced: number; candidates: number }>`. With `POST_AUTO_SILENCE` on, it calls `SilencedAuthorsRepository.silence({ origin: 'automatic', reason: 'automatic: not hiring or junk', evidence: candidate, createdBy: null })`. With it off, it logs each candidate as `would silence <authorKey> (<counted> posts, <first>..<last>)` and silences nobody.

- [ ] **Step 1: Write failing specs**: 10 junk posts over 8 days by one original author make a candidate; 9 don't; 10 over 6 days don't; one `hiring` verdict blocks; `role_filled` posts aren't counted; a sharer of 10 junk posts isn't a candidate; with the setting off, `run()` silences nobody and returns the count.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): automatic author silencing, off by default`.

### Task 17: Post figures in `db:analyze`

**Files:**

- Modify: `apps/xjobs/src/scripts/analyze-matches.ts`
- Test: its spec if present, otherwise a pure function spec for the new section's formatting

**Interfaces:**

- Produces: a "Post extraction" section with, per UTC day for the last 7 days, post calls, estimated cost, verdict counts (by confidence), role jobs made, and posts that left the 7-day window still pending.

- [ ] **Step 1: Write a failing spec** for the section's builder with fixed rows.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit, push and open PR C.** Rollout: set `ADMIN_USERS` (already set) and leave `POST_AUTO_SILENCE` unset. After about a week of watching verdicts and the dry-run log, the owner decides whether to switch it on.

# Slice 03: Processor Quality and Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip jobs no current profile could take, label AI-training gigs, make Unverified meaningful, send unknown-stack matches to review, rebuild the golden baseline, and cut cost per job.

**Architecture:**

- A new `prefilter` module holds a pure check (tag, country, word list, profile demand), plus a pass the processor runs before claiming. Skipped jobs get a new `skipped` status and a recorded reason. A sweep and ingest re-sightings send them back to `pending`.
- Matcher rule changes ship under one `MATCHER_VERSION` bump.
- Prompt changes wait for a reviewed golden baseline.

**Tech Stack:** NestJS engine (`apps/xjobs`), TypeScript strict, Vitest, Prisma contract plus Supabase Postgres, `claude -p` processor.

**Spec:** `docs/superpowers/specs/2026-11-26-processor-quality-design.md`

## Global Constraints

- **Schema:** the only schema source is `libs/database/src/contract/contract.prisma`.
  - After `pnpm --filter @xjobs/database db:migration:plan`, set `libs/database/src/migrations/app/refs/db.json` `"hash"` to the new migration's `to`, keeping `invariants`.
  - Regenerate `libs/database/src/supabase/database.types.ts` and commit it.
- **Matching:** any rule change bumps `MATCHER_VERSION` in `apps/xjobs/src/modules/matcher/config/matcher.config.ts`, from 13 to 14, once for this slice.
- **Check window:** the recheck window is exactly **24 hours**, by `firstSeenAt`.
- **Word list:** exactly the spec's Part 1 table. Case-insensitive, whole words (prefix match allowed for stems), on NFKC-normalized `title + location + descriptionText`.
- **Never skip:**
  - a job with a current extraction;
  - a `joined` job;
  - a post or post role;
  - an untagged job, a remote-tagged job, or one with an unknown country;
  - a job with `remoteAllowed === true`.
- **No prompt change in Tasks 9 or 11** before Task 8's baseline is committed.
- **Workflow:** work in a worktree, on a feature branch per PR, with a PR to `main`. CI runs `npx nx run-many -t lint test build typecheck`, and it must be green.

## Review Focus

1. A profile whose hybrid or onsite places include `worldwide` lets every hybrid or onsite job through (Task 4 test).
2. A profile place that can't be resolved to countries (unknown region or city id) must let jobs through, not skip them (Task 4 test).
3. Titles in Unicode styled letters ("𝗥𝗲𝗺𝗼𝘁𝗲 (𝗘𝗨)") and words at line edges or next to punctuation ("(Remote)", "remote-first") match (Task 4 test).
4. A skipped job that becomes `joined`, or gets an extraction by any path, is never re-skipped and never keeps `skipped` (Task 5 test).
5. Unpublishing a profile, or narrowing its places, never touches processed jobs or their matches (Task 6 test).

---

## PR A: matcher rules (spec Parts 3 and 4)

### Task 1: Unverified rests on unsure facts only; `needsReview` drops engagement

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/decide.ts:93-96` (the `unverified` expression) and the `Decision.unverified` doc comment.
- Modify: `apps/xjobs/src/modules/processor/rules/validate.ts:206-218` (`needsReview`).
- Test: `apps/xjobs/src/modules/matcher/rules/decide.spec.ts`, `apps/xjobs/src/modules/processor/rules/validate.spec.ts`.

**Interfaces:**

- Produces: `Decision.unverified` = `outcome === 'qualified' && checks.some(c => c.unsure)`. `job.needsReview` is no longer read by `decide`.

- [ ] **Step 1: Write the failing tests**
  - In `decide.spec.ts`:
    - `qualified with an unknown contract type is not unverified`;
    - `qualified with an unsure seniority is unverified`;
    - `qualified on a job with needsReview and no unsure check is not unverified`.
  - In `validate.spec.ts`: `needsReview is false when only engagement is unsure`.
- [ ] **Step 2: Run them and see them fail.** Run `npx nx test xjobs -- decide.spec validate.spec`; expect the 4 new tests to fail.
- [ ] **Step 3: Implement.**
  - Change the `unverified` expression.
  - Remove `doc.engagement.confidence === 'unsure' ||` from `needsReview`.
  - Update the doc comments to the new meaning.
- [ ] **Step 4: Run the tests.** Same command; expect PASS, and the existing decide tests still pass. Fix any that asserted the old meaning, keeping their intent.
- [ ] **Step 5: Commit.** `fix(matcher): unverified means a pass rests on an unsure fact`

### Task 2: An unknown stack goes to review

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/rules/decide.ts`, after the "neither role nor stack" block (lines ~59-70).
- Test: `apps/xjobs/src/modules/matcher/rules/decide.spec.ts`.

**Interfaces:**

- Produces: when `stack.check.outcome === 'unknown'` and position wasn't turned into the "neither" failure, the stack check becomes `{ ...stack.check, outcome: 'fail', unsure: true, unsureField: 'techStack', reason: 'the posting names no technology we can compare with your stack (' + original reason + ')' }`.
  - `decide` then yields `review` with `{ rule: 'stack', field: 'techStack' }` when no other check fails surely.

- [ ] **Step 1: Write the failing tests:**
  - `a listing whose stack lists no requirements goes to review on stack/techStack`;
  - `a listing with only non-comparable requirements goes to review on stack/techStack`;
  - `a post role with an unknown stack goes to review`;
  - `an unknown stack with a sure location failure stays rejected`;
  - `an unstated role with an unknown stack still fails on position` (the existing rule is kept).
- [ ] **Step 2: Run them and see them fail.** Run `npx nx test xjobs -- decide.spec`; expect the new tests to FAIL.
- [ ] **Step 3: Implement the conversion in `decide`.** Use `restsOn('techStack')` from `./types` for the unsure fields.
- [ ] **Step 4: Run the matcher tests.** Run `npx nx test xjobs -- matcher`; expect PASS. Update `matcher.service.spec.ts` expectations that relied on a qualified unknown stack.
- [ ] **Step 5: Commit.** `feat(matcher): an unknown stack goes to review`

### Task 3: Matcher version, webhook docs, rollout notes

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/config/matcher.config.ts` (`MATCHER_VERSION = 14`).
- Modify: `docs/webhooks.md`, the line "Unverified matches are sent as well…": `match.unverified: true` means the match passed on at least one fact the processor was unsure of. Facts the posting doesn't state don't count.

- [ ] **Step 1:** Bump the version and edit the doc.
- [ ] **Step 2:** Run `npx nx run-many -t lint test build typecheck`; expect green.
- [ ] **Step 3: Commit,** push `feat/slice-03-matcher-rules`, and open PR A. Put the rollout steps in the PR body:
  - after deploy, run `db:rematch -- --all` on dev;
  - then `db:match-shares -- --days 7`. Expect the Unverified share among qualified matches at about 34% (it was 94%), and stack reviews up by about 59.

## PR B: the check before the LLM (spec Part 1)

### Task 4: The pure check and the word list

**Files:**

- Create: `apps/xjobs/src/modules/prefilter/rules/remote-words.ts`
- Create: `apps/xjobs/src/modules/prefilter/rules/check.ts`
- Create: `apps/xjobs/src/modules/prefilter/config/prefilter.config.ts`
- Test: `apps/xjobs/src/modules/prefilter/rules/remote-words.spec.ts`, `apps/xjobs/src/modules/prefilter/rules/check.spec.ts`

**Interfaces:**

- Produces:
  - `PREFILTER_VERSION = 1` and `RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000` (in `prefilter.config.ts`).
  - `mentionsRemote(text: string): string | null`, returning the first matched phrase, or null.
  - `interface OnSiteDemand { anywhere: boolean; countries: Set<string> }`
  - `onSiteDemand(profiles: { locations: PlacesByArrangement }[], idx: PlaceIndex): OnSiteDemand`
    - It reads `hybrid` and `onsite` places only, through `countriesOf` from `matcher/rules/places.ts`.
    - `worldwide`, or a place whose countries are unknown (`countriesOf` returns null), sets `anywhere: true`.
  - `interface PrefilterJob { workplaceType: string | null; countryCode: string | null; remoteAllowed: boolean | null; title: string | null; location: string | null; descriptionText: string | null }`
  - `type SkipReason = { version: number; tag: 'hybrid' | 'onsite'; country: string }`
  - `checkBeforeProcessing(job: PrefilterJob, demand: OnSiteDemand): { process: true; why: 'tag' | 'no_tag' | 'no_country' | 'demand' | 'remote_allowed' | 'remote_words'; matched?: string } | { process: false; reason: SkipReason }`

- [ ] **Step 1: Write the failing tests.**
  - In `remote-words.spec.ts`, one `it` per language row of the spec table, asserting a hit. Also:
    - `matches remote in "(Remote)"`;
    - `matches the bold title "𝗥𝗲𝗺𝗼𝘁𝗲 (𝗘𝗨)"`;
    - `matches "working from home"`;
    - `matches "anywhere in the US"`;
    - `does not match "hybrid", "flexible working" or "flexibility"`;
    - `does not match "remotely" inside another word` (for example "unremotely" → null; the left edge is a word boundary).
  - In `check.spec.ts`, each spec rule:
    - remote tag → process;
    - null tag → process;
    - hybrid with null country → process;
    - `remoteAllowed` true → process;
    - onsite in FR with demand `{countries: {MA}}` and no remote words → skip with reason `{version: 1, tag: 'onsite', country: 'FR'}`;
    - the same job with "Télétravail possible" → process, `why: 'remote_words'`;
    - hybrid in MA → process, `why: 'demand'`;
    - demand `anywhere` → process.
  - `onSiteDemand` tests:
    - a region expands to its countries;
    - a city id resolves to its country;
    - `worldwide` gives anywhere;
    - an unknown region gives anywhere;
    - remote-only places are ignored.
- [ ] **Step 2:** Run `npx nx test xjobs -- prefilter`; expect FAIL (no modules yet).
- [ ] **Step 3: Implement.**
  - Build one case-insensitive regex from the table: `\b`-style left boundaries via `(?<![\p{L}\p{N}])`, with the `u` flag, applied to `text.normalize('NFKC')`.
  - Stems (`telecommut`, `zdaln`, `удал[её]нн`, `remot[oa]`) match as prefixes.
  - Keep the phrase list as a `readonly string[]` per language, so the spec table maps one to one.
- [ ] **Step 4:** Run the same command; expect PASS.
- [ ] **Step 5: Commit.** `feat(prefilter): check a job before the LLM`

### Task 5: Schema, the pass before claiming, and re-sighting

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`:
  - `NormalizedJob`: add `processingSkip Jsonb?` (the `SkipReason`), and add `'skipped'` to `normalized_jobs_processing_status`;
  - `Profile`: add `prefilterCheckedVersion Int?`.
- Create: the migration under `libs/database/src/migrations/app/` (planned), the ref hash, and `database.types.ts`.
- Modify: `apps/xjobs/src/modules/ingest/normalize/processing.ts`:
  - add `'skipped'` to `ProcessingStatus`;
  - in `nextProcessing`, treat a `skipped` job seen on a newer observation like an archived one: `pending`, `reopened`.
- Create: `apps/xjobs/src/modules/prefilter/repositories/prefilter.repository.ts` (abstract plus Prisma implementation, following `processor.repository.ts`).
- Create: `apps/xjobs/src/modules/prefilter/services/prefilter.service.ts`, `apps/xjobs/src/modules/prefilter/prefilter.module.ts`.
- Modify: `apps/xjobs/src/modules/processor/controllers/processor.controller.ts`: call `PrefilterService.skipPending()` before `listPendingInScope` on each tick.
- Test: `apps/xjobs/src/modules/ingest/normalize/processing.spec.ts`, `apps/xjobs/src/modules/prefilter/services/prefilter.service.spec.ts` (with an in-memory repository in `prefilter/testing/`).

**Interfaces:**

- Consumes: Task 4's `checkBeforeProcessing`, `onSiteDemand`, `PREFILTER_VERSION`.
- Produces `PrefilterRepository`:
  - `listUncheckedPending(limit: number): Promise<(PrefilterJob & { id: string })[]>`: `kind = 'job'`, `processingStatus = 'pending'`, `currentExtractionId IS NULL`, `processingReason <> 'joined'`, in processor scope;
  - `loadDemand(): Promise<OnSiteDemand>`: published profiles plus the matcher's place index;
  - `markSkipped(jobId: string, reason: SkipReason): Promise<void>`: sets `processingStatus = 'skipped'`, `processingSkip = reason`, `processingRequestedAt = null`, only while the row is still `pending` with no extraction;
  - `reopenSkipped(filter: { firstSeenSince: Date }): Promise<number>`: `skipped` jobs from then on, not `closed` and not past `expiresAt`, go to `pending`/`reopened`, with `processingSkip` kept for history.
- Produces `PrefilterService`:
  - `skipPending(limit = 200): Promise<{ checked: number; skipped: number }>`.
  - It loads the demand once per call and logs one line with the counts.

- [ ] **Step 1: Write the failing tests.**
  - `processing.spec.ts`: `a skipped job seen on a newer observation goes back to pending as reopened`; `a skipped job on a replay stays skipped`.
  - `prefilter.service.spec.ts`:
    - `skips an onsite FR job nobody wants`;
    - `leaves a job with an extraction pending`;
    - `leaves a joined job pending`;
    - `leaves a post pending`;
    - `records the reason with PREFILTER_VERSION`.
  - Review Focus 4: `a job that gained an extraction between list and mark is not skipped` (`markSkipped` is guarded by its WHERE).
- [ ] **Step 2:** Run `npx nx test xjobs -- processing.spec prefilter`; expect FAIL.
- [ ] **Step 3: Schema and migration.**
  - Edit the contract and run `db:migration:plan`.
  - Set the ref hash.
  - Run `pnpm db:migrate` locally and check the column with `psql`.
  - Regenerate the types.
- [ ] **Step 4: Implement** the repository, the service, the module wiring and the controller call. Then grep for every reader of `processingStatus` (`grep -rn "processingStatus" apps/xjobs/src`) and make sure `skipped` isn't counted as pending, failed or processed in `processingCounts`, `db:reprocess` and the admin pages. Give `skipped` its own count where one is listed.
- [ ] **Step 5:** Run `npx nx test xjobs`; expect PASS.
- [ ] **Step 6: Commit.** `feat(prefilter): skipped status and the pass before claiming`

### Task 6: The recheck: profile sweep and the recheck command

**Files:**

- Modify: `apps/xjobs/src/modules/prefilter/services/prefilter.service.ts`.
- Modify: `apps/xjobs/src/modules/prefilter/repositories/prefilter.repository.ts`.
- Create: `apps/xjobs/src/scripts/recheck-skips.ts`, plus a `db:recheck-skips` entry in `apps/xjobs/package.json` and a line in `CLAUDE.md` Commands.
- Test: `apps/xjobs/src/modules/prefilter/services/prefilter.service.spec.ts`.

**Interfaces:**

- Produces `PrefilterService.recheckProfiles(now: Date): Promise<number>`.
  - Published profiles where `prefilterCheckedVersion IS DISTINCT FROM matchVersion` trigger `reopenSkipped({ firstSeenSince: now - RECHECK_WINDOW_MS })` once, then set `prefilterCheckedVersion = matchVersion`.
  - It runs on each processor tick before `skipPending`.
  - It relies on `matchVersion` bumping on publish and on place edits; Step 1 verifies that.
- `db:recheck-skips`: calls `reopenSkipped` for the last 24 hours. Use it after a `PREFILTER_VERSION` change. It takes `--dry-run`, and remote needs `XJOBS_ALLOW_REMOTE_DB=1`.

- [ ] **Step 1: Write the failing tests:**
  - `a newly published profile reopens skipped jobs from the last 24 hours only`;
  - `a job first seen 25 hours ago stays skipped`;
  - `a closed or expired skipped job stays skipped`;
  - `a second tick with no profile change reopens nothing`;
  - `a reopened job that still fails the check is skipped again by skipPending`.
  - Review Focus 5: `unpublishing a profile changes no processed job or match`.
  - Also check, in `libs/database` triggers, that a places edit bumps `matchVersion`. If it doesn't, add a test that pins the gap and compare `updatedAt` instead.
- [ ] **Step 2:** Run `npx nx test xjobs -- prefilter`; expect FAIL.
- [ ] **Step 3:** Implement the sweep, the command and the CLAUDE.md line.
- [ ] **Step 4:** Run `npx nx test xjobs`; expect PASS.
- [ ] **Step 5: Commit.** `feat(prefilter): recheck skipped jobs when profiles change`

### Task 7: Reports, and PR B

**Files:**

- Modify: `apps/xjobs/src/scripts/analyze-matches/sections.ts`:
  - a "Skipped before processing" section: counts by `tag` and `country` for the last 7 days, the total skip share among new listings, and 20 random skipped titles with their country.
- Modify: `apps/xjobs/src/scripts/match-shares.ts`:
  - one line, the skipped listings in the window and their share of new listings.
- Modify: `docs/roadmap/phase-5-indeed/04-ingest-process-match.md`. Add the constraint that Indeed's "not remote" maps to untagged (no `workplaceType`), so the check never skips an Indeed job.
- Test: the existing spec files for these scripts, where they exist (for example `analyze-matches/*.spec.ts`).

- [ ] **Step 1:** Write a failing test for the section's SQL on a fixture of two skipped jobs and one processed job.
- [ ] **Step 2:** Run it and see it fail; implement; run it and see it pass.
- [ ] **Step 3:** Run `npx nx run-many -t lint test build typecheck`; expect green.
- [ ] **Step 4: Commit,** push `feat/slice-03-prefilter`, and open PR B. Put the rollout in the body:
  - deploy (the migration applies);
  - watch the first ticks' `prefilter` log lines;
  - after one weekday, check `db:analyze`: about 28% skipped, and the titles sample audited with the owner;
  - check `db:match-shares`: qualified per profile not down.

## Step G: golden review and baseline (spec Part 5; process, with the owner)

### Task 8: Golden set, review sheet, baseline

**Files:**

- Create: `apps/xjobs/src/scripts/processor-golden-review.ts`, plus a `processor:golden-review` entry in `apps/xjobs/package.json`.
- Modify: `apps/xjobs/src/modules/processor/golden/cases/*.json`.
- Create: about 6 AI-training cases, 3 unknown-stack cases and 3 word-list hard cases (new JSON files named `slice03-<n>.json`), taken from dev postings by job id.
- Modify: `apps/xjobs/src/modules/processor/golden/golden.ts`, `score.ts`: drop `engagement` from `LabelKey` and from scoring.
- Test: `apps/xjobs/src/modules/processor/golden/score.spec.ts`.

**Interfaces:**

- `processor:golden-review -- --report <last-report json> --out <md path>` writes one item per field. An item is listed when:
  - the eval's value differs from `expected`; or
  - the key is `drafted` with `reviewed: false`; or
  - the new-label draft disagrees with the eval.
- Each item shows the case id, title, field, the label, the processor's value and the quote, numbered, in batches of 25.

- [ ] **Step 1:** Write a failing `score.spec.ts` test: `engagement is not scored`. Then make it pass by dropping engagement.
- [ ] **Step 2: Draft the new labels.**
  - Read each case's posting and write `drafted.arrangement`, `drafted.contractType` and `drafted.isSoftwareEngineeringRole` as `{ value, reviewed: false }`.
  - This must be done by reading the posting, never by copying model output.
  - Add the new cases with full `expected` labels, the same way.
- [ ] **Step 3: Run the eval.**
  - Run `PROCESSOR_WEEKLY_STOP_AT=0.95 pnpm --filter @xjobs/xjobs processor:eval` (about $3; it needs the owner's token locally).
  - Expect a `last-report.claude-sonnet-5-5.json` file and bars printed.
- [ ] **Step 4: Build the review sheet.**
  - Write `processor-golden-review.ts` with a small unit test of its item selection.
  - Run it to `tmp/golden-review.md`.
  - Auto-confirm the agreements: drafted keys where the draft equals the eval value get `reviewed: true`.
- [ ] **Step 5: Owner review.**
  - Send the owner one batch at a time in chat.
  - Apply each answer to the case JSON.
  - Settle #10372 and #7824, and the 16 `placeStrictness: unstated` openings.
- [ ] **Step 6: Baseline.**
  - Re-run the eval and record the four bars, cost per job and average output tokens in the PR body.
  - Commit the cases and `last-report.claude-sonnet-5-5.json`.
- [ ] **Step 7:** Push `test/slice-03-golden-baseline` and open the PR (it doesn't need a deploy).

## PR C: AI-training role kind and vocabulary (spec Parts 2 and 7)

### Task 9: `ai_training` is engineering, and the prompt definition

**Files:**

- Modify: `libs/database/src/seeds/vocab/seed-data.ts:966` (`ENGINEERING_ROLE_KINDS`): add `'ai_training'`.
- Create: a migration (rawSql data change) `UPDATE role_kinds SET "isEngineering" = true WHERE code = 'ai_training'`, with the ref hash and a new invariant name.
- Modify: `apps/xjobs/src/modules/processor/prompts/system.prompt.ts`, the role-kind paragraph (line ~135) and the `isSoftwareEngineeringRole` paragraph (line ~139).
- Modify: `apps/xjobs/src/scripts/reprocess-jobs.ts` and the `markPending` filter: add `--matched`, meaning jobs with a current `qualified` or `review` decision.
- Test: `apps/xjobs/src/modules/processor/rules/validate.spec.ts`, the reprocess args spec, and the golden eval.

- [ ] **Step 1: Write the failing tests:**
  - in `validate.spec.ts`, `ai_training with isSoftwareEngineeringRole true is not marked unsure` (the engineering set includes `ai_training`);
  - in the reprocess spec, `parseReprocessArgs(['--matched'])` gives `{ kind: 'matched' }`.
- [ ] **Step 2:** Run them and see them fail; implement the seed, the migration and the flag; run them and see them pass.
- [ ] **Step 3: Edit the prompt.**
  - Add the spec's definition verbatim after the role-kind paragraph, with the rule "what the work produces beats the title".
  - Add to `isSoftwareEngineeringRole`: "AI-training work is `true`."
- [ ] **Step 4: Eval.**
  - Run `processor:eval`.
  - Expect the AI-training cases to come out `ai_training` and the kind 4–5 cases not to.
  - All four bars must stay no worse than the Task 8 baseline. Otherwise, adjust the wording and run again.
- [ ] **Step 5: Commit.** `feat(processor): ai-training work is its own pickable role kind`

### Task 10: Vocabulary aliases and codes

**Files:**

- Modify: `libs/database/src/seeds/vocab/seed-data.ts` (the tech tags list): add codes for Databricks, SQL Server, Azure DevOps, Oracle, Helm, CloudFormation, PySpark, PowerShell, OpenTelemetry, Datadog, Power BI, BigQuery, MLflow, LlamaIndex, OpenShift, DynamoDB, ArgoCD, JUnit, Maven, Hibernate, Pulumi and AWS CDK.
  - Add aliases "CI/CD", "CI/CD pipelines" and "GitLab CI/CD" to `ci_cd`, or the existing GitLab CI code for the last if one exists (check with `db:vocab -- tech list`).
  - Leave out: Git, GitHub, GitLab, Jira, NoSQL, MLOps, OAuth 2.0, LLM APIs.
- Test: the vocabulary seed spec (it checks unique codes and aliases).

- [ ] **Step 1:** Add them and run `npx nx test database` (or the seed spec's project); expect PASS with no duplicate code or alias.
- [ ] **Step 2: Commit.** `feat(vocab): slice 03 tech codes and CI/CD aliases`
- [ ] **Step 3:** Push `feat/slice-03-roles-vocab` and open PR C. Put the rollout in the body:
  - deploy (the migration);
  - run the same `db:vocab` approve and alias commands on dev for each term;
  - `db:reprocess -- --matched` (about 760 jobs, about $28);
  - `db:rematch -- --all`;
  - check that no full-stack-profile match is `ai_training`.

## PR D: cost per job and max-turns (spec Parts 6 and 7)

### Task 11: Fewer output tokens

**Files:**

- Modify: `apps/xjobs/src/modules/processor/schema/model-output.ts:77`: remove `engagement` from the model's output.
- Modify: `apps/xjobs/src/modules/processor/prompts/system.prompt.ts`:
  - remove `engagement` from the keys line (23) and from its section (121–123);
  - add a quote rule: quote only the shortest span that shows the fact, at most about 15 words.
- Modify: `apps/xjobs/src/modules/processor/services/extraction-store.service.ts:144` and the assembler. The stored document keeps `engagement` as `{ value: 'unstated', confidence: 'sure', quote: '' }`, with the `decidedBy` value used for facts not asked of the model, so `facts.ts` and readers don't change.
- Test: `extraction-pipeline.service.spec.ts` and the golden eval.

- [ ] **Step 1:** Write a failing test: `the stored document carries engagement unstated when the model gives none`.
- [ ] **Step 2:** Implement; run `npx nx test xjobs`; expect PASS.
- [ ] **Step 3: Eval.**
  - Run `processor:eval`.
  - Record the average output tokens and cost per job against the baseline.
  - Every bar must be no worse than the baseline.
- [ ] **Step 4: Commit.** `perf(processor): stop extracting engagement, shorter quotes`

### Task 12: Max-turns failures

**Files:** to be found. Start with `apps/xjobs/src/modules/processor/services/generation.service.ts`, how it calls `claude -p` (`--max-turns 3`), and the attempt log.

- [ ] **Step 1: Reproduce.**
  - Pick 5 job ids from dev `processing_attempts` with the error `Reached maximum number of turns`.
  - Re-run them locally with the processor's verbose output (`processor:smoke` or `db:reprocess -- --job` against a local copy).
  - Record what each turn did.
- [ ] **Step 2: Use superpowers:systematic-debugging** to find the cause. Write a regression test at the unit that owns it (for example, how the schema-fix retry counts turns). The test must fail before the fix.
- [ ] **Step 3: Fix the cause.** Raise `--max-turns` only if the cause is that 3 turns are legitimately needed, and say why in the commit.
- [ ] **Step 4:** Run `npx nx run-many -t lint test build typecheck`; expect green.
- [ ] **Step 5: Commit,** push `feat/slice-03-cost`, and open PR D. In the body:
  - the eval numbers before and after;
  - a dev check after deploy: the max-turns share in `db:analyze` under 0.5%, and cost per job down from $0.037.

## Trials (process, after the PRs)

### Task 13: Haiku 5.5 trial

- [ ] **Step 1:** Run `processor:eval -- --generator claude-haiku-5-5`.
- [ ] **Step 2: Compare it with the latest Sonnet run.** Haiku passes if:
  - it meets all four bars;
  - its role-kind and seniority accuracy are each within 2 points of Sonnet's.
- [ ] **Step 3: Report to the owner** with the costs. On a pass, the model switch is its own one-line PR (the extraction model config), plus a reprocess plan the owner approves. On a fail, list the facts it missed.

### Task 14: The `AND remote` keyword test (after the Apify top-up)

- [ ] **Step 1: Confirm with the owner** that Apify accepts runs again: no `Too many outstanding invoices` in `search_segment_runs` in the last hour.
- [ ] **Step 2: Run the test.**
  - Run two harvestapi runs of the owner's Europe remote search over the same 24-hour window, at most 100 rows each, one with `AND remote` appended to the keyword. That's about $0.40; get the owner's OK first.
  - Reuse `db:split-check`'s runner pattern for a paid, capped script (`db:remote-keyword-check`, `--dry-run` first).
- [ ] **Step 3: Report** the row counts, the share LinkedIn tags remote, and the keyword length against the 319-character limit. The owner decides whether to put the word in the remote searches.

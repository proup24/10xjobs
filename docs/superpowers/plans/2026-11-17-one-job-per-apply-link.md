# One Job per Apply Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinkedIn jobs that share an apply link become one job whatever their titles, without losing any user's marks, and a merged job's page lists the postings behind it.

**Architecture:** The `url:` job key drops the title (normalizer version 6). `linkJob` renames a sole-source job's key in place instead of creating a new job, so re-keyed jobs keep their id; a real merge moves viewed marks as well as decisions. A new `job_postings(p_job_id)` database function returns each posting of a job with what differs, and the job page shows a "Merged · N postings" badge and a collapsed list.

**Tech Stack:** NestJS ingest (apps/xjobs), Prisma contract + same-hash data migration (libs/database), Supabase Postgres, Next.js (apps/web), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-17-one-job-per-apply-link-design.md`

## Global Constraints

- Work in the worktree `/home/lab/apps/10xjobs-apply-link`, branch `feat/one-job-per-apply-link` from `origin/main` (`15708b0` or later). The main checkout `/home/lab/apps/10xjobs` holds another session's uncommitted work: never touch it. One PR to `main`, pushed only with `git push -u origin feat/one-job-per-apply-link`.
- Key format exactly: `url:<canonical apply URL>` (no `|title`). `NORMALIZER_VERSION = 6`.
- The identifier guard stays: a URL without a 4+ digit run or a UUID keeps the `linkedin-job:` fallback key.
- No job is sent to Process by any change here, and nothing is reprocessed.
- The Prisma contract does not change. The migration is a same-hash `data` migration like `20261116T2230_job_decision_reads`; add its invariant id to `libs/database/src/migrations/app/refs/db.json` `invariants`, keeping the earlier ones, and keep `hash` as is.
- `job_postings` is `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, revoked from `PUBLIC, anon`, granted to `authenticated`.
- Copy, exactly: badge **Merged · {n} postings**; section toggle **{n} postings share this apply link**; per-posting marks **shown above**, **title differs**, **place differs**, **description differs**; link **View on LinkedIn**.
- UI built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`); works at 360px.
- Ingest Postgres specs need `INGEST_TEST_DATABASE_URL` (the `ingest_test` database; see the processor_test/ingest_test memory recipe). Confirm a suite ran, not skipped.

## Review Focus

1. **A re-key racing a new item that creates the same key.** The rename hits the `jobKey` unique index; `linkJobSafely` retries, and the retry must merge into the job that now exists. Pinned in Task 2 (concurrent saves test).
2. **An easy-apply job that gains an apply URL (the most common re-key today)** must keep its id, processing state and decisions, and must not be sent to Process. Pinned in Task 2 (rewritten tests).
3. **A user who viewed both copies** must end with one `job_views` row on the target, not a unique violation. Pinned in Task 3.
4. **A posting with no description, or one whose description differs only in spacing.** Null vs null is "same"; whitespace-only differences are "same". Pinned in Task 4.
5. **Another user opening `/?job=<id>` of a job they have no match or decision on** must get no postings. Pinned in Task 4.

---

### Task 0: Branch and docs

- [ ] **Step 1:** `cd /home/lab/apps/10xjobs-apply-link && git log --oneline -1` shows `15708b0` or later, and `git status` shows only the spec and this plan as untracked.
- [ ] **Step 2:** Commit both: `docs(spec): one job per apply link`.

### Task 1: The `url:` key drops the title

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/job-key.ts` (LinkedIn branch of `jobKey`, its doc comment)
- Modify: `apps/xjobs/src/modules/ingest/normalize/record.ts:3-8` (`NORMALIZER_VERSION` and comment)
- Modify: `docs/superpowers/specs/2026-11-01-ingest-normalized-jobs-design.md:105` (rule 2)
- Test: `apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts:65-176`
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts:783-798`

**Interfaces:**

- Produces: `jobKey(LINKEDIN_JOB_BOARD, …)` returns `` `url:${canonical}` `` when `canonicalApplyUrl(apply)` is non-null and `identifierPattern` matches its path + search, whatever `record.title` is.

- [ ] **Step 1: Update the unit tests.** In `job-key.spec.ts`, drop `|Engineer` from the expected keys at lines 73 and 84. Replace `keeps different roles behind one listing URL apart by their exact title` with `gives one key to copies of one apply URL under different titles` (the two titles' keys are equal, and both equal `` `url:${listing}` ``). Replace `falls back to the LinkedIn id for a URL key without a title` with `keys a URL without a title by the URL` (`title: null` gives `` `url:${listing}` ``). Keep `never adds the title to an ATS key`.
- [ ] **Step 2:** `npx nx test xjobs -- job-key` → the changed tests FAIL.
- [ ] **Step 3:** In `jobKey`, return `` `url:${canonical}` `` without the title check. Rewrite the doc comment: "A LinkedIn job is the posting its apply URL names, else that URL when it carries an identifier, else its own LinkedIn id." Set `NORMALIZER_VERSION = 6` with the comment "Version 6 keys a LinkedIn job by its apply URL alone (the title is no longer part of a `url:` key); run `db:renormalize`."
- [ ] **Step 4:** `npx nx test xjobs -- job-key` → PASS.
- [ ] **Step 5: Update the Postgres test.** Replace `keeps different roles on one listing page as separate jobs` with `merges copies of one apply link posted under different titles`: same two saves (use a URL with a posting id, e.g. `https://applicants.bairesdev.com/job/615/287041/apply`, titles `Front-End Developer (Angular) - Remote Work` and `Desarrollador Front-End (Angular) - Trabajo Remoto`); expect one job with `status: 'active'` and two `sources()` rows on it. Run `INGEST_TEST_DATABASE_URL=… npx nx test xjobs -- raw.postgres` → PASS (the suite ran).
- [ ] **Step 6:** In the ingest spec's rule 2, replace the key text with `url:<canonical>` and add: "(revised 2026-11-17, normalizer version 6: the title is dropped; copies of one ad under different titles are one job. No board on dev used one listing URL for several roles. See `2026-11-17-one-job-per-apply-link-design.md`.)"
- [ ] **Step 7:** Commit `feat(ingest): key a LinkedIn job by its apply URL alone`.

### Task 2: A sole-source re-key keeps its job

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`linkJob`; remove `carriedExtraction` and the `inherited` path)
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (tests at 518, 540–750 `mergeSetup`, 1116–1180)

**Interfaces:**

- Consumes: Task 1's key.
- Produces: `linkJob` behaviour. When no job has the item's key, the item is linked to an old job, and the item is that job's only source, the old job's `jobKey` is updated to the new key, and that job is linked and re-merged. `LinkOutcome.created` is false and processing state is unchanged. Otherwise as today.

- [ ] **Step 1: Rewrite the re-key tests to the new behaviour.**
  - `moves an item whose apply URL appears later, merging its old job` → `keeps the job when an item's apply URL appears later`. Expect one job, with the same id as before, `jobKey` starting `url:`, `status: 'active'`, `processingStatus: 'processed'`, and `result.job` `{ created: false, pending: false }`.
  - `carries the extraction over when a re-key creates the job` → `keeps the job and its extraction when a re-key finds no job`. Same id, `jobKey === ashbyKey`, `currentExtractionId === extraction.id`, `processedAt` t1, exactly one `JobExtraction` row.
  - `carries no extraction when the re-keyed job was still pending` → `keeps a pending job pending when it is re-keyed`. Same id, `processingStatus: 'pending'`, no extraction.
  - `mergeSetup` keeps its shape: the second item creates the `url:` job first, so the first item's move is still a real merge. Check that every `job decisions` test still passes unchanged.
  - Add `keeps decisions and views on a job that is only re-keyed`: save the easy-apply item, then `decide(old.id, 'applied', t1, null)` and insert a `job_views` row for `userId` on `old.id`. Then save it with the apply URL. Expect the decision and the view still on `old.id`, and `old.id` active with the `url:` key.
  - Add `merges into the job a concurrent item created under the new key`: run in parallel the re-key save of an easy-apply item and the first save of another item with the same apply URL. Expect exactly one active `url:` job with both sources. If the easy-apply job was emptied, it is `merged` into that job.
- [ ] **Step 2:** `INGEST_TEST_DATABASE_URL=… npx nx test xjobs -- raw.postgres` → the rewritten and new tests FAIL; the rest pass.
- [ ] **Step 3: Implement the rename in `linkJob`.** Before the `NormalizedJob.create`, when no job has `key` and a source link exists for the item on another job: lock that job (`forNoKeyUpdate`) and count its sources. If the item is the only one, `updateAll({ jobKey: key })` on it, use it as `job`, and leave `created` false. The existing `link.jobId === job.id` branch then just refreshes `normalizedVersionId`. Remove `carriedExtraction`, `inherited`, and the `if (created)` arm in the emptied-old-job branch. The `else if` arm, which takes over a pending state, stays for merges into an existing job. A unique violation from the rename is left to `linkJobSafely`'s retry.
- [ ] **Step 4:** Re-run → all PASS, including `rebuild` (`changes nothing when run twice`) and `never leaves an active job without sources when a rebuild races a move`.
- [ ] **Step 5:** Commit `feat(ingest): a re-keyed job keeps its id, matches and marks`.

### Task 3: A real merge moves viewed marks

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`moveViews`, `copyViewsBack`, their calls next to `moveDecisions` / `copyDecisionsBack`)
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (`job decisions` describe; rename it `job decisions and views`)

**Interfaces:**

- Produces: `moveViews(tx, fromJobId: string, toJobId: string): Promise<void>` and `copyViewsBack(tx, jobId: string): Promise<void>`, private to `jobs.writer.ts`.

- [ ] **Step 1: Write failing tests**, using a `view(jobId, viewedAt)` helper that creates a `JobView` row for `userId`, and `views()`, which lists `{ jobId, viewedAt }`:
  - `moves a view with the job it merged into`: view `old` at t1, then merge. Expect `[{ jobId: moved.id, viewedAt: t1 }]`.
  - `keeps one view when both merged jobs were viewed`: view `old` at t1 and `moved` at t2, then merge. Expect one row on `moved`, at t1 (the earliest view stays: the user first saw the job then).
  - `copies the view back to a merged job that revives`: same steps as `copies the decision back to a merged job that revives`, with a view instead of a decision. Expect rows on both `old` and `moved`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `moveViews` with the same `DELETE … RETURNING` / `INSERT … ON CONFLICT ("userId", "jobId") DO UPDATE SET "viewedAt" = LEAST(…)` shape as `moveDecisions`. Implement `copyViewsBack` with the same chain CTE as `copyDecisionsBack`, `ON CONFLICT DO NOTHING`. Call `moveViews` right after `moveDecisions`, and `copyViewsBack` right after `copyDecisionsBack`. Update both doc comments to say views move too.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ingest): viewed marks move with a merged job`.

### Task 4: `job_postings` database function

**Files:**

- Create: `libs/database/src/migrations/app/<timestamp>_job_postings/{migration.ts,migration.json,ops.json}`. Copy the shape of `20261116T2230_job_decision_reads` (same start/end snapshot `23a126fe…`). One `rawSql` op, id `functions.job_postings`, `invariantId: 'job-postings'`, `operationClass: 'data'`, target table `normalized_job_sources`.
- Modify: `libs/database/src/migrations/app/refs/db.json` (append `"job-postings"` to `invariants`)
- Modify: `libs/database/src/supabase/database.types.ts` (`pnpm db:types`)
- Modify: `apps/db-tests/src/support/fixtures.ts` (a `seedPostings` helper)
- Test: `apps/db-tests/src/job-postings.db.spec.ts`

**Interfaces:**

- Produces:

```sql
public.job_postings(p_job_id uuid) RETURNS TABLE(
  "rawItemId" uuid, channel text, title text, location text,
  "postedAt" timestamptz, "postingUrl" text, shown boolean,
  "titleDiffers" boolean, "placeDiffers" boolean, "descriptionDiffers" boolean)
```

  - One row per `normalized_job_sources` link of `p_job_id`. The fields come from `normalized_versions.record` (jsonb keys `title`, `location`, `countryCode`, `city`, `descriptionText`, `postedAt`, `postingUrl`), and `channel` from `raw_items`.
  - `shown`: `s."rawItemId"::text = j."fieldSources"->>'title'`.
  - `titleDiffers`: `record.title IS DISTINCT FROM j.title`.
  - `placeDiffers`: `location`, `countryCode` or `city` `IS DISTINCT FROM` the job's.
  - `descriptionDiffers`: `IS DISTINCT FROM` on `btrim(regexp_replace(text, '\s+', ' ', 'g'))` of both sides. Null on both sides is the same.
  - Rows only when the caller (`(SELECT auth.uid())`) has a `job_matches` or a `job_decisions` row on `p_job_id`; otherwise no rows.
  - Ordered by `shown DESC`, `"postedAt" ASC NULLS LAST`, `"rawItemId"`.

- [ ] **Step 1: Add `seedPostings(jobId: string, postings: { title: string; location?: string | null; countryCode?: string | null; city?: string | null; descriptionText?: string | null; postedAt?: string | null }[]): Promise<string[]>`** to the fixtures. It adds one raw item, version, normalized version (record built from those fields plus `postingUrl: https://www.linkedin.com/jobs/view/<n>`) and source link per posting, through the same path as `seedSourceChain`. It sets the job's `title`, `location`, `countryCode`, `city`, `descriptionText` and `fieldSources.title` to the first posting's, and returns the raw item ids in order. Cleanup goes through the existing tracked-row cleanup.
- [ ] **Step 2: Write `job-postings.db.spec.ts`:**
  - `returns each posting of a merged job with what differs`: posting 1 is Angular EN, "Colombia", description "Build UIs."; posting 2 is Angular ES, "Colombia", description "Build  UIs.\n". With a match for user A, expect two rows: the first is `shown: true` with every `…Differs` false; the second is `shown: false, titleDiffers: true, placeDiffers: false, descriptionDiffers: false`.
  - `marks a different place and description`: a second posting with "Bogotá" / `city` set and description "Other text." gives `placeDiffers: true, descriptionDiffers: true`.
  - `treats two missing descriptions as the same`: both null gives `descriptionDiffers: false`.
  - `returns one row for a single posting`.
  - `returns postings to a user who only has a decision on the job`.
  - `returns nothing to a user with no match or decision on the job`, run as user B.
  - `returns nothing to anon`: `anon().rpc('job_postings', …)` errors or returns no rows.
- [ ] **Step 3:** `pnpm db:test -- job-postings` → FAIL (function missing).
- [ ] **Step 4:** Write the migration and the `refs/db.json` invariant. Apply it with `pnpm db:migrate`, then run `pnpm db:types` and check the diff adds only `job_postings`.
- [ ] **Step 5:** `pnpm db:test -- job-postings` → PASS. Then `pnpm db:test` → all PASS.
- [ ] **Step 6:** Commit `feat(db): job_postings lists a job's postings and what differs`.

### Task 5: Merged postings on the job page

**Files:**

- Create: `apps/web/src/lib/matches/postings.ts` (`JobPosting`, `loadPostings`)
- Create: `apps/web/src/components/matches/job-postings.tsx` (`MergedBadge`, `JobPostings`)
- Modify: `apps/web/src/components/matches/match-detail.tsx` (`postings` prop; badge in the header; section under the header)
- Modify: `apps/web/src/app/(app)/page.tsx`, `apps/web/src/components/matches/matches-view.tsx` (load and pass `postings`)
- Modify: `apps/web/src/app/(app)/applications/page.tsx`, `apps/web/src/components/applications/applications-view.tsx` (same)
- Test: `apps/web/src/lib/matches/postings.spec.ts`, `apps/web/src/components/matches/job-postings.spec.tsx`

**Interfaces:**

- Consumes: `job_postings` (Task 4), via the generated types.
- Produces:
  - `type JobPosting = Database['public']['Functions']['job_postings']['Returns'][number]`
  - `loadPostings(supabase: Client, jobId: string | null): Promise<JobPosting[]>`: `[]` for a null or non-UUID id, and on a read error (logged with `console.error`, never thrown). A failed read hides the section and doesn't break the page.
  - `MatchDetail` gets `postings?: JobPosting[]`. `MatchesView` and `ApplicationsView` get `postings: JobPosting[]` and pass it through.

- [ ] **Step 1: `postings.spec.ts`:** `returns [] without a job`; `returns [] for a malformed id without reading` (rpc not called); `returns the rows`; `returns [] when the read fails`. Use a stubbed `rpc`, in the same style as `load.spec.ts`.
- [ ] **Step 2: `job-postings.spec.tsx`:**
  - `shows nothing for one posting`: `JobPostings` and `MergedBadge` render null for a 1-element list.
  - `shows the badge with the count`: "Merged · 2 postings".
  - `starts collapsed`: the toggle "2 postings share this apply link" has `aria-expanded="false"`, and no posting titles are shown.
  - `lists each posting when opened`: after a click, both titles appear. The shown posting has "shown above". The other has "title differs" but neither "place differs" nor "description differs". Each has a "View on LinkedIn" link with `target="_blank"` and `rel="noopener noreferrer"` to its `postingUrl`.
  - `omits the LinkedIn link for a posting without one`.
- [ ] **Step 3:** `npx nx test web -- postings job-postings` → FAIL.
- [ ] **Step 4: Implement.**
  - `loadPostings` uses `UUID` from `@/lib/setup/answers`.
  - `JobPostings`: a `Button` (variant `ghost`, with a chevron icon), with `aria-expanded` and `aria-controls`, toggling a `<ul>` held in `useState(false)`. Each line shows the title, then place · `posted {postedPhrase-style date}` · `TextLink` "View on LinkedIn", then the marks as `Badge variant="secondary"`.
  - `MergedBadge`: `Badge variant="secondary"` beside the `h2` in a wrapping flex row.
  - In `MatchDetail`, render `JobPostings` right after the header, only when `postings.length > 1`.
  - In both pages, add `loadPostings(supabase, <job id>)` to the existing `Promise.all`.
- [ ] **Step 5:** `npx nx test web` → PASS (existing `match-detail`, `matches-view` and applications specs included; give them `postings={[]}` where a prop is now required).
- [ ] **Step 6:** Run the app locally (`run` skill). Seed a job with two postings using the Task 4 fixture approach, or create one with SQL against the local DB. Open it on Matches at desktop width and at 360px: the badge wraps without horizontal scroll, the section is collapsed, and it opens.
- [ ] **Step 7:** Commit `feat(web): show the postings behind a merged job`.

### Task 6: Verify and open the PR

- [ ] **Step 1:** `npx nx run-many -t lint test build typecheck` → green. If `next build` dies on `SecurityFatalError`, re-run once (known flake).
- [ ] **Step 2:** `INGEST_TEST_DATABASE_URL=… npx nx test xjobs -- raw.postgres` and `pnpm db:test` → green, not skipped.
- [ ] **Step 3:** `git push -u origin feat/one-job-per-apply-link` and `gh pr create --base main`. The body covers:
  - the key change (normalizer 6);
  - rename in place, with the removed carry-over path;
  - views moving on merge;
  - `job_postings` (data migration, applies at deploy);
  - the page section;
  - the rollout steps below, for after merge and deploy.

**After merge and deploy (the user runs these; Claude has no remote write):**

1. `XJOBS_ALLOW_REMOTE_DB=1 pnpm --filter @xjobs/xjobs db:renormalize` against dev.
2. Check with read-only SQL:
   - Active `url:` jobs drop by exactly 15, and the 4 brief groups are 4 active jobs.
   - The 13 decisions and 14 views on `url:` jobs are all on active jobs.
   - The merged-away jobs have no matches, and the 4 kept jobs still have theirs.
   - No active `url:` job has sources with different titles other than those 4, or if one does, they name the same role.
3. The Angular pair's page shows "Merged · 2 postings", and "title differs" on the Spanish posting.
4. Over the next days, the processor's jobs per day drop.

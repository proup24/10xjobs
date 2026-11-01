# Ingest normalized jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest deterministically maps every raw version into one LinkedIn-shaped format, unifies raw items by canonical apply URL into `normalized_jobs`, and marks jobs `pending` for Process when new or reopened.

**Architecture:** Pure functions (`normalize`, `jobKey`, `mergeSources`, `nextProcessing`) in `modules/ingest/normalize/`, unit-tested with real fixtures. A `linkJob(tx, …)` writer runs inside the existing per-item raw transaction (`raw.repository.ts` `save`) and persists `normalized_versions`, `normalized_jobs`, `normalized_job_sources`. A script rebuilds everything at the current `NORMALIZER_VERSION` without touching processing status.

**Tech Stack:** NestJS, TypeScript strict (nodenext), Prisma Next contract (`contract.prisma` + `prisma migration plan`), zod 4, html-to-text 9, Vitest, PostgreSQL tests on `ingest_test`.

**Spec:** `docs/superpowers/specs/2026-11-01-ingest-normalized-jobs-design.md`

## Before starting

The branch `feat/pipeline-ingest` has uncommitted renames in `modules/ingest` (`raw.repository.ts`, `batch.service.ts`, …). Ask the human to commit them first; this plan assumes those file names.

## Global Constraints

- No LLM, no network call, no guessing: same raw version + same `NORMALIZER_VERSION` → byte-identical `record` JSON (keys in a fixed order).
- A field the source does not state stays null. Ashby `companyName` is never derived from the slug or the Google title. A post author is only `poster`, never `companyName`.
- When in doubt, do not unify: a missed merge is acceptable, a wrong merge is not.
- Raw writes never depend on normalization: a normalize-invalid item still gets its raw rows.
- Ingest only ever writes `processingStatus = 'pending'` (or leaves it). `processing | processed | failed` belong to Process.
- Reopen threshold: `reopenAfterMs = 21 days` in config. Uses `observedAt`, never wall-clock time.
- Tables are shared, not workspace-scoped.
- Source precedence: Ashby/Greenhouse (1) > LinkedIn job board (2) > LinkedIn post (3).
- Tracking parameters stripped: `utm_*`, `trk*`, `gh_src`, `refId`, `ref`, `src`, `source`. All other query parameters kept, sorted.
- Unit tests: `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest`. Postgres tests need `INGEST_TEST_DATABASE_URL` (see `modules/ingest/README.md`).

## Review Focus

1. A LinkedIn `EXTERNAL` job whose `applyUrl` is a `*.linkedin.com` URL must fall back to `linkedin-job:<id>`, not become `url:…linkedin.com…` (test in Task 3).
2. An `applyUrl` that is not a valid http(s) URL (`mailto:`, garbage text) must fall back, not throw and not mark the item invalid (test in Task 3).
3. Out-of-order replay: an older batch processed after a newer one must not move a raw item's job link backwards or change processing status (test in Task 6).
4. A move where the old job keeps other sources must re-merge the old job (its fields must no longer include the moved source) (test in Task 6).
5. A Greenhouse `content` with double-encoded entities (`&amp;lt;`) is decoded exactly once (test in Task 2).

---

### Task 1: Unified record schema and LinkedIn mappers

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/record.ts`
- Create: `apps/xjobs/src/modules/ingest/normalize/text.ts`
- Create: `apps/xjobs/src/modules/ingest/normalize/linkedin.ts`
- Create: `apps/xjobs/src/modules/ingest/normalize/normalize.ts`
- Create: `apps/xjobs/src/modules/ingest/normalize/index.ts`
- Test: `apps/xjobs/src/modules/ingest/normalize/linkedin.spec.ts`
- Modify: `apps/xjobs/src/modules/ingest/config/channels.ts` (add `'document.manifest'` to LinkedIn posts `volatileKeys`)
- Modify: `apps/xjobs/src/modules/ingest/utils/content-hash.spec.ts` (one test: two post payloads differing only in `document.manifest` hash equal)

**Interfaces:**

- Produces (`record.ts`):
  - `export const NORMALIZER_VERSION = 1;`
  - `export const normalizedRecordSchema` (zod object, strict) and `export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>` with fields, in this order: `kind: 'job'|'post'`, `title`, `companyName`, `companyUrl`, `location`, `contractType`, `experienceLevel`, `sector` (all `string|null`), `salary: { text: string|null; min: number|null; max: number|null; currency: string|null; period: string|null } | null`, `publishedAt: string|null` (`/^\d{4}-\d{2}-\d{2}$/`), `descriptionHtml`, `descriptionText`, `applyUrl` (`string|null`, URL), `postingUrl: string` (URL), `poster: { name: string|null; profileUrl: string|null; type: 'person'|'company'|null } | null`, `closed: boolean`. Refinement: unless `closed`, `title` or `descriptionText` is non-null.
  - `export const RECORD_FIELDS: readonly (keyof NormalizedRecord)[]` (the order above; used for canonical JSON and merging).
  - `export type NormalizeResult = { record: NormalizedRecord } | { invalid: string }`.
- Produces (`text.ts`): `cleanText(value: unknown): string | null` (trim; `''`, `'undefined'`, `'null'` → null; non-strings → null), `htmlToPlainText(html: string): string` (html-to-text, `wordwrap: false`, fixed options), `datePart(value: unknown): string | null` (ISO date or datetime → `YYYY-MM-DD` in UTC; else null).
- Produces (`normalize.ts`): `normalize(channel: Channel, payload: unknown): NormalizeResult` — dispatches to the channel mapper, then `normalizedRecordSchema.safeParse`; failure → `{ invalid: 'normalize: <path>: <message>' }` from the first issue.
- Produces (`linkedin.ts`): `mapLinkedinJob(p: Record<string, unknown>): NormalizedRecord`, `mapLinkedinPost(p): NormalizedRecord`.

- [ ] **Step 1: Write failing tests in `linkedin.spec.ts`** using `utils/fixtures/linkedin-job.json` and `linkedin-post.json` plus inline variants:
  - `maps every LinkedIn job field`: title, companyName, location, contractType, experienceLevel, sector, publishedAt equal the fixture values; `descriptionText === fixture.description`; `postingUrl === 'https://www.linkedin.com/jobs/view/<id>'` even when `jobUrl` is `https://pl.linkedin.com/jobs/view/senior-…-<id>`; `closed === false`; `kind === 'job'`.
  - `salary`: with `salaryMin: 50000, salaryMax: 80000, salaryCurrency: 'GBP', salaryPeriod: 'yr', salary: '£50,000.00/yr - £80,000.00/yr'` → that object; with `salary: ''` and no min/max → `salary === null`.
  - `poster`: `posterFullName: ''` → `poster === null`; non-empty → `{ name, profileUrl, type: 'person' }`.
  - `applyUrl`: `applyType: 'EASY_APPLY'` → null; `EXTERNAL` with `https://es.linkedin.com/…` → null; `EXTERNAL` with `https://sii.pl/…` → that URL unchanged (canonicalization belongs to the job key).
  - `maps a post`: `kind 'post'`, title/companyName/location null, `descriptionText === content`, `publishedAt` from `postedAt.date`, `poster` from `author.name`/`author.linkedinUrl`/`author.type`, `postingUrl === linkedinUrl`, `applyUrl === null` even with `article.link`.
  - `sentinels`: `title: 'undefined'`, `location: '  '` → null.
  - `invalid`: a job with no title and no description → `{ invalid }` whose text starts with `normalize:`; a post with no `linkedinUrl` → invalid.
  - `deterministic`: `JSON.stringify(normalize(c, p))` equal for `p` and a key-shuffled copy of `p`.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/normalize` — expect FAIL (modules missing).
- [ ] **Step 3: Implement** `record.ts`, `text.ts`, `linkedin.ts`, `normalize.ts` (Ashby/Greenhouse branches return `{ invalid: 'normalize: unsupported channel' }` until Task 2), and `index.ts` re-exports. Mappers build the record by assigning keys in `RECORD_FIELDS` order. Add the volatile key and its hash test.
- [ ] **Step 4: Run** the same command plus `src/modules/ingest/utils` — expect PASS.
- [ ] **Step 5: Commit** `feat(ingest): unified record schema and LinkedIn mappers`

### Task 2: Ashby and Greenhouse mappers

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/ats.ts`
- Modify: `apps/xjobs/src/modules/ingest/normalize/normalize.ts`, `text.ts`
- Test: `apps/xjobs/src/modules/ingest/normalize/ats.spec.ts`

**Interfaces:**

- Consumes: `cleanText`, `htmlToPlainText`, `datePart`, `RECORD_FIELDS` (Task 1).
- Produces: `mapAshby(p): NormalizedRecord`, `mapGreenhouse(p): NormalizedRecord`, `decodeEntitiesOnce(s: string): string` in `text.ts` (named `&lt; &gt; &amp; &quot; &apos; &nbsp;` and numeric `&#NN;`/`&#xHH;`, single left-to-right pass), `ASHBY_EMPLOYMENT: Record<string, string>` = `{ FullTime: 'Full-time', PartTime: 'Part-time', Contract: 'Contract', Intern: 'Internship', Temporary: 'Temporary' }`.

- [ ] **Step 1: Write failing tests in `ats.spec.ts`** with `fixtures/ashby.json`, `ashby-failed.json`, `greenhouse.json`:
  - `Ashby`: title, `location === posting.locationName`, `contractType === 'Full-time'` for `FullTime`, unknown `employmentType: 'Other'` → null, `publishedAt === datePart(publishedDate)`, `descriptionText === htmlToPlainText(descriptionHtml)`, `companyName === null` (even when `hit.title` is `"Role @ Company"`), `postingUrl` and `applyUrl` equal the posting URL from `resolvedUrl ?? hit.url`.
  - `Greenhouse`: `companyName === posting.company_name`, `location === posting.location.name`, `publishedAt` from `first_published` (UTC date), `applyUrl === postingUrl === posting.absolute_url`; `descriptionHtml === decodeEntitiesOnce(content)`.
  - `decodeEntitiesOnce('&amp;lt;p&amp;gt;') === '&lt;p&gt;'` and `decodeEntitiesOnce('&lt;p&gt;x&#39;s&lt;/p&gt;') === "<p>x's</p>"`.
  - `closed`: `ashby-failed.json` (`posting: null`, `fetchError` contains `closed or unavailable`) → `{ kind:'job', closed:true, postingUrl: hit URL }`, every other field null. A failed fetch whose error does **not** say closed/unavailable → invalid `normalize: posting not fetched`.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/normalize` — expect FAIL.
- [ ] **Step 3: Implement** `ats.ts` and wire `ASHBY` / `GREEN_HOUSE` into `normalize`. Closed detection: `posting === null && /closed or unavailable/i.test(fetchError)`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ingest): Ashby and Greenhouse mappers`

### Task 3: Job key

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/job-key.ts`
- Create: `apps/xjobs/src/modules/ingest/config/normalize.ts` (export from `config/index.ts`)
- Test: `apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts`

**Interfaces:**

- Consumes: `atsIdentity`, `webUrl` (`utils/identity.ts`); `NormalizedRecord`.
- Produces:
  - `normalizeConfig = { trackingParams: [/^utm_/i, /^trk/i, 'gh_src', 'refId', 'ref', 'src', 'source'], identifierPattern: /\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, reopenAfterMs: 21 * 24 * 3600 * 1000 } as const`.
  - `canonicalApplyUrl(value: string): string | null` — null when not http(s) or on a LinkedIn host; else lowercase host, no fragment, no trailing `/`, tracking params removed, rest sorted by key then value.
  - `jobKey(channel: Channel, sourceKey: string, record: NormalizedRecord): string` — rules in spec §2: (1) `ats:<provider>/<tenantKey>/<postingId>` from `record.applyUrl` (Ashby/Greenhouse records: from `postingUrl`); (2) `url:<canonical>` when the canonical URL's path+query matches `identifierPattern`; (3) fallback: LinkedIn job `linkedin-job:<id>` (id from `sourceKey` `id:<id>`, else `linkedin-job:` + sourceKey), post always `linkedin-post:<id>`, ATS item `ats:ashby/` or `ats:greenhouse/` + the part after `posting:` (same shape as rule 1). Never throws.

- [ ] **Step 1: Write failing tests** (all pure, inline URLs from the spec's data section):
  - `jobs.ashbyhq.com/block-labs/287770d2-…/application` (LinkedIn applyUrl) and the Ashby item with sourceKey `posting:block-labs/287770d2-…` → same key `ats:ashby/block-labs/287770d2-…`.
  - Greenhouse `app.greenhouse.io/embed/job_app?for=a&token=111` vs `?for=b&token=222` → different keys; `job-boards.greenhouse.io/affirm/jobs/8016868003` (LinkedIn) equals Greenhouse item `posting:affirm/8016868003`.
  - `ibmglobal.avature.net/en_us/careers/jobdetail?jobId=1&utm_source=x` vs `?jobId=2` → different `url:` keys, both without `utm_source`.
  - Sii: `https://sii.pl/en/job-ads/id/38247/?sii_source=10&utm_source=linkedin.com&utm_medium=referral#apply-contact-form` and the same without utm/fragment → identical `url:https://sii.pl/en/job-ads/id/38247?sii_source=10`.
  - `https://acme.com/careers/` (no identifier) → `linkedin-job:4483908744`.
  - Easy Apply (`applyUrl: null`) → `linkedin-job:<id>`; `applyUrl` on `es.linkedin.com` → `linkedin-job:<id>` (Review Focus 1); `applyUrl: 'mailto:jobs@acme.com'` and `'not a url'` → fallback, no throw (Review Focus 2).
  - Post with `article.link` → `linkedin-post:<id>`.
  - Closed Ashby record → `ats:ashby/<org>/<id>` (from `postingUrl`).
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/normalize/job-key.spec.ts` — expect FAIL.
- [ ] **Step 3: Implement** `config/normalize.ts`, `canonicalApplyUrl`, `jobKey`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ingest): deterministic job key from apply URL`

### Task 4: Merge and processing decisions (pure)

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/merge.ts`
- Create: `apps/xjobs/src/modules/ingest/normalize/processing.ts`
- Test: `merge.spec.ts`, `processing.spec.ts` (same folder)

**Interfaces:**

- Produces (`merge.ts`):
  - `interface MergeSource { rawItemId: string; channel: Channel; record: NormalizedRecord; lastSeenAt: Date; createdAt: Date }`
  - `interface MergedJob { record: NormalizedRecord; fieldSources: Partial<Record<keyof NormalizedRecord, string>> }`
  - `mergeSources(sources: MergeSource[]): MergedJob` — throws on empty input. Sort sources by precedence (ASHBY/GREEN_HOUSE 1, LINKEDIN_JOB_BOARD 2, LINKEDIN_POSTS 3), then `lastSeenAt` desc, then `createdAt` desc. Each field in `RECORD_FIELDS` except `kind` and `closed` = first non-null among non-closed sources, `fieldSources[field]` = its `rawItemId`. `postingUrl` = first source's (closed sources included, so a job never lacks one). `kind` = `'post'` iff every source is a post. `closed` = true iff at least one ATS source exists and every ATS source's record is closed.
- Produces (`processing.ts`):
  - `type ProcessingStatus = 'pending'|'processing'|'processed'|'failed'`; `type ProcessingReason = 'new'|'reopened'`
  - `interface ProcessingState { status: ProcessingStatus | null; reason: ProcessingReason | null; requestedAt: Date | null }`
  - `nextProcessing(input: { created: boolean; previousLastSeenAt: Date | null; observedAt: Date; current: ProcessingState; rebuild: boolean }): ProcessingState` — `rebuild` → `current` unchanged; `created` → `{ pending, new, observedAt }`; `observedAt − previousLastSeenAt ≥ normalizeConfig.reopenAfterMs` → `{ pending, reopened, observedAt }`; else `current`.

- [ ] **Step 1: Write failing tests:**
  - merge: Ashby (`location: 'Remote (United States | Canada)'`, `companyName: null`) + LinkedIn (`location: 'United States'`, `companyName: 'Block Labs'`) → location from Ashby, companyName from LinkedIn, `fieldSources` names each raw item id; two LinkedIn sources → newer `lastSeenAt` wins, tie → newer `createdAt`; closed Ashby + open LinkedIn → `closed true`, fields from LinkedIn; one closed + one open Ashby → `closed false`; LinkedIn-only → `closed false`; post-only → `kind 'post'`; result is identical for any input order.
  - processing: created → pending/new; `previousLastSeenAt` 20 days before `observedAt`, current `processed` → unchanged; exactly 21 days → pending/reopened with `requestedAt = observedAt`; `observedAt` earlier than `previousLastSeenAt` → unchanged; current `processing` + 21-day gap → pending/reopened; `rebuild: true` + created → unchanged (`status null`).
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/normalize` — expect FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ingest): source merge and processing status decisions`

### Task 5: Tables

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (after `RawItemSighting`)
- Generated: `contract.json`, `contract.d.ts`, `migrations/app/<timestamp>_ingest_normalized_jobs/`
- Modify: `apps/xjobs/src/database/models.ts` (export `NormalizedVersionRow`, `NormalizedJobRow`, `NormalizedJobSourceRow`)
- Modify: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (truncate the new tables in the existing truncate list)

**Interfaces:**

- Produces models (spec §5), with these exact column types:
  - `NormalizedVersion` → `@@map("normalized_versions")`: `id Uuid @id @onCreate(uuid(7))`, `rawVersionId Uuid` (relation to `RawItemVersion`, `onDelete: Cascade`), `normalizerVersion Int`, `status String` (check `IN ('valid','invalid')`), `reason String?`, `record Jsonb?`, `jobKey String?`, `createdAt TimestamptzJsDate(3) @default(now())`; `@@unique([rawVersionId, normalizerVersion])`.
  - `NormalizedJob` → `@@map("normalized_jobs")`: identity columns `jobKey String @unique`, `kind String` (check), `status String` (check `IN ('active','merged')`), `mergedIntoId Uuid?` (self relation, `Restrict`); field columns `title, companyName, companyUrl, location, contractType, experienceLevel, sector, salaryText, salaryCurrency, salaryPeriod, publishedAt (String?, YYYY-MM-DD), descriptionHtml, descriptionText, applyUrl, posterName, posterProfileUrl, posterType` as `String?`, `salaryMin Int?`, `salaryMax Int?` (whole units, `Math.round`), `postingUrl String`, `closed Boolean`; `fieldSources Jsonb`; `firstSeenAt`, `lastSeenAt` `TimestamptzJsDate(3)`; `processingStatus String?` (check `IS NULL OR IN ('pending','processing','processed','failed')`), `processingReason String?` (check), `processingRequestedAt TimestamptzJsDate(3)?`, `processingAttempts Int @default(0)`, `processingError String?`, `processedAt TimestamptzJsDate(3)?`; `normalizerVersion Int`; `Timestamps` mixin; `@@index([processingStatus, processingRequestedAt])`.
  - `NormalizedJobSource` → `@@map("normalized_job_sources")`: `id Uuid @id`, `jobId Uuid` (relation, `Restrict`), `rawItemId Uuid @unique` (relation to `RawItem`, `Cascade`), `normalizedVersionId Uuid` (relation, `Cascade`), `linkedAt TimestamptzJsDate(3)`; `@@index([jobId])`.

- [ ] **Step 1: Edit `contract.prisma`** with the three models, following the existing models' style (comments, check names `<table>_<column>`).
- [ ] **Step 2: Run** `cd apps/xjobs && pnpm db:format && pnpm db:migration:plan --name ingest_normalized_jobs` — expect a new migration folder with `CREATE TABLE` for the three tables and no change to existing tables.
- [ ] **Step 3: Apply to the test database** (README command) and run `npx nx typecheck xjobs` — expect PASS.
- [ ] **Step 4: Run** the existing Postgres suite: `INGEST_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/repositories` — expect PASS (truncation includes new tables).
- [ ] **Step 5: Commit** `feat(db): normalized_versions, normalized_jobs and normalized_job_sources`

### Task 6: Link raw items to normalized jobs in the item transaction

**Files:**

- Create: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts`
- Modify: `apps/xjobs/src/modules/ingest/repositories/raw.repository.ts` (`save` calls `linkJob`; `saveItem` return type)
- Test: add a `describe('normalized jobs')` block to `raw.postgres.spec.ts`

**Interfaces:**

- Consumes: `normalize`, `jobKey`, `mergeSources`, `nextProcessing`, `NORMALIZER_VERSION` (Tasks 1–4).
- Produces:
  - `type LinkOutcome = { invalid: string } | { jobId: string; created: boolean; reopened: boolean }`
  - `linkJob(tx: DatabaseTransaction, input: { rawItemId: string; channel: Channel; sourceKey: string; latestVersionId: string; observedAt: Date; previousItemLastSeenAt: Date | null; rebuild: boolean }): Promise<LinkOutcome>`
  - `saveItem` / `save` return `{ newItem: boolean; newVersion: boolean; job: LinkOutcome }`. `save` calls `linkJob` after `latestVersionId` is updated, passing `rebuild: false`.
- Behavior of `linkJob` (spec §3–4, in order):
  1. Get or create the `normalized_versions` row for `(latestVersionId, NORMALIZER_VERSION)` by running `normalize` on the latest version's payload. Invalid → return `{ invalid }` and change nothing else (an existing link stays).
  2. `key = jobKey(...)`. Lock (`forNoKeyUpdate`) the job with that key, creating it (`status 'active'`, `firstSeenAt = lastSeenAt = observedAt`) if missing.
  3. Current link for `rawItemId`: none → insert source row; same job → update `normalizedVersionId`; other job `A` → move the source row to the new job, then if `A` has no sources left set `A.status = 'merged'`, `A.mergedIntoId = job.id`, and — when the new job was created by this move — copy `A`'s processing columns to it instead of marking it new; if `A` was `pending` and the target is not, copy `pending` + reason + requestedAt to the target. If `A` still has sources, re-merge `A`.
  4. Re-merge the job from all its sources' current `normalized_versions` records (`mergeSources`), write field columns, `fieldSources`, `closed`, `kind`, `normalizerVersion`; `firstSeenAt = min`, `lastSeenAt = max(observedAt)`.
  5. Processing: `nextProcessing({ created: created && !inheritedFromMove, previousLastSeenAt: job's lastSeenAt before step 4 (null if created), observedAt, current, rebuild })`; write if changed, resetting `processingAttempts = 0` and `processingError = null` when it becomes `pending`.
- Out-of-order guard: the link follows the raw item's **latest** version (already chosen by `save` by `lastSeenAt`), so replaying an older batch normalizes the same latest version and moves nothing.

- [ ] **Step 1: Write failing Postgres tests** (build items with `repo.saveItem` like the existing tests; LinkedIn payloads built from `linkedin-job.json` with overrides):
  - 10 LinkedIn items (distinct ids, same Sii `applyUrl` with different cities) → 1 `normalized_jobs` row, 10 `normalized_job_sources`, `processingStatus 'pending'`, reason `new`.
  - LinkedIn job applying to `jobs.ashbyhq.com/<org>/<id>/application` + Ashby item for `posting:<org>/<id>` → 1 job; `location` from Ashby, `companyName` from LinkedIn; `fieldSources.location` = Ashby raw item id.
  - New source on a job set to `processed` → stays `processed`, columns updated.
  - Same item seen at t, then t + 20 days → status unchanged; then t + 41 days (21 after the previous sighting) → `pending`/`reopened`, `processingRequestedAt` = that observedAt.
  - LinkedIn item first with no `applyUrl` (job `linkedin-job:<id>`), then a new version with the Sii URL → the source moves; the old job is `merged` with `mergedIntoId`; the new job inherits the old processing state (not `new`).
  - Move where the old job keeps another source → old job stays `active` and its fields no longer come from the moved item (Review Focus 4).
  - Replaying the same batch → row counts and `updatedAt`-independent column values unchanged.
  - Newer version saved at t2, then an older batch at t1 with the old payload → link unchanged, status unchanged (Review Focus 3).
  - Two concurrent `saveItem` calls for different raw items with the same apply URL → 1 job, 2 sources.
  - A LinkedIn job with no title and no description → raw rows written, `job.invalid` returned, no `normalized_jobs` row.
- [ ] **Step 2: Run** `INGEST_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/repositories` — expect FAIL.
- [ ] **Step 3: Implement** `jobs.writer.ts` and the `save` change.
- [ ] **Step 4: Run** — expect PASS, including the pre-existing raw-storage tests.
- [ ] **Step 5: Commit** `feat(ingest): unify raw items into normalized jobs`

### Task 7: Batch report

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/types/batch.types.ts`, `services/batch-item-writer.service.ts`, `services/batch.service.ts` (log line)
- Test: `apps/xjobs/src/modules/ingest/services/batch.service.spec.ts`

**Interfaces:**

- Consumes: `saveItem(...).job: LinkOutcome` (Task 6).
- Produces: `BatchReport` gains `normalized: number`, `normalizeInvalid: number`, `newJobs: number`, `reopened: number`; `errors` items gain `stage: 'validate' | 'normalize'` (existing entries `'validate'`). Normalize-invalid items count in `normalizeInvalid`, not in `invalid`, and share the `maxReportErrors` cap.

- [ ] **Step 1: Write failing tests** in `batch.service.spec.ts` with a fake repository whose `saveItem` returns chosen `job` outcomes: counts for `normalized` (valid outcomes), `normalizeInvalid`, `newJobs` (`created`), `reopened`; a normalize-invalid error entry has `stage: 'normalize'` and the reason; existing validation errors have `stage: 'validate'`.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/services` — expect FAIL.
- [ ] **Step 3: Implement**; add `jobs=<newJobs> reopened=<reopened> normalizeInvalid=<n>` to the ingested log line.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ingest): report normalization in batch reports`

### Task 8: Rebuild script, backfill, docs

**Files:**

- Create: `apps/xjobs/src/modules/ingest/services/renormalize.service.ts` (provided by `IngestModule`)
- Create: `apps/xjobs/src/scripts/renormalize-jobs.ts` (same shape as `regenerate-query-search.ts`, imports `IngestModule`)
- Modify: `apps/xjobs/package.json` (`"db:renormalize": "tsx --tsconfig tsconfig.app.json src/scripts/renormalize-jobs.ts"`), `apps/xjobs/src/modules/ingest/ingest.module.ts`, `apps/xjobs/src/modules/ingest/README.md`, repo-root `CLAUDE.md` Commands list
- Test: add to `raw.postgres.spec.ts`

**Interfaces:**

- Consumes: `linkJob` (Task 6) with `rebuild: true`.
- Produces: `RenormalizeService.run(): Promise<{ items: number; invalid: number; jobs: number }>` — iterates `raw_items` by `id` in pages of 500; per item one transaction calling `linkJob({ …, latestVersionId: item.latestVersionId, observedAt: item.lastSeenAt, previousItemLastSeenAt: null, rebuild: true })`.

- [ ] **Step 1: Write failing Postgres tests:** after saving items normally, delete all `normalized_*` rows and run `run()` → same jobs, sources and field values as before, `processingStatus` null for every job; run it again → no changes; with existing `processed` jobs, `run()` leaves `processingStatus` as is.
- [ ] **Step 2: Run** the Postgres suite — expect FAIL.
- [ ] **Step 3: Implement** the service, script and package script. README: a "Normalized jobs" section (tables, job key rules, processing status, `pnpm --filter @xjobs/xjobs db:renormalize` after a `NORMALIZER_VERSION` bump). CLAUDE.md: add the `db:renormalize` command line.
- [ ] **Step 4: Run** the Postgres suite and `npx nx run-many -t lint test build typecheck` — expect PASS.
- [ ] **Step 5: Backfill locally:** the human applies the migration to the dev database and runs `pnpm --filter @xjobs/xjobs db:renormalize`. Expected roughly: 317 items, fewer jobs than items (Sii, Block Labs, Kraken, Voodoo collapse), 0–3 invalid. Spot check: `select count(*) from normalized_job_sources s join normalized_jobs j on j.id=s."jobId" where j."jobKey" like 'url:https://sii.pl/%';` ≥ 10.
- [ ] **Step 6: Commit** `feat(ingest): renormalize script and docs`

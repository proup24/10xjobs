> Extraction flow superseded by 2026-11-07-generate-then-verify-design.md

# Processor: typed job facts from LinkedIn job board postings

## Intent

Ingest gives the engine one clean `normalized_jobs` row per posting, holding only the exact facts the source states. Qualify, which comes next, needs more than that: where a candidate may work from, under what arrangement, what stack, what seniority, what contract. Most of those facts sit in the description prose.

The processor reads each `pending` normalized job and writes **typed, sourced facts** about the posting. A fact it cannot establish stays empty and is marked unsure. It never guesses: a wrong fact leads straight to the two worst failures of the product, applying to the wrong job or rejecting the right one.

Two kinds of model split the work:

- **A decision model** (TypeSafe AI's Jev, by default) answers **closed questions** cheaply: a choice among fixed options, with a confidence score.
- **An extraction model** (Claude Opus 5.5, by default) does **open-ended extraction** with structured outputs: the stack, the openings, the salary, and the quotes behind each fact. It also answers every closed question where Jev's confidence is too low.

Both models are reached through **OpenRouter**, and which model plays each role is configuration, not code.

This design ports what career-hub learned in its extraction slices (S06c: ExtractionSchema v3, openings, quotes plus confidence, tag vocabularies, a golden set). It changes how the models are called (the API from the engine, not Claude Code batch files) and drops everything personal: the processor describes postings for any candidate.

## Goals

- Process every `pending` normalized job that has a LinkedIn job board source, end to end, without manual steps.
- Extract: position (role kind and a clean title), seniority and years required, arrangement, **openings** (who can apply and from where: region, country, city, time zone), contract type and engagement, salary, tech stack (main stack, must-haves, nice-to-haves), required languages, work authorization and sponsorship, and junk flags.
- Record for every fact its value, its confidence, what decided it (`ingest`, `jev`, `opus`), its supporting quote, and the model version.
- Store each run as a new row in `job_extractions`: the full result as validated JSON, plus the fields qualify filters on as typed, indexed columns.
- Keep every list of allowed values (tech tags, regions, countries, cities, role kinds, seniorities, arrangements, contract types, engagements, junk flags) in **its own table**, which can grow through `proposed` terms that a person approves.
- Make both model choices configurable and injected, called through OpenRouter.
- Measure extraction quality against a golden set before trusting confidence thresholds.

## Non-goals

- LinkedIn posts, and jobs whose only sources are Ashby or Greenhouse. They stay `pending` and are not touched. Their channels come in later versions.
- Splitting a posting into several positions (`job_positions`). A job board listing is one role. Posts will need it; v1 must not block adding it (see "Later").
- Qualify (matching facts against a workspace's preferences), and any verdict.
- Cross-channel fuzzy dedup and ATS cross-linking (Match).
- A web UI for approving vocabulary terms. v1 approves through a script.
- Fetching the company's own page or any other network source beyond the two model calls.

## Anti-goals

- **A fact stated with confidence that the posting does not support.** An empty or `unsure` fact is always better than a wrong `sure` one.
- **Copying LinkedIn's `location` field into who can apply.** A US-listed job can be "remote, worldwide" in its text; the text wins.
- **New filter values appearing without a person approving them.** Models may propose terms; they never create an approved one.
- **Any workspace's preferences reaching the extraction prompt.** The facts are universal.
- **Silent spend.** Every model call is logged with its cost, and spend has a ceiling.

## What the data and the providers show (checked 2026-11-01)

- `normalized_jobs` carries `processingStatus` (`pending` | `processing` | `processed` | `failed`, null for backfilled rows), `processingReason` (`new` | `reopened`), `processingRequestedAt`, `processingAttempts`, `processingError`, `processedAt`, and an index `normalized_jobs_processing_queue` on `(processingStatus, processingRequestedAt)`. A job's channels are reached through `normalized_job_sources` → `raw_items.channel`.
- LinkedIn job board rows already give `contractType`, `experienceLevel` and `location` as exact source facts. They become **ingest evidence**: shown to the models as context, compared with the extraction, never copied blindly.
- The contract already defines code-level enums used by profiles: `Position`, `Region`, `Arrangement`, `Seniority`, `Engagement`, `Technology`, `SkillDomain`. Qualify will compare profiles against extractions, so the new list tables **must use the same codes** for the same concepts.
- **Opus through OpenRouter:** `anthropic/claude-opus-5.5` is listed with `structured_outputs` and `response_format` support ($4 / $20 per million input / output tokens). `anthropic/claude-opus-5.5:batch` is listed at half price. Requests use `response_format: { type: "json_schema", json_schema: { strict: true, schema } }`, and `provider.require_parameters: true` keeps them off any route that would ignore the schema.
- **Jev through OpenRouter:** Jev is **not** served by `chat/completions`. It is served by OpenRouter's **Decisions API**, `POST https://openrouter.ai/api/alpha/decisions` (an alpha endpoint), with a body of `model`, a `state` array and a `questions` object. The current model is `typesafe/jev-1.14`; `~typesafe/jev-latest` is an alias that moves. Every response includes `usage.cost` in USD. Output tokens are free. Inputs over about 32,000 bytes of text go to a slower, less accurate long-context mode.
- **Jev's confidence** measures how concentrated its answer distribution is, not the probability the answer is right, and `noul` (yes/no) answers carry no `confidence` field. Thresholds therefore have to be set per question against labels, and per pinned model version.

## Design

### 1. Scope of v1

The processor takes a normalized job when all of these hold:

- `status = 'active'`, `kind = 'job'`, `closed = false`;
- at least one of its sources is a raw item with `channel = 'LINKEDIN_JOB_BOARD'` (a LinkedIn job merged with its Ashby or Greenhouse posting is in scope; ingest has already let the ATS text win);
- `processingStatus = 'pending'`.

A closed job that is pending is marked `processed` with no extraction and no model call. Every other job is invisible to the processor: it is neither claimed nor counted as stuck.

### 2. Trigger, claiming and the sweeper

The processor follows the ingest pattern: **the row is the truth, the queue is a nudge.**

- A new worker role `processor` (`WORKER_ROLE=processor`, included in `worker-all`) runs a BullMQ queue `process` with the code in `infrastructure/jobs/steps/process/` (the folder already exists, empty) and the domain code in `modules/processor/`.
- A repeatable sweep job (same `syncSweepScheduler` pattern as ingest) finds in-scope `pending` jobs ordered by `processingRequestedAt` and enqueues one job per normalized job ID, de-duplicated by job ID.
- **Claim:** `UPDATE … SET processingStatus = 'processing', processingAttempts = processingAttempts + 1 WHERE id = $1 AND processingStatus = 'pending' RETURNING processingRequestedAt`. No row back means someone else has it or it is no longer pending: drop the queue job.
- **Finish:** set `processed` (or `failed`) **only if `processingRequestedAt` still equals the claimed value**. If ingest set the job back to `pending` meanwhile (a reopen), the finish leaves `pending` alone; the extraction is still saved, and the next run may reuse it (section 6).
- **Stale claims:** a job in `processing` for longer than `PROCESSOR_CLAIM_TIMEOUT` (default 15 minutes) is returned to `pending` by the sweep.
- **Retries:** a transient failure (network, 429, 5xx) is retried by BullMQ with backoff. After `PROCESSOR_MAX_ATTEMPTS` (default 3) the job becomes `failed` with `processingError` set. Validation failures follow section 5.

### 3. Model roles and configuration

The processor depends on two interfaces, injected through NestJS:

```ts
interface DecisionModel {
  // Closed questions about one posting; one answer per question.
  decide(input: PostingInput, questions: DecisionQuestion[]): Promise<DecisionResult>;
}

interface ExtractionModel {
  // Structured extraction against a JSON schema; also answers fallback questions.
  extract(input: PostingInput, request: ExtractionRequest): Promise<ExtractionResult>;
}
```

Each result carries the model ID the provider reports, the provider request ID, tokens, cost in USD, and latency.

v1 adapters, both on OpenRouter:

- `OpenRouterDecisionModel` calls the Decisions API (`/api/alpha/decisions`).
- `OpenRouterExtractionModel` calls `/api/v1/chat/completions` with a strict `json_schema` response format and `require_parameters: true`, and marks the system prompt and schema with `cache_control` for prompt caching.

Configuration (validated at startup in `config/environment.validation.ts`):

| Variable                     | Default                           | Meaning                                                                                                                                                                                            |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`         | (required for the processor role) | One key for both roles; lives only in untracked `.env*` files.                                                                                                                                     |
| `PROCESSOR_DECISION_MODEL`   | `typesafe/jev-1.14`               | Pinned on purpose: thresholds are tuned per version. Never `~typesafe/jev-latest` in production.                                                                                                   |
| `PROCESSOR_EXTRACTION_MODEL` | `anthropic/claude-opus-5.5`       | Any OpenRouter model listed with `structured_outputs`.                                                                                                                                             |
| `PROCESSOR_CONCURRENCY`      | 4                                 | Jobs processed in parallel per worker.                                                                                                                                                             |
| `PROCESSOR_MAX_ATTEMPTS`     | 3                                 | Before a job becomes `failed`.                                                                                                                                                                     |
| `PROCESSOR_CLAIM_TIMEOUT`    | 15m                               | When a stuck `processing` job returns to `pending`.                                                                                                                                                |
| `PROCESSOR_DAILY_BUDGET_USD` | 20                                | A hard limit set in config; 20 is a placeholder until the eval measures cost per job. When the day's logged spend reaches it, the worker stops claiming until the next UTC day and logs a warning. |

Swapping a model is a config change. The startup check fails fast if the extraction model is not listed by OpenRouter with `structured_outputs`.

**CLAUDE.md** currently says "Claude is called through the Anthropic API from the engine." This change replaces it with: "LLMs are called from the engine through OpenRouter; which model plays each role is configuration. Claude does not orchestrate the engine."

### 4. Processing one job

```
claim → load job + LinkedIn evidence → reuse check ─(hit)→ link existing extraction → finish
                                           │(miss)
                                           ▼
                         Jev: closed questions (one Decisions API call)
                                           │
                     answers below threshold, or disagreeing with ingest evidence
                                           ▼
             Opus: open-ended extraction + those fallback questions (one call)
                                           │
               validate (Zod, list tables, quotes, consistency) → resolve terms
                                           │
              save job_extractions row + processing_attempts → point job at it → finish
```

**Input.** One `PostingInput` per job: title, company name, the description text (from `descriptionText`; the HTML is not sent), and the ingest evidence fields (`location`, `contractType`, `experienceLevel`, salary fields) labelled as "listing metadata, context only". Inputs are capped at 30,000 bytes of description so Jev stays out of its long-context mode. A longer description is cut at a paragraph boundary, and the cut is recorded in the extraction.

**Step 1: Jev answers the closed questions** in one Decisions API call. The v1 questions, each with options built from the **approved** rows of its list table:

| Question                          | Type                      | Options from     |
| --------------------------------- | ------------------------- | ---------------- |
| `arrangement` (overall)           | choice                    | `arrangements`   |
| `seniority`                       | choice                    | `seniorities`    |
| `roleKind`                        | choice                    | `role_kinds`     |
| `contractType`                    | choice                    | `contract_types` |
| `engagement`                      | choice                    | `engagements`    |
| `isSoftwareEngineeringRole`       | yes/no                    | —                |
| `junk` (one yes/no per junk flag) | yes/no                    | `junk_flags`     |
| `sponsorshipOffered`              | choice: yes, no, unstated | —                |

Every choice list includes an `unstated` option, and `role_kinds` also has `other`. Jev is never forced to pick a real value for a posting that says nothing, or to pick an engineering role for a support or marketing posting.

**What counts as contradicting the evidence.** The comparison uses a fixed mapping in `modules/processor/config/evidence.ts`, from each LinkedIn value to the set of codes it allows. A conflict means Jev's answer falls outside that set. Ambiguous LinkedIn values allow several codes.

| LinkedIn `experienceLevel` | Allowed `seniority` codes                     |
| -------------------------- | --------------------------------------------- |
| Internship, Entry level    | `junior`                                      |
| Associate                  | `junior`, `mid`                               |
| Mid-Senior level           | `mid`, `senior`, `staff`, `lead`, `principal` |
| Director, Executive        | `lead`, `principal`                           |

| LinkedIn `contractType` | Allowed `contract_types` codes |
| ----------------------- | ------------------------------ |
| Full-time               | `full_time`                    |
| Part-time               | `part_time`                    |
| Contract                | `contract`, `freelance`        |
| Temporary               | `temporary`, `contract`        |
| Internship              | `internship`                   |
| Volunteer               | `volunteer`                    |

`engagement` and `arrangement` are never compared with evidence: LinkedIn's `contractType` says nothing about employee versus contractor, and its `location` says nothing reliable about arrangement. An `unstated` answer from Jev is never a conflict. An unmapped LinkedIn value means no comparison, and the value is logged.

For yes/no answers, which carry no `confidence` field, the confidence used is `|p(yes) − 0.5| × 2`. _(Builder confirms the exact Decisions API field names in Task 1 and adjusts this formula if TypeSafe documents a better one.)_

**Step 2: decide what goes to Opus.** A closed question is a **fallback question** when either:

- Jev's confidence is below that question's threshold (section 8), or
- Jev's answer contradicts the ingest evidence (for example `contractType`: LinkedIn says Full-time, Jev says contract).

**Step 3: Opus extracts, in one call.** The schema covers every open-ended fact (section 5), plus one entry per fallback question with its options. Opus returns a value, a quote and a self-reported `sure` / `unsure` for each. The system prompt is the career-hub extraction prompt (`career-hub/src/extract/prompt.md` and `prompt-facts.md`) with the personal "Preferences" section removed and the batch-file instructions replaced by the API's input and output.

Opus runs on every job (the open-ended facts need it). Sending the fallback questions in the same call means one Opus call per job, never two.

**Step 4: resolve each closed fact.** If Jev was confident and agreed with the evidence, Jev's answer stands (`decidedBy: jev`). Otherwise Opus's answer stands (`decidedBy: opus`), and if Opus says `unsure` the fact is `unsure`. If the evidence is the only source (for instance the posting text says nothing about contract type, and LinkedIn says Full-time), the fact takes the evidence value with `decidedBy: ingest` and `confidence: unsure`.

### 5. The extraction document

`job_extractions.data` holds one JSON document, validated by a Zod schema in `modules/processor/schema/` versioned by `EXTRACTION_SCHEMA_VERSION` (starting at 1). Its shape is ported from career-hub's ExtractionSchema v3, made universal.

**Every fact** has the same envelope:

```ts
type Fact<T> = {
  value: T | null; // null = the posting does not establish it
  confidence: 'sure' | 'unsure';
  decidedBy: 'ingest' | 'jev' | 'opus';
  score: number | null; // Jev's confidence, when Jev decided or was asked
  quote: string; // verbatim words from the posting, "" when unstated
  model: string | null; // exact model ID, null for ingest
};
```

**Facts in v1:**

- `position`: `{ roleKind: code, title: string }`, where `title` is the cleaned title (no "(m/f/d)", no location suffix, no emoji).
- `isSoftwareEngineeringRole`: boolean.
- `seniority`: code. `yearsRequired`: number or null.
- `arrangement` (overall): code.
- `openings`: at least one, each `{ arrangements: code[], places: Place[], placeStrictness: 'limit' | 'label' | 'mention' | 'unstated', timezones: { fromUtc, toUtc, label }[], quote, confidence }`, where `Place` is `{ kind: 'worldwide' } | { kind: 'region', code } | { kind: 'country', code } | { kind: 'city', name, countryCode, cityId }`. Opus decides openings; their `decidedBy` is always `opus`. LinkedIn's `location` decides only when the posting says nothing about place or time zone (career-hub's rule), and then the opening is `decidedBy: ingest`, `unsure`.
- `contractType` and `engagement`: codes. `contractMonths`: number or null.
- `salary`: `{ min, max, currency, period }` or null. The posting text wins over the LinkedIn salary fields; disagreement is a conflict.
- `techStack`: `{ mainStack: Group[], mustHaves: (Group & { min: number })[], niceToHaves: Term[] }`, where a `Group` is `{ anyOf: Term[] }` and a `Term` is `{ text, code | null }`. `text` is the posting's wording; `code` is a `tech_tags` code or null.
- `requiredLanguages`: `{ lang (ISO 639-1), level: 'native' | 'fluent' | 'working', quote }[]`.
- `workAuthorization`: `{ requirements: { kind, place }[], sponsorship: 'yes' | 'no' | 'unstated' }`.
- `junkFlags`: codes, each with a quote.

Alongside the facts, the document holds:

- `conflicts`: `{ field, ingestValue, extractedValue }[]`, for every place the evidence disagrees with the extraction.
- `unmatched`: `{ list, text, at: path }[]`, for every term that did not resolve to an approved code (section 7).
- `truncated`: boolean.

**Validation** runs on the merged result before anything is saved:

1. **Zod schema.**
2. **List codes.** Every code exists and is `approved` in its table.
3. **Quotes.** Every non-empty quote, after collapsing whitespace and ignoring case, is a substring of the input. A quote that is not is cleared and its fact is downgraded to `unsure`. This is recorded in the attempt, but the extraction is not failed.
4. **Consistency.**
   - The overall `arrangement` must be one of the openings' arrangements, unless it is `unstated`. If not, both are downgraded to `unsure`.
   - `placeStrictness` is `unstated` exactly when `places` is empty.
   - `fromUtc ≤ toUtc`, both within −12 to +14.

If Opus's output fails the Zod check (rare with strict mode, but possible after the merge), the extraction call is retried **once** with the validation errors appended. A second failure fails the job with the errors in `processingError`.

`needsReview` is true when any fact qualify reads (arrangement, openings, seniority, roleKind, contractType, mainStack) is `unsure`, or when there is any conflict. Qualify later routes such jobs to an "unsure" lane rather than rejecting them.

### 6. Storage

**`job_extractions`** (new, append-only; one row per completed run):

| Column                             | Type                         | Notes                                                                                                                                              |
| ---------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | uuid v7                      |                                                                                                                                                    |
| `jobId`                            | uuid → `normalized_jobs`     |                                                                                                                                                    |
| `inputHash`                        | text                         | sha256 of the canonical `PostingInput` (description + title + company + evidence).                                                                 |
| `schemaVersion`                    | int                          | `EXTRACTION_SCHEMA_VERSION`.                                                                                                                       |
| `promptHash`                       | text                         | sha256 of the system prompt plus the Jev question set.                                                                                             |
| `decisionModel`, `extractionModel` | text                         | Configured model IDs (the reuse key); the reported IDs are kept in `data.models`.                                                                  |
| `data`                             | jsonb                        | The validated document (section 5).                                                                                                                |
| `needsReview`                      | bool                         |                                                                                                                                                    |
| `arrangement`                      | text → `arrangements.code`   | Typed copies for filtering.                                                                                                                        |
| `seniority`                        | text → `seniorities.code`    |                                                                                                                                                    |
| `roleKind`                         | text → `role_kinds.code`     |                                                                                                                                                    |
| `contractType`                     | text → `contract_types.code` |                                                                                                                                                    |
| `engagement`                       | text → `engagements.code`    |                                                                                                                                                    |
| `isSoftwareEngineeringRole`        | bool, nullable               |                                                                                                                                                    |
| `worldwide`                        | bool                         | Any opening is worldwide.                                                                                                                          |
| `regionCodes`                      | text[]                       | From all openings.                                                                                                                                 |
| `countryCodes`                     | text[]                       | From all openings, **plus** every member country of each region (via `region_countries`), so a filter on one country matches an "EMEA remote" job. |
| `cityIds`                          | uuid[]                       |                                                                                                                                                    |
| `techTags`                         | text[]                       | Every resolved code in mainStack, mustHaves and niceToHaves.                                                                                       |
| `mainStackTags`                    | text[]                       |                                                                                                                                                    |
| `salaryMin`, `salaryMax`           | int, nullable                |                                                                                                                                                    |
| `salaryCurrency`, `salaryPeriod`   | text, nullable               |                                                                                                                                                    |
| `costUsd`                          | numeric                      | Sum over the run's attempts.                                                                                                                       |
| `createdAt`                        | timestamptz                  |                                                                                                                                                    |

Indexes:

- `(jobId, createdAt desc)`
- `(inputHash, schemaVersion, promptHash, decisionModel, extractionModel)` for reuse
- GIN on `regionCodes`, `countryCodes`, `cityIds`, `techTags` and `mainStackTags`
- b-tree on `arrangement`, `seniority` and `roleKind`

A single-value typed column holding `unstated` or null means "not established".

**`normalized_jobs.currentExtractionId`** (new nullable FK) points at the extraction qualify should read.

`decisionModel` and `extractionModel` hold the **configured** model IDs, which are the ones known before any call. The IDs OpenRouter reports are kept in `data.models` and in `processing_attempts.model`.

**Reuse.** Before calling any model, the processor looks for an existing extraction with the same `(inputHash, schemaVersion, promptHash, decisionModel, extractionModel)`. On a hit, it points the job at it (or copies it as a new row for a different `jobId`) with no model call. This makes a reopened job with unchanged text free, and the same posting under two normalized jobs costs one extraction.

**`processing_attempts`** (new, append-only; one row per model call):

- `id`, `jobId`, `extractionId` (nullable until saved)
- `step`: `decision` | `extraction` | `extraction_retry`
- `model`, `providerRequestId`
- `inputTokens`, `outputTokens`, `cachedInputTokens`
- `costUsd`, from OpenRouter's reported cost
- `latencyMs`
- `outcome`: `ok` | `error` | `invalid`
- `error`, `quoteFailures` (int)
- `createdAt`

It feeds the daily budget and later the Phase 4 reports.

**Workspace scoping: a stated exception.** `job_extractions`, `processing_attempts` and the list tables are **shared across workspaces**. They describe public postings, collected through shared query builders, and they carry nothing about any person. This follows the raw-storage and ingest designs. Workspace scoping starts at qualify, which reads these facts against one workspace's preferences. The CLAUDE.md rule "every domain record is workspace-scoped" applies from qualify on.

### 7. List tables

Each list has **its own table**, all with the same base columns:

| Column                      | Notes                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| `code`                      | text, primary key; casing copies the matching contract enum (see Seeds)    |
| `label`                     | text                                                                       |
| `aliases`                   | text[]; lower-cased matching forms                                         |
| `status`                    | `approved` \| `proposed` (check constraint)                                |
| `occurrences`               | int; how often extraction met it (for proposed: how often it was proposed) |
| `firstSeenAt`, `approvedAt` | timestamptz                                                                |

The tables:

- **`tech_tags`**, plus `family` (nullable; such as `frontend-framework`), and `implies` (text[] of codes; `nextjs` implies `react`), from career-hub's `families` and `implies`.
- **`countries`**: ISO 3166-1 alpha-2 `code`. All seeded `approved`. The model never proposes a country; an unknown country code is a validation error.
- **`regions`**, plus **`region_countries`** `(regionCode, countryCode)`.
- **`cities`**: `id` uuid (cities are not unique by name), `name`, `countryCode` → `countries`, `geonamesId` (nullable), `aliases`, `status`, `occurrences`. Unique on `(lower(name), countryCode)`. Not pre-seeded: cities are created as the postings name them.
- **`role_kinds`**, **`seniorities`**, **`arrangements`**, **`contract_types`**, **`engagements`**, **`junk_flags`**: base columns only.

**Seeds** (in `database/seeds/`, idempotent):

- Codes **must match the existing contract enums** where the concept exists:
  - `arrangements` ← `Arrangement`
  - `seniorities` ← `Seniority`
  - `role_kinds` ← `Position`
  - `engagements` ← `Engagement`
  - `regions` ← `Region`
  - the `tech_tags` core ← `Technology`
- Career-hub's `tags.json` adds tags and aliases, translated to xjobs codes where they differ (career-hub `golang` → `go`, `c#` → `csharp`). Its `regions.json` provides `region_countries` and any regions xjobs lacks.
- `contract_types`: `full_time`, `part_time`, `contract`, `temporary`, `internship`, `freelance`, `volunteer`, `unstated`, matching LinkedIn's employment types.
- `junk_flags`: career-hub's `JUNK_FLAGS`.

Code rules:

- Codes are copied **exactly**, casing included, from the contract enums: upper-case regions (`EMEA`, `NORTH_AFRICA`) and lower-case seniorities. Countries are upper-case ISO 3166-1. Languages in `requiredLanguages` are lower-case ISO 639-1; qualify maps the profile `Language` enum (`EN`) by lower-casing it.
- Lists **may have more codes than the enums**. `role_kinds` adds `other`, `unstated` and the non-engineering kinds from career-hub's golden set (`support`, `qa_manual`, `devrel`, `ux_engineering`, `ai_training`, `seo_marketing_web`). `engagements` adds `unstated`. `regions` adds career-hub's regions that xjobs lacks (`DACH`, `GCC`), in upper-case. The enum codes are a subset of the table codes, so a profile code always exists in the table. The reverse doesn't hold, and qualify treats a code outside the profile's choices as no match.
- `GLOBAL` is **not** used as a place in openings. A worldwide opening is `{ kind: 'worldwide' }` and sets `worldwide = true`. `GLOBAL` stays in `regions` only for the profile enum's sake, and qualify treats a profile's `GLOBAL` as "accept `worldwide`".
- `isSoftwareEngineeringRole` is asked separately from `roleKind`. When Jev says `no` but the chosen `roleKind` is an engineering code, or the other way round, both are downgraded to `unsure`.

Migrating the profile enums onto these tables is out of scope.

**Resolving a term** (deterministic, after the model returns):

1. The model gave an approved code: keep it.
2. Otherwise, match the raw text, lower-cased and trimmed, against `code`, `label` and `aliases` of approved rows. A match gives the code.
3. Otherwise, the fact keeps its raw `text` with `code: null`, an entry goes into the document's `unmatched` list, and the term is **upserted as `proposed`** in its table: code = slug of the text, `occurrences + 1`. For cities, the city row is created `proposed` with the extracted name and country, and the place keeps `cityId` set to it.

A proposed term never appears in model options or in typed columns. Typed columns hold approved codes only, except `cityIds`, which may point at proposed cities (a city is a fact, not a filter value). This is my call; see the calls list.

**Approving terms (v1, script only):** `pnpm --filter @xjobs/xjobs db:vocab -- <list> list|approve <code>|alias <code> --to <approvedCode>|reject <code>`.

- `approve` makes the term available to future runs.
- `alias` adds the proposed text as an alias of an approved term and deletes the proposed row.
- Neither rewrites past extractions. The next run of an affected job, or a `db:reprocess`, picks the term up.

Approving or aliasing a term doesn't change the prompt hash: the hash covers the prompt template, not the option lists. Existing extractions are therefore still valid for reuse, and they don't see the new term until they're reprocessed. _(Builder: keep option lists out of the prompt hash, or every approval would invalidate every extraction.)_

### 8. Thresholds and the golden set

- `modules/processor/config/thresholds.ts` maps each closed question to a minimum Jev confidence, keyed by the pinned decision model ID. Starting value: 0.8 for every question, until the eval says otherwise. **An unknown decision model ID routes every closed question to Opus** and logs a warning. Changing the model without measuring it costs money, never accuracy.
- **Labels the golden set lacks.** Career-hub's golden values have no overall `arrangement`, `contractType` or `isSoftwareEngineeringRole`, and its `engagement` is an offered/excluded list. For these, Opus drafts a value for each of the 79 cases, written to a review file. The human accepts or corrects each one in a single pass, and only reviewed values enter the golden set. Thresholds for these questions stay at the 0.8 starting value until that review is done, and the processor is not switched on before it.
- Golden set: port career-hub's `src/extract/golden/` (79 LinkedIn job board postings with reviewed extractions) to `modules/processor/golden/`.
  - Each case is translated to the v1 document shape and the xjobs codes.
  - The 24 cases whose input starts with a `## Company page (Ashby|Greenhouse)` section were enriched by career-hub itself. They're rebuilt to the xjobs input: the company-page section is stripped and only the LinkedIn text is kept. Facts the stripped text no longer supports are set to `unstated` in the golden value. The eval measures what production actually receives.
  - The postings are public. Career-hub's **labels** (the owner's apply/skip verdicts) are personal and are **not** ported: the golden set measures facts, not verdicts.
- `pnpm --filter @xjobs/xjobs processor:eval [--model-decision …] [--model-extraction …]` runs the golden set through the live pipeline. It reports per fact:
  - accuracy;
  - the share decided by Jev versus Opus;
  - for each closed question, the accuracy of Jev's answers per confidence bucket, and the threshold that keeps Jev's accepted answers at 98% or better;
  - cost per job.

  It writes nothing to the database except `processing_attempts`, tagged as eval runs.

- Acceptance bar for v1 (measured on the golden set):
  - openings country/region accuracy ≥ 95%;
  - arrangement ≥ 97%;
  - mainStack tag recall ≥ 90%;
  - no `sure` fact contradicted by the golden value in more than 2% of cases.

### 9. Reprocessing and the backfill

`pnpm --filter @xjobs/xjobs db:reprocess -- [--all-in-scope] [--null-status] [--failed] [--job <id>]` sets the matching in-scope jobs to `pending`, with `processingReason = 'new'` and `processingRequestedAt = now()`, and resets their attempts and errors. The usual sweep then takes them, and reuse makes unchanged inputs free.

- **Backfill:** the jobs ingest's backfill left at a null `processingStatus` are **not** processed automatically. After the eval passes, the human runs `db:reprocess -- --null-status` once.
- **Version bumps:** after `EXTRACTION_SCHEMA_VERSION`, the prompt or a model changes, run `db:reprocess -- --all-in-scope`. The reuse key differs, so every job is re-extracted.

## Constraints

- TypeScript strict, Vitest, NestJS. The new tables go through the Prisma Next contract and a migration in `database/migrations/app/`, like ingest's.
- No personal data in prompts, seeds, fixtures or the golden set.
- `OPENROUTER_API_KEY` goes only in untracked `.env*`. Add it, without a value, to `.env.example`.
- The processor never writes `normalized_jobs` columns other than the processing columns and `currentExtractionId`.
- Every model call goes through the two interfaces. No module calls OpenRouter directly.

## Testing

- **Unit (no network)**, with fake `DecisionModel` and `ExtractionModel`:
  - fact resolution (Jev confident → `jev`; low score → `opus`; conflict with evidence → `opus` plus a conflict entry; evidence only → `ingest`/`unsure`);
  - the yes/no confidence formula;
  - quote check (exact, whitespace-collapsed, missing → downgraded);
  - consistency rules;
  - term resolution (code, alias, proposed upsert, city creation);
  - typed columns derived from a document, including region → country expansion;
  - truncation at 30,000 bytes;
  - the unknown-model threshold rule;
  - `needsReview`.
- **Adapters:** recorded OpenRouter responses (one Decisions API response, one chat completion with structured output, a 429, a schema-invalid output) replayed through each adapter. Field mapping, cost and token capture are checked.
- **PostgreSQL** (as in ingest's tests):
  - claim race (two workers, one claim);
  - finish skipped when `processingRequestedAt` moved;
  - stale claim returned by the sweep;
  - out-of-scope jobs never claimed;
  - closed job marked processed without a call;
  - reuse hit makes no model call;
  - a failed job after max attempts;
  - the budget stop;
  - `db:reprocess` flags;
  - seeds idempotent and matching the contract enums.
- **Golden eval:** run manually and on demand; not in CI (it costs money). Its result is pasted into the PR that turns the processor on.

## Plan order (for the plan, not binding)

1. **Spike: OpenRouter Decisions API.** Confirm the request and response field names for choice and yes/no questions, the probabilities, `confidence` and `usage.cost`, and record fixtures. Also confirm strict structured output on `anthropic/claude-opus-5.5` with a nested schema of this size. If the Decisions API can't return per-answer probabilities, stop and bring it back to the human before going on.
2. List tables, seeds, migration.
3. Extraction schema, validation, term resolution, typed-column derivation.
4. The two adapters and config.
5. Pipeline service.
6. Worker role, queue, sweeper, claim and finish.
7. `processing_attempts`, budget.
8. Golden set port and `processor:eval`.
9. `db:reprocess` and `db:vocab`.
10. CLAUDE.md and docs.

## Later (not in this change, but v1 must not block it)

- **LinkedIn posts:** a post can hire for several roles. That needs a `job_positions` child table between `normalized_jobs` and `job_extractions`. Keep `job_extractions.jobId` as the only link in v1, so a nullable `positionId` can be added later.
- Ashby and Greenhouse-only jobs: widen the scope query.
- OpenRouter's `:batch` variant for large reprocess runs.
- A web UI for vocabulary approval.
- Remapping past extractions when a term is approved, without a model call: recompute typed columns from `data.unmatched`.

## Decided by the user

- The processor uses Jev for closed questions and Opus 5.5 with structured outputs for open-ended extraction. When Jev's confidence is low, Opus answers with structured outputs.
- Both models run from day one. Both are configurable and injected, and both are called through OpenRouter.
- Processed data goes in `job_extractions`. Every fact records where it came from.
- The full result is stored as validated JSON, with the filter fields also in typed columns.
- Tech tags, regions and every other enum are tables that can grow. Each list has its own table, not one global vocabulary table.
- Location is a list of openings, each a place, an arrangement and a time zone, kept separate from LinkedIn's office location field.
- v1 focuses on LinkedIn job board jobs.
- Extractions, attempts and list tables are shared across workspaces, an explicit exception to the CLAUDE.md rule. Workspace scoping starts at qualify.
- The daily budget is a hard limit set in config.

## Calls made in this design (check these)

1. Through OpenRouter, Jev is called on the Decisions API (`/api/alpha/decisions`), not `chat/completions`, which doesn't serve it. The endpoint is alpha.
2. Jev is pinned to `typesafe/jev-1.14`, and an unknown model ID sends every question to Opus.
3. One Opus call per job: the open-ended extraction and the fallback questions share it.
4. Yes/no confidence = `|p(yes) − 0.5| × 2`, pending the spike.
5. In scope: any active, open job with a LinkedIn job board source, including ones merged with an ATS posting. Closed pending jobs are marked processed with no call.
6. (Now decided by the user; see above.)
7. List-table codes copy the contract enum codes exactly, and the lists may add codes the enums lack (`other`, `unstated`, non-engineering role kinds, `DACH`, `GCC`). `GLOBAL` is not a place; worldwide is. The profile enums are not migrated to tables.
8. Cities aren't pre-seeded. They're created `proposed` as postings name them, and `cityIds` may point at proposed cities.
9. Quotes that aren't in the input downgrade the fact to `unsure` instead of failing the job.
10. One schema-fix retry for Opus, then `failed`.
11. A 30,000-byte description cap, a $20 daily budget, concurrency 4, 3 attempts and a 15-minute claim timeout, all as defaults.
12. The backfill isn't automatic. The human runs `db:reprocess -- --null-status` after the eval passes.
13. The golden set ports career-hub's reviewed extractions but not its personal labels. The 24 company-page-enriched inputs are rebuilt as LinkedIn-only. The eval runs manually, not in CI.
14. An evidence conflict means Jev's answer falls outside a fixed mapping from each LinkedIn value to its allowed codes (section 4). `engagement` and `arrangement` are never compared with evidence.
15. The reuse key uses the configured model IDs. The reported IDs are stored next to them.
16. Facts beyond your list (required languages, work authorization and sponsorship, junk flags, years required) are included, because qualify needs them for eligibility. Career-hub found they decide many verdicts.
17. CLAUDE.md's "Anthropic API" line is replaced with an OpenRouter line.
18. Vocabulary approval is a script in v1 and doesn't rewrite past extractions.

## Left to the builder

- Library choices for slugs and hashing, and the canonical JSON for `inputHash`.
- Exact BullMQ settings, backoff, and sweep interval (follow ingest's).
- How the Zod schema becomes the strict JSON schema (`z.toJSONSchema`) and fits OpenRouter's strict-mode limits. Flatten unions if strict mode rejects them, then re-validate with the full Zod schema.
- Prompt wording beyond the port from career-hub, as long as the golden eval meets the bar.

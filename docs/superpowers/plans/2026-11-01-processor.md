# Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `processor` worker turns each pending, open LinkedIn job board normalized job into a validated, sourced `job_extractions` row: Jev answers closed questions, Opus 5.5 does the open-ended extraction and answers the low-confidence questions, all through OpenRouter.

**Architecture:**

- **`modules/processor/`** holds the domain:
  - pure functions for input, questions, fact resolution, validation, evidence conflicts, typed columns and term resolution;
  - two injected model interfaces with OpenRouter adapters;
  - one `ProcessJobService` that orchestrates a job;
  - one `ProcessorRepository` for every database read and write.
- **`infrastructure/jobs/steps/process/`** and **`infrastructure/worker/processor.service.ts`** wire it to BullMQ. They follow the ingest pattern: the row is the truth, the queue is a nudge, and a sweeper covers lost messages.

**Tech Stack:**

- NestJS 11, TypeScript strict (nodenext), zod 4 (`z.toJSONSchema`)
- Prisma Next contract (`contract.prisma` + `prisma migration plan`), ORM `tx.orm.public.<Model>`
- BullMQ, Vitest 5
- Native `fetch` against OpenRouter: no new HTTP dependency

**Spec:** `docs/superpowers/specs/2026-11-01-processor-design.md` (read it with this plan; section numbers below refer to it).

## Before starting

- This builds on the normalized jobs from `feat/pipeline-ingest`. Branch `feat/processor` from the tip of `feat/pipeline-ingest` (or from `main` once it's merged).
- Task 1 needs a real `OPENROUTER_API_KEY`. Claude can't read `.env*` files, so **the human runs the spike** with `! pnpm --filter @xjobs/xjobs processor:spike` and Claude reads the fixtures it writes.

## Global Constraints

- **No guessing.** A fact the posting does not establish is `value: null` (or `unstated`), with `confidence: 'unsure'` when anything is in doubt.
- **No personal data** in prompts, seeds, fixtures or the golden set. No workspace preference ever reaches a prompt.
- **Scope.** Process a job only when `status='active'`, `kind='job'`, `processingStatus='pending'`, and it has a source with `raw_items.channel='LINKEDIN_JOB_BOARD'`. A closed job is marked `processed` with no model call. Every other job is never claimed.
- **What the processor writes.** On `normalized_jobs` it writes only the processing columns (`processingStatus`, `processingAttempts`, `processingError`, `processedAt`, plus the new `processingStartedAt`) and `currentExtractionId`.
- **Sharing.** `job_extractions`, `processing_attempts` and every list table are shared across workspaces, an exception the user approved.
- **Model calls.** Every one goes through `DecisionModel` or `ExtractionModel`. Nothing else calls OpenRouter.
- **Defaults:**
  - `PROCESSOR_DECISION_MODEL=typesafe/jev-1.14`
  - `PROCESSOR_EXTRACTION_MODEL=anthropic/claude-opus-5.5`
  - `PROCESSOR_CONCURRENCY=4`
  - `PROCESSOR_MAX_ATTEMPTS=3`
  - `PROCESSOR_CLAIM_TIMEOUT_MS=900000`
  - `PROCESSOR_DAILY_BUDGET_USD=20` (a hard limit, set in config)
- **Constants:**
  - description cap 30,000 bytes, cut at a paragraph boundary;
  - starting Jev threshold 0.8;
  - yes/no score `|p(yes) − 0.5| × 2`;
  - one schema-fix retry for Opus.
- **List-table codes** copy the contract enums exactly, casing included (`EMEA`, `senior`, `backend_engineer`). The lists may add codes the enums lack. Countries are upper-case ISO alpha-2. `GLOBAL` is never a place.
- **Reuse key:** `(inputHash, schemaVersion, promptHash, decisionModel, extractionModel)`, using the **configured** model IDs. The option lists are **not** part of `promptHash`.
- **Commands:**
  - Unit tests: `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor`.
  - Postgres tests need `PROCESSOR_TEST_DATABASE_URL`: a disposable `processor_test` database migrated to the current contract, set up like `INGEST_TEST_DATABASE_URL` in `modules/ingest/README.md`.

## Review Focus

1. **A listing with a null `descriptionText`** (title only) must process to a valid extraction with mostly `unstated` facts, not throw. Test in Task 9.
2. **Jev returns an option that was never offered**, or omits a question. That answer is treated as score 0 and goes to Opus, never stored. Test in Task 6.
3. **A quote that differs from the input only in typography** (NBSP, curly quotes, `–` vs `-`, line breaks) must pass the quote check. Test in Task 5.
4. **A job merged or closed between the sweep and the claim** must not be claimed. Test in Task 8.
5. **OpenRouter answers with an error body, empty `choices`, or `finish_reason: 'length'`.**
   - The first two are a transient error.
   - `length` is an output error that takes the one schema-fix retry.

   Test in Task 6.

---

### Task 1: Spike: OpenRouter Decisions API and Opus structured output

**Files:**

- Create: `apps/xjobs/src/scripts/processor-spike.ts`
- Create (written by the script): `apps/xjobs/src/modules/processor/models/fixtures/decision-ok.json`, `extraction-ok.json`
- Create: `apps/xjobs/src/modules/processor/models/SPIKE.md`
- Modify: `apps/xjobs/package.json` (`"processor:spike": "tsx --tsconfig tsconfig.app.json src/scripts/processor-spike.ts"`)

**Interfaces:**

- Produces: the two fixture files (response bodies only, no headers, no key) that Task 6 replays, and `SPIKE.md`, which records:
  - the exact Decisions API request and response field names for a `choice` and a `noul` question;
  - where per-option probabilities, `confidence` and `usage.cost` live;
  - whether `anthropic/claude-opus-5.5` accepted a strict nested schema with a discriminated union.

- [ ] **Step 1: Write the script.** It reads `OPENROUTER_API_KEY` from `process.env` and sends one call of each kind.
  - **Decisions API:** `POST https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.14`, `state` = a short sample posting. It asks one choice question (`seniority`, options `junior, mid, senior, unstated`) and one yes/no question (`isSoftwareEngineeringRole`).
  - **Chat completions:** `POST https://openrouter.ai/api/v1/chat/completions`, model `anthropic/claude-opus-5.5`, `response_format: { type: 'json_schema', json_schema: { name: 'probe', strict: true, schema } }`, `provider: { require_parameters: true }`. The schema has one nested array of a discriminated union (`{kind:'country',code}` | `{kind:'worldwide'}`).
  - Both bodies are written pretty-printed to the fixture paths.
- [ ] **Step 2: The human runs** `! pnpm --filter @xjobs/xjobs processor:spike`. Expected: two fixture files, exit 0.
- [ ] **Step 3: Write `SPIKE.md`** from the fixtures. **Gate:** if the Decisions response has neither per-option probabilities nor a `confidence` for choice answers, **stop and report to the human** before Task 6. The fallback design depends on it. If strict mode rejected the union, note it: Task 4 then flattens unions to `{ kind, code: string|null, name: string|null }` and re-validates with the full Zod schema.
- [ ] **Step 4: Commit** `chore(processor): OpenRouter spike fixtures and findings`

### Task 2: Contract and migration for the processor tables

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma`
- Generated: `contract.json`, `contract.d.ts`, `migrations/app/<timestamp>_processor/`
- Modify: `apps/xjobs/src/database/models.ts` (export the new row types, as done for ingest)

**Interfaces:**

- Produces these models, with the spec §6 and §7 columns:
  - **List models**, all sharing `code String @id`, `label String`, `aliases String[]`, `status String` (check `IN ('approved','proposed')`), `occurrences Int @default(0)`, `firstSeenAt TimestamptzJsDate(3)`, `approvedAt TimestamptzJsDate(3)?`:
    - `TechTag` → `tech_tags`, plus `family String?` and `implies String[]`;
    - `Region` → `regions`;
    - `Country` → `countries`;
    - `RoleKind` → `role_kinds`;
    - `Seniority` → `seniorities`;
    - `Arrangement` → `arrangements`;
    - `ContractType` → `contract_types`;
    - `Engagement` → `engagements`;
    - `JunkFlag` → `junk_flags`.

    Name the models `*Term` (for example `SeniorityTerm`) where a contract enum already uses the name.

  - **`RegionCountry`** → `region_countries`: `regionCode`, `countryCode` (FKs), `@@id([regionCode, countryCode])`.
  - **`City`** → `cities`: `id Uuid @id @onCreate(uuid(7))`, `name`, `countryCode` (FK → `countries`), `geonamesId Int?`, `aliases String[]`, `status`, `occurrences`, `firstSeenAt`, `approvedAt?`, plus a unique index on `(lower(name), countryCode)`.
    - _If the contract can't express a functional index, store a `nameKey String` = `name.toLowerCase()` and make `@@unique([nameKey, countryCode])`._
  - **`JobExtraction`** → `job_extractions`: every column in the spec §6 table.
    - Single-value typed columns are FKs to their list tables.
    - Indexes: `(jobId, createdAt)`, the reuse key, and b-tree on `arrangement`, `seniority`, `roleKind`.
    - GIN on `regionCodes`, `countryCodes`, `cityIds`, `techTags`, `mainStackTags`. _If the contract can't declare GIN, add them in the generated migration's SQL ops; check `db:verify` still passes._
  - **`ProcessingAttempt`** → `processing_attempts`:
    - `id`, `jobId Uuid?` (null for eval rows), `extractionId Uuid?`, `eval Boolean @default(false)`;
    - `step` (check `IN ('decision','extraction','extraction_retry')`);
    - `model`, `providerRequestId String?`, `inputTokens`, `outputTokens`, `cachedInputTokens Int`, `costUsd Decimal`, `latencyMs Int`;
    - `outcome` (check `IN ('ok','error','invalid')`), `error String?`, `quoteFailures Int @default(0)`, `createdAt`;
    - index `(createdAt)` where not eval.
  - **`NormalizedJob`**: add `currentExtractionId Uuid?` (FK → `job_extractions`, `SetNull`) and `processingStartedAt TimestamptzJsDate(3)?`.

- [ ] **Step 1: Edit `contract.prisma`**, following the existing style: check names `<table>_<column>` and a one-line comment per model.
- [ ] **Step 2: Run** `cd apps/xjobs && pnpm db:format && pnpm db:migration:plan --name processor`. Expected: a new migration folder that creates the new tables and only adds two columns to `normalized_jobs`.
- [ ] **Step 3: Run** `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 4: The human applies** the migration to the dev database and to `processor_test` (`pnpm db:migrate`). Then run `pnpm db:verify`. Expected: OK.
- [ ] **Step 5: Commit** `feat(processor): contract for extractions, attempts and list tables`

### Task 3: List seeds

**Files:**

- Create: `apps/xjobs/src/modules/processor/vocab/lists.ts`
- Create: `apps/xjobs/src/modules/processor/vocab/seed-data.ts`
- Create: `apps/xjobs/src/database/seeds/processor-lists.seed.ts`
- Modify: `apps/xjobs/src/database/seeds/index.ts` (append `processorListsSeed` after `usersSeed`)
- Test: `apps/xjobs/src/modules/processor/vocab/seed-data.spec.ts`

**Interfaces:**

- Produces (`lists.ts`):
  - `export const LIST_NAMES = ['techTags','regions','countries','roleKinds','seniorities','arrangements','contractTypes','engagements','junkFlags'] as const;`
  - `export type ListName = (typeof LIST_NAMES)[number];`
- Produces (`seed-data.ts`):
  - `export interface SeedTerm { code: string; label: string; aliases: string[] }`
  - `export const SEED: Record<ListName, SeedTerm[]>`
  - `export const SEED_REGION_COUNTRIES: [region: string, country: string][]`
  - `export const SEED_TECH_EXTRAS: Record<string, { family: string | null; implies: string[] }>`
- **Content**, generated once from career-hub with a throwaway script (not committed) and then committed as TypeScript data:
  - `arrangements` ← `Arrangement`; `seniorities` ← `Seniority`.
  - `role_kinds` ← `Position`, plus `other`, `unstated`, `support`, `qa_manual`, `devrel`, `ux_engineering`, `ai_training`, `seo_marketing_web`.
  - `engagements` ← `Engagement`, plus `unstated`.
  - `regions` ← `Region`, plus career-hub's `EEA`, `DACH`, `GCC`, `AFRICA`, `ASIA_EX_GCC`, `AMERICAS` (kebab → upper snake; `worldwide` dropped).
  - `countries` ← career-hub `regions.json` `countries`; it must cover all 249 ISO 3166-1 alpha-2 codes.
  - `region_countries` ← career-hub's region members.
  - `tech_tags` ← `Technology`, plus career-hub `tags.json`. Translate career-hub codes to xjobs codes where they collide (`golang`→`go`, `c#`→`csharp`, `c++`→`cpp`, `react-native`→`react_native`); otherwise snake_case them, and keep all aliases. `families`/`implies` go into `SEED_TECH_EXTRAS`.
  - `contract_types`: `full_time, part_time, contract, temporary, internship, freelance, volunteer, unstated`.
  - `junk_flags` ← career-hub `JUNK_FLAGS` (from `career-hub/src/config/schemas/vocab.ts`), snake_cased.
- Produces (`processor-lists.seed.ts`): `processorListsSeed: Seed` (name `processor-lists`). It upserts every term as `approved`. It never changes an existing row's `status`, and only adds missing aliases.

- [ ] **Step 1: Write failing tests** in `seed-data.spec.ts`:
  - `every contract enum code is a seed code`: for each pair (`Arrangement`/`arrangements`, `Seniority`/`seniorities`, `Position`/`roleKinds`, `Engagement`/`engagements`, `Region`/`regions`, `Technology`/`techTags`), every `Object.values(Enum)` is in `SEED[list].map(t => t.code)`.
  - `role kinds and engagements have unstated; role kinds have other`.
  - `countries are 249 upper-case alpha-2 codes`.
  - `region_countries reference seeded regions and countries`.
  - `no duplicate codes or aliases within a list`: aliases are lower-case, and none equals another term's code.
  - `GLOBAL has no region_countries rows`.
- [ ] **Step 2: Run** the unit test command with `vocab`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `lists.ts`, `seed-data.ts` and the seed.
- [ ] **Step 4: Run** it again. Expected: PASS. Then the human runs `pnpm --filter @xjobs/xjobs db:seed --only processor-lists` twice; the second run makes no changes.
- [ ] **Step 5: Commit** `feat(processor): seed list tables`

### Task 4: Extraction document schema, model output schema, typed columns

**Files:**

- Create: `apps/xjobs/src/modules/processor/schema/fact.ts`, `schema/extraction.ts`, `schema/model-output.ts`, `schema/index.ts`
- Create: `apps/xjobs/src/modules/processor/pipeline/typed-columns.ts`
- Test: `schema/extraction.spec.ts`, `pipeline/typed-columns.spec.ts`

**Interfaces:**

- Produces (`fact.ts`):
  - `export type DecidedBy = 'ingest' | 'jev' | 'opus'`
  - `export type Confidence = 'sure' | 'unsure'`
  - `export const factSchema = <T extends z.ZodType>(value: T) => z.strictObject({ value: value.nullable(), confidence, decidedBy, score: z.number().min(0).max(1).nullable(), quote: z.string(), model: z.string().nullable() })`
  - `export type Fact<T>`
- Produces (`extraction.ts`):
  - `export const EXTRACTION_SCHEMA_VERSION = 1`
  - `export const extractionDocumentSchema`, `export type ExtractionDocument`. Fields exactly as spec §5:
    - facts: `position`, `isSoftwareEngineeringRole`, `seniority`, `yearsRequired`, `arrangement`, `openings`, `contractType`, `engagement`, `contractMonths`, `salary`, `techStack`, `requiredLanguages`, `workAuthorization`, `junkFlags`;
    - plus `conflicts`, `unmatched`, `truncated`, and `models: { decision: string | null; extraction: string }`.
  - Also export `Place`, `Opening`, `Term = { text: string; code: string | null }` and `UnmatchedTerm = { list: ListName | 'cities'; text: string; at: string }`.
- Produces (`model-output.ts`):
  - `export function modelOutputSchema(options: ListOptions, fallback: DecisionQuestion[]): z.ZodType<ModelOutput>`. This is the shape Opus returns: each fact as `{ value, quote, confidence }`, and `fallback: Record<questionKey, { value, quote, confidence }>`. Choice values are `z.enum(options[list])`.
  - `export function modelOutputJsonSchema(...same): object` = `z.toJSONSchema(...)`, flattened per `SPIKE.md` if needed.
  - `export type ListOptions = Record<ListName, string[]>` (approved codes only).
- Produces (`typed-columns.ts`):
  - `export interface TypedColumns { arrangement; seniority; roleKind; contractType; engagement: string | null; isSoftwareEngineeringRole: boolean | null; worldwide: boolean; regionCodes: string[]; countryCodes: string[]; cityIds: string[]; techTags: string[]; mainStackTags: string[]; salaryMin; salaryMax: number | null; salaryCurrency; salaryPeriod: string | null }`
  - `export function deriveTypedColumns(doc: ExtractionDocument, regionCountries: ReadonlyMap<string, readonly string[]>): TypedColumns`
  - Arrays are de-duplicated and sorted. A null-coded `Term` is skipped.

- [ ] **Step 1: Write failing tests:**
  - **`extraction.spec.ts`:**
    - a full valid fixture document parses;
    - `placeStrictness: 'unstated'` with a non-empty `places` fails;
    - `fromUtc: 15` fails;
    - an `opening` with an empty `arrangements` fails;
    - `modelOutputSchema` rejects a seniority not in `options.seniorities`;
    - `modelOutputJsonSchema` returns an object with `additionalProperties: false` at the root.
  - **`typed-columns.spec.ts`:**
    - an opening `{ kind:'region', code:'EMEA' }`, with `regionCountries` `EMEA → ['MA','FR']`, gives `regionCodes ['EMEA']` and `countryCodes ['FR','MA']`;
    - a worldwide opening gives `worldwide: true`;
    - `techTags` is the union of the mainStack, mustHaves and niceToHaves codes, while `mainStackTags` is only mainStack;
    - a fact with `value: null` gives a null column.
- [ ] **Step 2: Run** with `schema pipeline/typed-columns`. Expected: FAIL.
- [ ] **Step 3: Implement.** Port the shapes from `career-hub/src/extract/schema.ts`, with the envelope from spec §5.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): extraction document schema and typed columns`

### Task 5: Fact resolution, evidence conflicts, validation, term resolution

**Files:**

- Create: `apps/xjobs/src/modules/processor/config/evidence.ts`, `config/thresholds.ts`
- Create: `apps/xjobs/src/modules/processor/pipeline/evidence.ts`, `pipeline/resolve-facts.ts`, `pipeline/validate.ts`
- Create: `apps/xjobs/src/modules/processor/vocab/resolve.ts`
- Test: `pipeline/evidence.spec.ts`, `pipeline/resolve-facts.spec.ts`, `pipeline/validate.spec.ts`, `vocab/resolve.spec.ts`

**Interfaces:**

- Consumes: `ExtractionDocument`, `ModelOutput`, `ListOptions` (Task 4); `DecisionAnswer`, `PostingInput`, `Evidence` (declared in Task 6's `models/types.ts`; **create that file in this task** with `ClosedQuestionKey`, `DecisionQuestion`, `DecisionAnswer`, `Evidence`, `PostingInput` (as listed in Task 6) and `JobForProcessing` (as listed in Task 8); Task 6 adds the rest).
- Produces (`config/evidence.ts`): `EXPERIENCE_LEVEL_SENIORITY: Record<string, string[]>` and `LINKEDIN_CONTRACT_TYPES: Record<string, string[]>`, exactly the two tables in spec §4.
- Produces (`config/thresholds.ts`):
  - `export const THRESHOLDS: Record<string, Partial<Record<ClosedQuestionKey | 'junk', number>>> = { 'typesafe/jev-1.14': { arrangement: 0.8, seniority: 0.8, roleKind: 0.8, contractType: 0.8, engagement: 0.8, isSoftwareEngineeringRole: 0.8, sponsorshipOffered: 0.8, junk: 0.8 } }`
  - `export function thresholdFor(model: string, key: ClosedQuestionKey): number | null`. It returns null for an unknown model or key, meaning "always fall back".
- Produces (`pipeline/evidence.ts`): `contradictsEvidence(key: ClosedQuestionKey, value: unknown, evidence: Evidence): boolean`.
  - It only compares `seniority` (via `experienceLevel`) and `contractType` (via `contractType`).
  - `unstated` is never a contradiction, and neither is an unmapped LinkedIn value; an unmapped value is logged once with `Logger.warn`.
- Produces (`pipeline/resolve-facts.ts`):
  - `export function selectFallback(answers: DecisionAnswer[], questions: DecisionQuestion[], evidence: Evidence, decisionModel: string): DecisionQuestion[]`
  - `export function resolveFacts(args: { output: ModelOutput; answers: DecisionAnswer[]; fallback: DecisionQuestion[]; input: PostingInput; models: { decision: string; extraction: string } }): ExtractionDocument`. It applies spec §4 Step 4 and fills `conflicts`.
- Produces (`pipeline/validate.ts`):
  - `export function normalizeForQuote(s: string): string`: NFKC, curly quotes → straight, dashes → `-`, every whitespace run (including NBSP) → one space, lower-case.
  - `export function checkQuotes(doc, input): { doc: ExtractionDocument; quoteFailures: number }`
  - `export function checkConsistency(doc): ExtractionDocument`, covering the arrangement-vs-openings rule and the `isSoftwareEngineeringRole`-vs-`roleKind` rule. An engineering code is any `Position` value.
  - `export function needsReview(doc): boolean`
- Produces (`vocab/resolve.ts`):
  - `export interface VocabSnapshot { approved: Record<ListName, Map<string, string>> }`, mapping lower-case code, label and each alias to the code.
  - `export function resolveTerms(doc: ExtractionDocument, vocab: VocabSnapshot): { doc: ExtractionDocument; proposals: { list: ListName; text: string }[]; cities: { name: string; countryCode: string }[] }`. It applies spec §7 steps 1–3. A choice code not in the snapshot is a validation error (`throw new ExtractionInvalidError(path)`). Unknown tech terms become `code: null` plus a proposal.
  - `export function slugCode(text: string): string`.

- [ ] **Step 1: Write failing tests:**
  - **`evidence.spec.ts`:**
    - `'Mid-Senior level'` + `senior` → false; `'Mid-Senior level'` + `junior` → true;
    - `'Full-time'` + `contract` → true; `'Contract'` + `freelance` → false;
    - `engagement` + anything → false; `unstated` → false; `'Unknown level'` → false.
  - **`resolve-facts.spec.ts`:**
    - `seniority` with score 0.9 that agrees with the evidence → `decidedBy: 'jev'`, `sure`, `score: 0.9`;
    - score 0.5 → in `selectFallback`, and with Opus `{value:'senior', confidence:'unsure'}` → `decidedBy:'opus'`, `unsure`;
    - a score-0.95 `contractType: contract` against `'Full-time'` → in fallback, plus one `conflicts` entry `{ field:'contractType', ingestValue:'Full-time', extractedValue:… }`;
    - an unknown decision model → every question in fallback;
    - Opus `contractType: unstated` with evidence `'Full-time'` → `full_time`, `decidedBy:'ingest'`, `unsure`, `model: null`.
  - **`validate.spec.ts`:**
    - a quote in the input passes;
    - `"5+ years"` against input `"5+ years"` passes;
    - `“TypeScript”` against `"TypeScript"` passes;
    - a quote not in the input → cleared, `unsure`, `quoteFailures: 1`;
    - arrangement `remote` with openings only `hybrid` → both `unsure`;
    - `isSoftwareEngineeringRole: false` with `roleKind: 'backend_engineer'` → both `unsure`;
    - `needsReview` is true for an `unsure` seniority and for a non-empty `conflicts`, and false otherwise.
  - **`resolve.spec.ts`:**
    - `{text:'Postgres', code:null}` with alias `postgres → postgresql` → `code:'postgresql'`;
    - `{text:'Bun', code:null}` → `code:null`, an `unmatched` entry and a proposal `{list:'techTags', text:'Bun'}`;
    - a city `{name:'Paris', countryCode:'FR'}` → in `cities`;
    - `seniority: 'guru'` → throws `ExtractionInvalidError`;
    - `slugCode('Node.js')` === `'node_js'`.
- [ ] **Step 2: Run** with `pipeline vocab`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): fact resolution, evidence, validation and term resolution`

### Task 6: Model interfaces, config, OpenRouter adapters

**Files:**

- Modify: `apps/xjobs/src/modules/processor/models/types.ts`
- Create: `apps/xjobs/src/modules/processor/models/errors.ts`, `models/openrouter.client.ts`, `models/openrouter-decision.model.ts`, `models/openrouter-extraction.model.ts`
- Create (hand-written from the spike's real shapes): `models/fixtures/decision-bad-option.json`, `extraction-length.json`, `extraction-empty.json`, `error-429.json`
- Create: `apps/xjobs/src/modules/processor/config/processor.config.ts`
- Modify: `apps/xjobs/src/config/environment.validation.ts`
- Modify: `.env.example` (add `OPENROUTER_API_KEY=`, unset, and the `PROCESSOR_*` defaults commented)
- Test: `models/openrouter-decision.model.spec.ts`, `models/openrouter-extraction.model.spec.ts`, `apps/xjobs/src/config/validation.spec.ts` (extend)

**Interfaces:**

- Produces (`types.ts`):

  ```ts
  export type ClosedQuestionKey = 'arrangement' | 'seniority' | 'roleKind' | 'contractType' | 'engagement' | 'isSoftwareEngineeringRole' | 'sponsorshipOffered' | `junk:${string}`;
  export type DecisionQuestion = { key: ClosedQuestionKey; kind: 'choice'; options: string[]; instructions: string } | { key: ClosedQuestionKey; kind: 'yesno'; instructions: string };
  export interface DecisionAnswer {
    key: ClosedQuestionKey;
    value: string | boolean | null;
    score: number;
  }
  export interface ModelCallMeta {
    model: string;
    providerRequestId: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    costUsd: number;
    latencyMs: number;
  }
  export interface Evidence {
    location: string | null;
    contractType: string | null;
    experienceLevel: string | null;
    salary: { text: string | null; min: number | null; max: number | null; currency: string | null; period: string | null } | null;
  }
  export interface PostingInput {
    jobId: string;
    title: string | null;
    companyName: string | null;
    description: string;
    truncated: boolean;
    evidence: Evidence;
  }
  export abstract class DecisionModel {
    abstract decide(input: PostingInput, questions: DecisionQuestion[]): Promise<{ answers: DecisionAnswer[]; meta: ModelCallMeta }>;
  }
  export abstract class ExtractionModel {
    abstract extract(input: PostingInput, req: { systemPrompt: string; jsonSchema: object; retryErrors?: string[] }): Promise<{ output: unknown; meta: ModelCallMeta }>;
  }
  ```

- Produces (`errors.ts`):
  - `TransientModelError`: network, 408, 429, 5xx, an error body with a 200, empty `choices`.
  - `ModelRequestError`: other 4xx; not retried.
  - `ModelOutputError`: unparseable JSON or `finish_reason: 'length'`; goes to the schema-fix retry.
  - `ExtractionInvalidError(path: string)`: thrown by validation.
  - Each carries a `meta?: Partial<ModelCallMeta>`, so a failed call is still logged with its cost.
- Produces (`processor.config.ts`): `export interface ProcessorConfig { decisionModel; extractionModel: string; concurrency; maxAttempts; claimTimeoutMs; dailyBudgetUsd: number }` and the `PROCESSOR_CONFIG` injection token.
- **Env:**
  - `workerProcessEnvironmentSchema` gains `OPENROUTER_API_KEY` (optional) and the `PROCESSOR_*` variables with the Global Constraints defaults.
  - `WORKER_ROLE` becomes `z.enum(['ingest','processor','all'])`.
  - The refinement requires `OPENROUTER_API_KEY` when `WORKER_ROLE` is `processor` or `all`.
- **Startup check:** `assertStructuredOutputs(model: string): Promise<void>` in `openrouter.client.ts` calls `GET https://openrouter.ai/api/v1/models`. It throws when the model is missing or its `supported_parameters` lacks `structured_outputs`. `ProcessorWorkerService.start` (Task 10) calls it before consuming. Test: a stubbed list without `structured_outputs` makes it throw.
- **Adapter behaviour:**
  - Decision: an answer whose value is not in the question's `options`, or a missing answer, becomes `{ value: null, score: 0 }`. Yes/no score = `|p(yes) − 0.5| × 2`, using the probability field `SPIKE.md` names.
  - Extraction: sends `cache_control: { type: 'ephemeral' }` on the system message, `temperature: 0`, and `retryErrors` appended as a final user message.

- [ ] **Step 1: Write failing tests:**
  - **Decision spec:**
    - `decision-ok.json` → the answers and a `meta.costUsd` equal to the fixture's `usage.cost`;
    - `decision-bad-option.json` → that answer is `{value:null, score:0}`;
    - `error-429.json` with status 429 → `TransientModelError`.

    Mock `fetch` with `vi.stubGlobal`. The request body sent to `/api/alpha/decisions` has `model: 'typesafe/jev-1.14'`.

  - **Extraction spec:**
    - `extraction-ok.json` → `output` is the parsed JSON and `meta.model` is the reported ID;
    - the request has `response_format.json_schema.strict === true` and `provider.require_parameters === true`;
    - `extraction-length.json` → `ModelOutputError`;
    - `extraction-empty.json` → `TransientModelError`;
    - a 400 → `ModelRequestError`.
  - **Validation spec:**
    - `WORKER_ROLE=processor` without `OPENROUTER_API_KEY` → an error at path `OPENROUTER_API_KEY`;
    - with the key → the defaults parse to the Global Constraints values.

- [ ] **Step 2: Run** with `models` and `src/config`. Expected: FAIL.
- [ ] **Step 3: Implement.** `openrouter.client.ts` has one `postJson(path, body, signal)` that maps statuses to the error classes and measures latency. Timeout: 120 s per call (`AbortSignal.timeout`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): model interfaces and OpenRouter adapters`

### Task 7: Input, questions and prompt

**Files:**

- Create: `apps/xjobs/src/modules/processor/pipeline/input.ts`, `pipeline/questions.ts`
- Create: `apps/xjobs/src/modules/processor/prompts/system.md`, `prompts/prompt.ts`
- Test: `pipeline/input.spec.ts`, `pipeline/questions.spec.ts`, `prompts/prompt.spec.ts`

**Interfaces:**

- Produces (`input.ts`):
  - `export const DESCRIPTION_CAP_BYTES = 30_000`
  - `export function buildPostingInput(job: JobForProcessing): PostingInput`. A null description becomes `''`. The description is cut at the last `\n\n` before the cap (or hard-cut at the cap if none), and `truncated` is set.
  - `export function inputHash(input: PostingInput): string`: sha256 of canonical JSON, keys sorted, `jobId` excluded.
- Produces (`questions.ts`): `export function buildDecisionQuestions(options: ListOptions): DecisionQuestion[]`. It returns the spec §4 table in that order, with one `junk:<code>` yes/no per junk flag. `sponsorshipOffered` options are `['yes','no','unstated']`.
- Produces (`prompt.ts`):
  - `export function systemPrompt(): string` (reads `system.md` once)
  - `export function promptHash(questions: DecisionQuestion[]): string`: sha256 over `system.md` plus the question keys, kinds and instructions. **Options are excluded.**
- `system.md`: a port of `career-hub/src/extract/prompt.md` and `prompt-facts.md`.
  - Remove the "Preferences" section, the batch-file input/output instructions, and the `## Company page` / `## LinkedIn post` paragraphs.
  - Describe the input as one posting, with "listing metadata" as context only.
  - Keep career-hub's rules for openings, place strictness, quotes and `unsure`.

- [ ] **Step 1: Write failing tests:**
  - **`input.spec.ts`:**
    - a null description → `''`, `truncated: false`;
    - a 40,000-byte description with paragraphs → at most 30,000 bytes, ends at a paragraph boundary, `truncated: true`;
    - `inputHash` is equal for two jobs that differ only in `jobId`, and different when `evidence.contractType` differs.
  - **`questions.spec.ts`:** keys in spec order; `seniority` options equal `options.seniorities`; one `junk:` question per junk flag.
  - **`prompt.spec.ts`:**
    - `promptHash` is unchanged when `seniorities` options gain a code, and changes when an instruction changes;
    - `systemPrompt()` contains no `Preferences` heading and none of `Morocco`, `criteria.json`, `{{`.
- [ ] **Step 2: Run** with `pipeline/input pipeline/questions prompts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): posting input, decision questions and system prompt`

### Task 8: Processor repository

**Files:**

- Create: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts`, `repositories/vocab.repository.ts`
- Test: `apps/xjobs/src/modules/processor/repositories/processor.postgres.spec.ts` (every Postgres test of the module lives here, so they never run in parallel)
- Modify: `apps/xjobs/src/modules/processor/README.md` (create it: tables, statuses, how to set up `processor_test`)

**Interfaces:**

- Produces (`processor.repository.ts`):

  ```ts
  export interface Claim {
    jobId: string;
    requestedAt: Date;
    attempts: number;
  }
  // Declared in models/types.ts (Task 5); shown here for reference.
  export interface JobForProcessing {
    id: string;
    closed: boolean;
    title: string | null;
    companyName: string | null;
    descriptionText: string | null;
    evidence: Evidence;
  }
  export type ReuseKey = { inputHash: string; schemaVersion: number; promptHash: string; decisionModel: string; extractionModel: string };
  export interface NewExtraction extends ReuseKey, TypedColumns {
    jobId: string;
    data: ExtractionDocument;
    needsReview: boolean;
    costUsd: number;
  }
  export interface NewAttempt extends ModelCallMeta {
    jobId: string | null;
    extractionId: string | null;
    eval: boolean;
    step: 'decision' | 'extraction' | 'extraction_retry';
    outcome: 'ok' | 'error' | 'invalid';
    error: string | null;
    quoteFailures: number;
  }
  export type FinishOutcome = { status: 'processed'; extractionId: string | null } | { status: 'pending' | 'failed'; error: string };
  export abstract class ProcessorRepository {
    abstract listPendingInScope(limit: number): Promise<string[]>; // ordered by processingRequestedAt
    abstract claim(jobId: string): Promise<Claim | null>; // scope-checked, pending → processing
    abstract loadJob(jobId: string): Promise<JobForProcessing | null>;
    abstract findReusable(key: ReuseKey): Promise<{ id: string; jobId: string } | null>;
    abstract copyExtraction(extractionId: string, jobId: string): Promise<string>;
    abstract saveExtraction(row: NewExtraction): Promise<string>;
    abstract recordAttempts(rows: NewAttempt[]): Promise<void>;
    abstract finish(claim: Claim, outcome: FinishOutcome): Promise<'finished' | 'superseded'>;
    abstract releaseStale(olderThan: Date): Promise<number>; // processing + processingStartedAt < olderThan → pending
    abstract spendSince(since: Date): Promise<number>; // non-eval attempts only
    abstract markPending(filter: ReprocessFilter): Promise<number>; // Task 11
  }
  export type ReprocessFilter = { allInScope?: boolean; nullStatus?: boolean; failed?: boolean; jobIds?: string[] };
  ```

  `PrismaProcessorRepository` implements it.
  - `claim` is one conditional `updateAll`. It sets `processingStatus='processing'`, `processingAttempts+1` and `processingStartedAt=now()` where the id matches, the job is pending and the scope holds, then reads back `processingRequestedAt`. _If the ORM can't return the affected count, do it in a transaction with `forNoKeyUpdate()` on the row, as `jobs.writer.ts` does._
  - `finish` writes only `WHERE processingRequestedAt = claim.requestedAt AND processingStatus='processing'`. Otherwise it returns `'superseded'` and leaves the row alone, except `currentExtractionId`, which is still set for a `processed` outcome.
  - `markPending` sets `processingStatus='pending'`, `processingReason='new'`, `processingRequestedAt=now()`, `processingAttempts=0`, `processingError=null` on matching in-scope jobs.

- Produces (`vocab.repository.ts`): `abstract class VocabRepository { snapshot(): Promise<{ options: ListOptions; vocab: VocabSnapshot; regionCountries: Map<string, string[]> }>; propose(p: { list: ListName; text: string }[]): Promise<void>; upsertCities(c: { name: string; countryCode: string }[]): Promise<Map<string, string>>; bumpOccurrences(list: ListName, codes: string[]): Promise<void> }`, plus its Prisma implementation.
  - `propose` upserts with `status='proposed'`, `code=slugCode(text)` and `occurrences+1`. It never touches an `approved` row with the same code.
  - `upsertCities` returns `"name|CC"` mapped to the city id.

- [ ] **Step 1: Write failing Postgres tests** (skipped when `PROCESSOR_TEST_DATABASE_URL` is unset). Each builds its jobs with a small helper that inserts a `raw_items` row of the given channel plus `normalized_jobs` and `normalized_job_sources`.
  - `listPendingInScope`: returns a pending LinkedIn job board job. It excludes an Ashby-only job, a `kind:'post'` job, a `merged` job, and a `processed` job.
  - `claim race`: two concurrent `claim(id)` → exactly one non-null.
  - `claim refuses a job merged after listing` (Review Focus 4): list, set `status='merged'`, then `claim` → null.
  - `finish superseded`: claim, then set `processingStatus='pending'` and a new `processingRequestedAt` (a reopen), then `finish(processed)` → `'superseded'`. The status stays `pending`, and `currentExtractionId` is set.
  - `releaseStale`: a `processing` job started 20 minutes ago, released with 15 minutes → `pending`.
  - `findReusable` and `copyExtraction`: the copy has the new `jobId` and the same `data`.
  - `spendSince`: sums `costUsd` of non-eval attempts since a date, ignoring eval rows.
  - `markPending({ nullStatus: true })`: touches only null-status, in-scope jobs.
  - `VocabRepository.propose`: twice for `'Bun'` → one proposed row with `occurrences: 2`. Proposing a text whose slug is an approved code leaves that row approved.
  - `snapshot`: excludes proposed terms from `options`.
- [ ] **Step 2: Run** `PROCESSOR_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/repositories`. Expected: FAIL.
- [ ] **Step 3: Implement** both repositories.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): processor and vocab repositories`

### Task 9: ProcessJobService

**Files:**

- Create: `apps/xjobs/src/modules/processor/pipeline/process-job.service.ts`
- Create: `apps/xjobs/src/modules/processor/processor.module.ts`, `index.ts`
- Create: `apps/xjobs/src/modules/processor/testing/fakes.ts` (`FakeDecisionModel`, `FakeExtractionModel`, `MemoryProcessorRepository`, `MemoryVocabRepository`)
- Test: `pipeline/process-job.service.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 4–8.
- Produces:
  - `export type ProcessOutcome = 'processed' | 'reused' | 'closed' | 'superseded' | 'not_claimed' | 'over_budget' | 'retry' | 'failed'`
  - `@Injectable() export class ProcessJobService { process(jobId: string): Promise<ProcessOutcome> }`
  - `ProcessorModule` provides `ProcessJobService`, `ProcessorRepository → PrismaProcessorRepository`, `VocabRepository → PrismaVocabRepository`, `DecisionModel → OpenRouterDecisionModel`, `ExtractionModel → OpenRouterExtractionModel` and `PROCESSOR_CONFIG`. It exports `ProcessJobService` and `ProcessorRepository`.
- **Flow** (spec §4):
  1. Check `spendSince(start of UTC day)` against the budget → `over_budget`, with no claim.
  2. `claim`, else `not_claimed`.
  3. `loadJob`. If closed, `finish(processed, null)` → `closed`.
  4. Build the input, `snapshot()`, the questions and the reuse key. On a hit, link or copy it → `reused`.
  5. `decide`, then `selectFallback`, then `extract`, then `modelOutputSchema.safeParse`. On failure, or a `ModelOutputError`, call `extract` once more with `retryErrors` (step `extraction_retry`). If it fails again → `failed` with the errors.
  6. `resolveFacts` → `checkQuotes` → `checkConsistency` → `resolveTerms` → `upsertCities` (set `cityId`s) → `propose` → `extractionDocumentSchema.parse` → `deriveTypedColumns` → `saveExtraction` → `recordAttempts` (every call, with `extractionId`) → `bumpOccurrences` → `finish(processed)`.
- **Errors:**
  - `TransientModelError`: record the attempt, then `finish(pending, error)` while `claim.attempts < maxAttempts` → `retry` (the worker rethrows so BullMQ backs off). Otherwise `finish(failed)` → `failed`.
  - `ModelRequestError` or `ExtractionInvalidError` → `failed`.
  - Every model call, failed or not, is in `recordAttempts`.

- [ ] **Step 1: Write failing tests** with the fakes:
  - `happy path`: one decision call, one extraction call, one saved extraction, two attempts with the right `step`s, the job `processed`, `currentExtractionId` set.
  - `confident Jev, no fallback`: the extraction request schema has an empty `fallback`.
  - `low-confidence seniority goes to Opus`: the schema's `fallback` has `seniority`, and the saved fact is `decidedBy:'opus'`.
  - `reuse`: a second job with the same input → `reused`, no model calls.
  - `closed job`: `closed`, no model calls, `processed` with a null extraction.
  - `null description` (Review Focus 1): processes, and the saved document validates.
  - `schema-invalid then valid`: two extraction calls, the second `extraction_retry` with `retryErrors` non-empty → `processed`.
  - `invalid twice`: `failed`, `processingError` contains the Zod path.
  - `transient on attempt 1 of 3`: `retry`, status `pending`. `transient on attempt 3`: `failed`.
  - `over budget`: spend 20.00, budget 20 → `over_budget`, no claim.
  - `unknown tech term`: a `proposed` row for it, `unmatched` in the document, and not in `techTags`.
  - `superseded`: the fake repository returns `'superseded'` from `finish` → the outcome is `superseded` and the extraction is saved.
- [ ] **Step 2: Run** with `pipeline/process-job`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, the module and the fakes.
- [ ] **Step 4: Run** the whole processor unit suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): process one job end to end`

### Task 10: Worker role, queue and sweeper

**Files:**

- Create: `apps/xjobs/src/infrastructure/jobs/steps/process/config.ts`, `queue.service.ts`, `processor.ts`, `index.ts`
- Create: `apps/xjobs/src/infrastructure/worker/processor.service.ts`
- Modify: `apps/xjobs/src/infrastructure/worker/worker.service.ts`, `worker.module.ts`, `scheduler.ts`
- Modify: `apps/xjobs/package.json` (`"worker:processor:dev": "WORKER_ROLE=processor tsx watch --tsconfig tsconfig.app.json src/worker.ts"`), `apps/xjobs/project.json` (an Nx target `worker-processor`, mirroring `worker-ingest`), `docker-compose.worker.yaml` (a `processor` service)
- Test: `apps/xjobs/src/infrastructure/jobs/steps/process/processor.spec.ts`, `apps/xjobs/src/infrastructure/worker/tests/` (extend the existing worker-role test)

**Interfaces:**

- Produces (`queue.service.ts`): `PROCESS_QUEUE = 'process'`, `PROCESS_JOB = 'process-job'`, `PROCESS_SWEEP_JOB = 'sweep'`, and `@Injectable() ProcessQueue { enqueue(jobId: string): Promise<void> }` with `jobId` as the BullMQ job ID. `attempts` = `maxAttempts`, with exponential backoff of 30 s.
- Produces (`config.ts`): `processSweepConfig = { everyMs: 60_000, limit: 200 }`.
- Produces (`processor.ts`): `processProcessJob(job, deps: { service: Pick<ProcessJobService,'process'>; repo: Pick<ProcessorRepository,'listPendingInScope'|'releaseStale'|'spendSince'>; queue: Pick<ProcessQueue,'enqueue'>; config: ProcessorConfig })`.
  - `process-job`: validate `{ jobId }`, call `service.process`. On `retry`, throw `new Error('retry')` so BullMQ backs off; any other outcome returns `{ outcome }`.
  - `sweep`: `releaseStale(now − claimTimeoutMs)`. If not over budget, `listPendingInScope(limit)` and enqueue each. Returns `{ released, enqueued }`.
- Produces (`processor.service.ts`): `ProcessorWorkerService.start(connection)`, mirroring `IngestWorkerService`, using `syncProcessSweepScheduler(queue)` (new in `scheduler.ts`).
- `WorkerService`: `role` becomes `'ingest' | 'processor' | 'all'`, and `startAll` also starts the processor.

- [ ] **Step 1: Write failing tests:**
  - **`processor.spec.ts`:**
    - `process-job` with `{}` → `UnrecoverableError`;
    - outcome `retry` → throws;
    - outcome `processed` → returns it;
    - `sweep` calls `releaseStale` with `now − 900000` and enqueues the listed IDs;
    - `sweep` over budget → releases but enqueues nothing.
  - **Worker test:** `WORKER_ROLE=processor` starts only the processor worker; `all` starts it too.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/infrastructure`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire `ProcessorModule` into `WorkerModule`.
- [ ] **Step 4: Run** it, then `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): processor worker role, queue and sweeper`

### Task 11: Golden set, label drafting, eval

**Files:**

- Create: `apps/xjobs/src/scripts/processor-golden-import.ts`, `processor-golden-draft.ts`, `processor-eval.ts`
- Create: `apps/xjobs/src/modules/processor/golden/cases/<id>.json` (79 files), `golden/golden.ts`, `golden/score.ts`
- Modify: `apps/xjobs/package.json` (`processor:golden-import`, `processor:golden-draft`, `processor:eval`)
- Test: `golden/score.spec.ts`, `golden/golden.spec.ts`

**Interfaces:**

- Produces (`golden.ts`):
  - `export interface GoldenCase { id: string; input: { title; companyName; description: string; evidence: Evidence }; expected: Partial<GoldenFacts>; drafted: Partial<Record<DraftedKey, { value: unknown; reviewed: boolean }>> }`
  - `DraftedKey = 'arrangement' | 'contractType' | 'isSoftwareEngineeringRole' | 'engagement'`
  - `GoldenFacts` = the values (no envelopes) of the spec §5 facts.
  - `loadGolden(): GoldenCase[]`
- Produces (`score.ts`):
  - `export function scoreCase(doc: ExtractionDocument, c: GoldenCase): FactScores`
  - `export function summarize(scores: FactScores[]): EvalReport`, with per-fact accuracy, the Jev/Opus share, per-question accuracy by score bucket (`0–0.5, 0.5–0.7, 0.7–0.8, 0.8–0.9, 0.9–1`), the lowest threshold whose accepted Jev answers are ≥ 98% correct, cost per job, and `sureContradicted` (the share of `sure` facts that contradict the golden value).
  - **Bars** (spec §8):
    - openings country/region accuracy ≥ 0.95;
    - arrangement ≥ 0.97;
    - mainStack tag recall ≥ 0.90;
    - `sureContradicted` ≤ 0.02.

    `EvalReport.pass` is true when all four hold.

  - A `drafted` value counts only when `reviewed: true`.

- **Scripts:**
  - **`processor-golden-import -- <career-hub path>`**:
    - reads `src/extract/golden/*.json`;
    - strips any `## Company page (…)` section from the description, keeping the `## LinkedIn posting` text;
    - sets to `unstated` any golden fact whose quote is no longer in the stripped text;
    - translates codes with `seed-data.ts`;
    - writes `cases/`.
  - **`processor-golden-draft`**: for each case whose `drafted` keys are missing, it asks the configured extraction model for the four keys and writes them with `reviewed: false`.
  - **`processor-eval [--decision-model m] [--extraction-model m]`**:
    - runs every case through the real pipeline functions (Tasks 4–7, plus the real adapters and an in-memory repository);
    - records attempts with `eval: true`;
    - prints the `EvalReport` as a table and writes `golden/last-report.json`;
    - exits 1 when `pass` is false.

- [ ] **Step 1: Write failing tests:**
  - **`score.spec.ts`:**
    - a document matching a case exactly → every accuracy is 1, `pass: true`;
    - a `sure` wrong seniority → it counts in `sureContradicted`;
    - an unreviewed drafted `arrangement` is ignored;
    - the threshold pick on a synthetic set (0.95 correct, 0.75 wrong, 0.85 correct) → 0.85.
  - **`golden.spec.ts`:** all 79 cases parse; no description contains `## Company page`; no case contains the strings `Morocco`, `Souhail` or `criteria`.
- [ ] **Step 2: Run** with `golden`. Expected: FAIL.
- [ ] **Step 3: Implement** `golden.ts`, `score.ts` and the three scripts. Run `pnpm --filter @xjobs/xjobs processor:golden-import -- ../career-hub` and commit the cases.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: The human** runs `processor:golden-draft`, reviews every drafted value (setting `reviewed: true` or correcting it), then runs `processor:eval`. Thresholds in `config/thresholds.ts` are updated from the report, and the report is pasted into the PR. **The processor worker is not deployed until `pass` is true.**
- [ ] **Step 6: Commit** `feat(processor): golden set and eval`

### Task 12: Reprocess and vocab scripts, docs

**Files:**

- Create: `apps/xjobs/src/scripts/reprocess-jobs.ts`, `apps/xjobs/src/scripts/vocab.ts`
- Modify: `apps/xjobs/package.json` (`"db:reprocess"`, `"db:vocab"`), `apps/xjobs/src/modules/processor/README.md`, repo-root `CLAUDE.md`, `docs/roadmap/process-backlog.md`
- Test: `apps/xjobs/src/scripts/vocab.spec.ts` (argument parsing), and in `processor.postgres.spec.ts`: `vocab approve`, `vocab alias`

**Interfaces:**

- Consumes: `ProcessorRepository.markPending` and `VocabRepository` (Task 8).
- Produces: `parseReprocessArgs(argv): ReprocessFilter`; `parseVocabArgs(argv): { list: ListName | 'cities'; action: 'list' } | { action: 'approve' | 'reject'; code: string } | { action: 'alias'; code: string; to: string }`. Add `approve(list, code)`, `alias(list, code, to)` and `reject(list, code)` to `VocabRepository`:
  - `alias` adds the proposed row's label (lower-case) to the target's aliases and deletes the proposed row;
  - `reject` deletes a proposed row;
  - none of them touches an approved row other than the alias target.
- **CLAUDE.md:**
  - Replace "Claude is called through the Anthropic API from the engine. It does not orchestrate the engine." with "LLMs are called from the engine through OpenRouter; which model plays each role is configuration. Claude does not orchestrate the engine."
  - Add the commands `npx nx worker-processor xjobs`, `pnpm --filter @xjobs/xjobs db:reprocess`, `db:vocab` and `processor:eval`.
  - Mention `processor` in the `worker-all` line.

- [ ] **Step 1: Write failing tests:**
  - `parseReprocessArgs(['--null-status'])` → `{ nullStatus: true }`;
  - no flags → throws `'pass at least one of --all-in-scope, --null-status, --failed, --job'`;
  - `parseVocabArgs(['techTags','alias','bun','--to','javascript'])`;
  - Postgres: an aliased proposed term becomes resolvable through the target's aliases (`snapshot().vocab`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the scripts and docs. README sections: flow, statuses, tables, list approval, reprocessing after a version bump, eval, the shared-tables exception.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): reprocess and vocab scripts, docs`

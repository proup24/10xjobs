# Generate-then-verify processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The configured generator (Opus or DeepSeek) writes the whole extraction document through the Vercel AI SDK, Jev verifies every closed field, rejected fields are regenerated up to twice and then dropped, and the tech stack becomes unified per-technology requirements ready for skill matching.

**Architecture:** `ExtractionPipeline` runs generate → assemble → verify → (regenerate | finalize). Generation is a new `GenerationService` over an AI-SDK `ExtractionModel`. Verification is a new `VerificationService` over the existing `DecisionModel` (Jev, Decisions API). Two new pure rule modules hold the decisions: `rules/verify.ts` (questions and verdicts) and `rules/finalize.ts` (applying the verdicts). The document schema gets a v2 fact envelope and a v2 tech stack.

**Tech Stack:** NestJS, TypeScript strict (nodenext), Zod 4, Vitest, `ai` 7.x, `@openrouter/ai-sdk-provider` 3.x, `@openrouter/sdk` (Jev only), Prisma Next contract + migrations in `libs/database`.

**Spec:** `docs/superpowers/specs/2026-11-07-generate-then-verify-design.md`. Read it with this plan. Section numbers below (§2, §5a…) refer to it.

## Global Constraints

- Models only from config: `PROCESSOR_EXTRACTION_MODEL` (generator), `PROCESSOR_DECISION_MODEL` (verifier). No model ID in code outside defaults and tests.
- New env: `PROCESSOR_MAX_REGENERATIONS` default `2`, `PROCESSOR_GENERATION_TRIES` default `3`.
- AI SDK transport retries off: `maxRetries: 0`.
- Jev stays on `@openrouter/sdk` `alpha.decisions.create`. Every verification question is `choice` and includes `unstated`. Booleans and junk flags are asked as `yes` / `no` / `unstated`.
- Verdicts: `confirmed` | `unconfirmed` | `rejected`. Only `rejected` triggers a regeneration.
- `decidedBy` ∈ `'ingest' | 'generator'`. `EXTRACTION_SCHEMA_VERSION = 2`.
- `processing_attempts.step` allows `decision, extraction, extraction_retry, generation, generation_retry, verification`. New runs write only the last three.
- Requirement `importance`: integer 1–10. Bands: `main` 8–10, `must` 5–9, `nice` 1–4.
- Requirement `domain` ∈ `SkillDomain` codes: `backend, frontend, fullstack, mobile, devops, data, ml, security, qa`, or null.
- `years` and job-level `yearsRequired`: `{ min: number | null, max: number | null }`, `max ≥ min` when both are set.
- `.env*` (except `.env.example`) and `private/` are off-limits. Claude does not `git push`.
- Unit tests: `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/<path>`. CI: `npx nx run-many -t lint test build typecheck`.

## Review Focus

1. **A posting that names a skill only as an alternative** ("Python or Go"): both become requirements in one group with `min: 1`, and neither shows up in `requiredTags` as needed on its own. Matching still has to read `groups`. Pinned in Task 3 (`requiredTags includes group members; groups preserved in data`).
2. **The generator flips a confirmed field during a regeneration**: the changed field must be re-asked, not keep its old `confirmed`. Pinned in Task 6 (`changed confirmed field is re-verified`).
3. **Jev confirms the generator's `unstated`**: it is stored `unstated`, `sure`, and must not trigger the ingest fill afterwards. Pinned in Task 5 (`confirmed unstated is not refilled`).
4. **A decision model with no threshold table** (a new Jev version in config): every field becomes `unconfirmed`, there is no regeneration loop, and the warning is logged once. Pinned in Task 5 (`unknown model → all unconfirmed`).
5. **Old `job_extractions` rows with schema v1**: readers of `data` (typed columns, preview, `GET /processor/jobs/:id`) must not crash on v1 documents. Pinned in Task 4 (`v1 document still parses with the v1 schema`): keep the v1 schema exported as `extractionDocumentV1Schema` for reads.

---

## File Structure

| File                                                                                                             | Change                                    | Responsibility                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `libs/database/src/contract/contract.prisma`                                                                     | modify                                    | `step` check, `requiredTags`, `niceTags`                                                          |
| `libs/database/src/migrations/app/<new>/`                                                                        | create (generated)                        | migration                                                                                         |
| `apps/xjobs/src/modules/processor/repositories/processor.repository.ts`                                          | modify                                    | `NewAttempt.step` union, new columns written                                                      |
| `apps/xjobs/src/modules/processor/repositories/vocab.repository.ts`                                              | modify                                    | `Vocabulary.engineeringRoleKinds`                                                                 |
| `apps/xjobs/src/modules/processor/schema/shared.ts`                                                              | modify                                    | `rangeSchema`, `requirementSchema`, `requirementGroupSchema`, `SKILL_DOMAINS`, `IMPORTANCE_BANDS` |
| `apps/xjobs/src/modules/processor/schema/fact.ts`                                                                | modify                                    | v2 envelope, `verificationSchema`                                                                 |
| `apps/xjobs/src/modules/processor/schema/extraction.ts`                                                          | modify                                    | v2 document, v1 kept for reads                                                                    |
| `apps/xjobs/src/modules/processor/schema/model-output.ts`                                                        | modify                                    | no `fallback`, new stack, years range                                                             |
| `apps/xjobs/src/modules/processor/rules/stack.ts`                                                                | create                                    | requirement and group checks                                                                      |
| `apps/xjobs/src/modules/processor/rules/validate.ts`                                                             | modify                                    | per-requirement quotes, engineering from vocabulary, needsReview                                  |
| `apps/xjobs/src/modules/processor/rules/typed-columns.ts`                                                        | modify                                    | `requiredTags`, `niceTags`                                                                        |
| `apps/xjobs/src/modules/processor/rules/resolve-facts.ts`                                                        | modify                                    | generator-only facts + ingest fill, no Jev                                                        |
| `apps/xjobs/src/modules/processor/rules/questions.ts`                                                            | modify                                    | verification questions (all choice)                                                               |
| `apps/xjobs/src/modules/processor/rules/verify.ts`                                                               | create                                    | verdicts                                                                                          |
| `apps/xjobs/src/modules/processor/rules/finalize.ts`                                                             | create                                    | applying verdicts to the document                                                                 |
| `apps/xjobs/src/modules/processor/vocab/resolve.ts`                                                              | modify                                    | technology codes on requirements                                                                  |
| `apps/xjobs/src/modules/processor/models/extraction.model.ts`                                                    | rewrite                                   | AI SDK generator                                                                                  |
| `apps/xjobs/src/modules/processor/models/types.ts`                                                               | modify                                    | `ExtractionModel` contract                                                                        |
| `apps/xjobs/src/modules/processor/services/generation.service.ts`                                                | create (replaces `extraction.service.ts`) | tries + assembly                                                                                  |
| `apps/xjobs/src/modules/processor/services/verification.service.ts`                                              | create (replaces `decision.service.ts`)   | one Jev round                                                                                     |
| `apps/xjobs/src/modules/processor/services/extraction-pipeline.service.ts`                                       | rewrite                                   | the loop                                                                                          |
| `apps/xjobs/src/modules/processor/services/fact-assembler.service.ts`                                            | modify                                    | no `Decisions` input                                                                              |
| `apps/xjobs/src/modules/processor/config/processor.config.ts`, `apps/xjobs/src/config/environment.validation.ts` | modify                                    | new env                                                                                           |
| `apps/xjobs/src/modules/processor/processor.module.ts`, `services/processor.service.ts`, `testing/fakes.ts`      | modify                                    | wiring, fakes                                                                                     |
| `apps/xjobs/src/modules/processor/prompts/system.prompt.ts`                                                      | modify                                    | new stack, years, feedback                                                                        |
| `apps/xjobs/src/modules/processor/golden/*`, `apps/xjobs/src/scripts/processor-eval.ts`, `golden/cases/*.json`   | modify                                    | v2 shapes, verification report                                                                    |
| `apps/xjobs/src/modules/processor/README.md`, `.env.example`                                                     | modify                                    | docs                                                                                              |

---

### Task 1: Contract: attempt steps and requirement tag columns

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`JobExtraction`, `ProcessingAttempt`)
- Create: migration under `libs/database/src/migrations/app/` (generated)
- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts:44`
- Test: `apps/xjobs/src/modules/processor/repositories/processor.postgres.spec.ts`

**Interfaces:**

- Produces: `NewAttempt['step']` = `'decision' | 'extraction' | 'extraction_retry' | 'generation' | 'generation_retry' | 'verification'`. Columns `job_extractions."requiredTags" text[]` and `"niceTags" text[]`, NOT NULL default `'{}'`, with GIN indexes `job_extractions_requiredTags_gin` and `job_extractions_niceTags_gin`.

- [ ] **Step 1: Write failing postgres tests** in `processor.postgres.spec.ts`: `inserts an attempt with step 'verification'` and `still inserts a legacy 'decision' attempt` (both succeed), plus `saves requiredTags and niceTags` (save an extraction whose typed columns carry `requiredTags: ['python']` and `niceTags: ['go']`, read the row back and assert both arrays).
- [ ] **Step 2: Run** `PROCESSOR_TEST_DATABASE_URL=… npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/repositories`. Expected: FAIL (check constraint, unknown column). Skip this run if no test database is available, and say so in the task report.
- [ ] **Step 3: Edit the contract.** Change the `processing_attempts_step` check to the six values. Add `requiredTags String[] @default([])` and `niceTags String[] @default([])` to `JobExtraction` with GIN `@@index` entries named as above, matching the existing `techTags` index style.
- [ ] **Step 4: Generate the migration** with `pnpm --filter @xjobs/database db:migration:plan`, then `pnpm db:migrate` locally. Expected: a new migration folder, applied cleanly. Run `pnpm db:types`.
- [ ] **Step 5: Widen `NewAttempt.step`** and write the two columns in the extraction insert, taking them from `TypedColumns` (Task 3 adds the fields; until then pass `[]`).
- [ ] **Step 6: Run** the repository tests and `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(db): verification attempt steps and requirement tag columns`.

### Task 2: Engineering role kinds from the table

**Files:**

- Modify: `repositories/vocab.repository.ts` (`Vocabulary`, `snapshot()`), `rules/validate.ts:1-5,124-150`, `testing/fakes.ts` (memory vocabulary)
- Test: `rules/validate.spec.ts`, `repositories/vocab.repository.spec.ts`

**Interfaces:**

- Produces: `Vocabulary.engineeringRoleKinds: Set<string>` (approved `role_kinds` with `isEngineering = true`). `checkConsistency(doc: ExtractionDocument, engineeringRoleKinds: Set<string>): ExtractionDocument`.

- [ ] **Step 1: Failing tests.** `checkConsistency` with `engineeringRoleKinds = new Set(['backend_engineer'])`: `roleKind 'devrel'` + `isSoftwareEngineeringRole: true` → both `unsure`. `roleKind 'backend_engineer'` + `true` → unchanged. A test that `validate.ts` no longer imports `common/enums` (read the source and assert it doesn't contain `Position`).
- [ ] **Step 2: Run** `… src/modules/processor/rules/validate.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `snapshot()` selects `isEngineering` from `role_kinds`. Delete `ENGINEERING_CODES`. Callers (`FactAssembler`) pass `vocabulary.engineeringRoleKinds`. The memory fake builds the set from the seed's `ENGINEERING_ROLE_KINDS`.
- [ ] **Step 4: Run** the processor tests. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(processor): engineering role kinds from role_kinds.isEngineering`.

### Task 3: Tech stack v2: requirements, groups, years ranges

**Files:**

- Modify: `schema/shared.ts`, `schema/model-output.ts`, `schema/extraction.ts` (stack and `yearsRequired` only), `vocab/resolve.ts`, `rules/validate.ts` (`checkQuotes`, `needsReview`), `rules/typed-columns.ts`
- Create: `rules/stack.ts`
- Test: `rules/stack.spec.ts`, `schema/extraction.spec.ts`, `rules/validate.spec.ts`, `rules/typed-columns.spec.ts`, `vocab/resolve.spec.ts`

**Interfaces:**

- Produces (in `schema/shared.ts`):
  - `SKILL_DOMAINS = ['backend','frontend','fullstack','mobile','devops','data','ml','security','qa'] as const`
  - `IMPORTANCE_BANDS = { main: [8, 10], must: [5, 9], nice: [1, 4] } as const`
  - `rangeSchema = z.strictObject({ min: z.number().nonnegative().nullable(), max: z.number().nonnegative().nullable() })`
  - `requirementSchema = z.strictObject({ technology: termSchema, kind: z.enum(['main','must','nice']), importance: z.number().int().min(1).max(10), domain: z.enum(SKILL_DOMAINS).nullable(), years: rangeSchema.nullable(), quote: z.string(), confidence: confidenceSchema, group: z.string().min(1).nullable() })`
  - `requirementGroupSchema = z.strictObject({ id: z.string().min(1), min: z.number().int().min(1) })`
  - `techStackSchema = z.strictObject({ requirements: z.array(requirementSchema), groups: z.array(requirementGroupSchema) })`
  - types `Requirement`, `RequirementGroup`, `TechStack`
- Produces (in `rules/stack.ts`): `stackErrors(stack: TechStack): string[]`. Empty means valid. Each message is `techStack.value.<path>: <reason>`.
- Produces: `TypedColumns.requiredTags: string[]`, `TypedColumns.niceTags: string[]`.
- `yearsRequired` (model output and document) becomes `fact(rangeSchema)`.

- [ ] **Step 1: Failing tests for `stackErrors`** (`rules/stack.spec.ts`), one `it` each:
  - `Python|TypeScript|Go in group g1 min 1` → `[]`
  - `group references unknown id` → one error mentioning `group`
  - `group with one member` → error
  - `group min 3 with 2 members` → error
  - `group members with different kinds` → error
  - `duplicate (code, domain)` → error. The same code with different domains → `[]`.
  - `nice requirement with importance 6` → error. `main` with importance 7 → error. `must` with 5 and with 9 → `[]`.
  - `years { min: 5, max: 3 }` → error. `{ min: 3, max: null }` → `[]`.
- [ ] **Step 2: Failing tests for quotes, columns and review:**
  - `checkQuotes`: two requirements, one quote missing from the posting → that one has `quote: ''` and `unsure`, the other is unchanged, and `quoteFailures` is 1.
  - `deriveTypedColumns`: `main` python, `must` go (group g1 with rust), `nice` docker → `mainStackTags ['python']`, `requiredTags ['go','python','rust']`, `niceTags ['docker']`, `techTags` all four, and a `code: null` requirement appears in no column.
  - `needsReview`: a `main` requirement `unsure` → true. Only a `nice` requirement `unsure` → false.
  - `resolveTerms`: a requirement `{ text: 'ReactJS', code: null }` resolves through aliases to `react`. An unknown term is proposed once.
- [ ] **Step 3: Run** them. Expected: FAIL.
- [ ] **Step 4: Implement** the schemas above. Replace the stack in both the model output and the document schema. Wire `stackErrors` into the document `superRefine`, and into `FactAssembler` before `validDocument`, throwing `ExtractionInvalidError` with the first error's path. `checkQuotes` checks each requirement's own quote and no longer the stack-level quote. `resolveTerms` resolves `requirements[].technology` instead of the old groups. Delete `groupSchema`, `mustHaveSchema` and the old `mainStack`/`mustHaves`/`niceToHaves` code paths.
- [ ] **Step 5: Run** the processor tests. Fix the fixtures in `schema/fixture.testing.ts` and the fakes to the new shape. Expected: PASS.
- [ ] **Step 6: Commit** `feat(processor): tech stack as unified requirements with domain, years, importance and quotes`.

### Task 4: Fact envelope v2, no Jev in fact resolution

**Files:**

- Modify: `schema/fact.ts`, `schema/extraction.ts`, `schema/model-output.ts` (drop `fallback`), `rules/resolve-facts.ts`, `services/fact-assembler.service.ts`
- Test: `rules/resolve-facts.spec.ts`, `schema/extraction.spec.ts`

**Interfaces:**

- Produces (in `schema/fact.ts`):
  - `type DecidedBy = 'ingest' | 'generator'`
  - `type Verdict = 'confirmed' | 'unconfirmed' | 'rejected'`
  - `verificationSchema = z.strictObject({ verdict: z.enum(['confirmed','unconfirmed','rejected']), score: z.number().min(0).max(1).nullable(), jevPick: z.string().nullable(), rounds: z.number().int().min(1) })`
  - `factSchema` gains `verification: verificationSchema.nullable()`
- Produces: `EXTRACTION_SCHEMA_VERSION = 2`. The document gains `verification: z.strictObject({ rounds: z.number().int().min(1), regenerationInvalid: z.boolean(), dropped: z.array(z.strictObject({ field: z.string(), generatorValue: z.unknown(), jevPick: z.string().nullable() })), missedJunkFlags: z.array(z.string()) })`. `models` becomes `{ verifier: string | null, generator: string }`. `extractionDocumentV1Schema` keeps the current v1 schema for reading old rows.
- Produces: `modelOutputSchema(options: ListOptions)`, with the `fallback` parameter removed. `resolveFacts(args: { output: ModelOutput; input: PostingInput; generatorModel: string }): ExtractionDocument`. Every fact is `decidedBy: 'generator'`, `score: null`, `verification: null`, and the document `verification` is `{ rounds: 1, regenerationInvalid: false, dropped: [], missedJunkFlags: [] }`. The ingest fill sets `decidedBy: 'ingest'` for `seniority`/`contractType` when the generator says `unstated` or null and `ingestFallback` maps to one code.
- `FactAssembler.assemble(output: ModelOutput, meta: ModelCallMeta, input: PostingInput, vocabulary: Vocabulary): AssembledDocument`

- [ ] **Step 1: Failing tests:** `resolveFacts` with generator `seniority: unstated` and evidence `experienceLevel: 'Mid-Senior level'` mapping to one code → `decidedBy 'ingest'`. Generator `seniority: senior` contradicting evidence → keeps `senior`, `decidedBy 'generator'`, and a conflict is recorded (as today). `extractionDocumentV1Schema` parses `schema/fixture.testing.ts`'s old v1 fixture (copy it to `fixture-v1.testing.ts` before changing the shape).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Delete `jevStands`, `selectFallback` and the `answers`/`fallback` paths in `resolveFacts`. Keep `ingestFallback`, `resolveSponsorship`, `resolveJunk`'s generator path and `resolveSalary`. Readers of stored `data` (controller `GET /processor/jobs/:id`, preview) parse with v2 and fall back to v1.
- [ ] **Step 4: Run** the processor tests. Expected: PASS, except the pipeline and service tests that Task 7 rewrites. Mark those `it.todo` with a `// Task 7` comment rather than deleting them.
- [ ] **Step 5: Commit** `refactor(processor): v2 fact envelope; facts come from the generator and ingest only`.

### Task 5: Verification rules

**Files:**

- Modify: `rules/questions.ts`, `models/types.ts` (`DecisionQuestion` keeps both kinds; verification uses only `choice`), `config/thresholds.ts` (doc comment only)
- Create: `rules/verify.ts`
- Test: `rules/questions.spec.ts`, `rules/verify.spec.ts`

**Interfaces:**

- Produces:
  - `type VerifiedField = 'arrangement' | 'seniority' | 'roleKind' | 'contractType' | 'engagement' | 'isSoftwareEngineeringRole' | 'sponsorshipOffered' | `junk:${string}``. This is `ClosedQuestionKey`, reused.
  - `buildVerificationQuestions(options: ListOptions, keys?: ReadonlySet<ClosedQuestionKey>): DecisionQuestion[]`. Every question is `kind: 'choice'`. The options are the list's approved codes, plus `unstated` when the list lacks it. Booleans, junk flags and sponsorship get `['yes','no','unstated']`. With `keys`, only those questions are built.
  - `generatorAnswers(doc: ExtractionDocument, options: ListOptions): Record<ClosedQuestionKey, string>`. It maps the document to option strings: null → `'unstated'`, `true`/`false` → `'yes'`/`'no'`, `junk:<code>` → `'yes'` when the code is in `junkFlags.value`, else `'no'`, and `roleKind` from `position.value.roleKind`.
  - `interface FieldVerdict { key: ClosedQuestionKey; verdict: Verdict; score: number | null; jevPick: string | null; generatorValue: string }`
  - `judge(generator: Record<ClosedQuestionKey, string>, answers: DecisionAnswer[], decisionModel: string): FieldVerdict[]`. Applies the spec §3 table with `thresholdFor`. A missing answer or `value: null` → `unconfirmed`, `score: null`.

- [ ] **Step 1: Failing tests** in `rules/verify.spec.ts`:
  - `same pick, score 0.9, threshold 0.8 → confirmed`
  - `different pick, score 0.9 → rejected, jevPick set`
  - `same pick, score 0.5 → unconfirmed`; `different pick, score 0.5 → unconfirmed`
  - `missing answer → unconfirmed, score null`
  - `unknown model → all unconfirmed` (pins Review Focus 4; `thresholdFor` warns once: spy on the logger and assert one call across two `judge` calls)
  - `generator null compared as unstated: Jev 'unstated' 0.9 → confirmed`
  - `junk flag present, Jev 'no' 0.9 → rejected`; `junk flag absent, Jev 'yes' 0.9 → rejected`
  - `confirmed unstated is not refilled`: covered in Task 6's finalize test; leave a pointer comment here.
- [ ] **Step 2: Failing tests** in `rules/questions.spec.ts`: every question is `choice`; `isSoftwareEngineeringRole` options are `['yes','no','unstated']`; `engagement` options include `unstated` exactly once; with `keys = {'seniority'}` only one question is built. Add `schema enums equal verification options` (spec §6): for each list-backed closed field, the enum values of `modelOutputSchema(options)` at that field (read through `z.toJSONSchema`), with `unstated` added, equal the question's options as a set. Run it over the seed vocabulary.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** `rules/verify.ts` and rebuild `rules/questions.ts` on the rules above, keeping the current instruction wording and `JUNK_INSTRUCTIONS`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(processor): verification questions and verdicts`.

### Task 6: Finalizing a document from verdicts

**Files:**

- Create: `rules/finalize.ts`
- Modify: `rules/validate.ts` (`needsReview`)
- Test: `rules/finalize.spec.ts`, `rules/validate.spec.ts`

**Interfaces:**

- Consumes: `FieldVerdict` (Task 5), v2 document (Task 4).
- Produces:
  - `applyVerdicts(doc: ExtractionDocument, verdicts: FieldVerdict[], opts: { round: number; final: boolean; regenerationInvalid: boolean }): ExtractionDocument`. `confirmed` → `sure` + score. `unconfirmed` → `unsure` + score. `rejected` and `final` → value null (`'unstated'` for `arrangement`, `seniority`, `contractType`, `engagement` and `position.value.roleKind`), quote `''`, `unsure`, entry in `verification.dropped`. A rejected junk flag the generator included is removed from the array. A rejected flag the generator omitted is added to `verification.missedJunkFlags`. A final rejected `arrangement` sets every opening to `unsure`. `verification.rounds = round`. A non-final call with rejections returns the doc unchanged except for its verdict records.
  - `carryVerdicts(previous: FieldVerdict[], prevGen: Record<ClosedQuestionKey,string>, nextGen: Record<ClosedQuestionKey,string>): { kept: FieldVerdict[]; toAsk: Set<ClosedQuestionKey> }`. It keeps `confirmed` verdicts whose generator value did not change, and everything else goes to `toAsk`.
  - `needsReview(doc)` adds: `verification.dropped.length > 0`, `verification.missedJunkFlags.length > 0`, `engagement` or `isSoftwareEngineeringRole` `unsure`. It keeps every existing condition, with "techStack unsure" replaced by "any `main` requirement unsure" (Task 3).

- [ ] **Step 1: Failing tests** (`rules/finalize.spec.ts`):
  - `confirmed seniority → sure, score 0.9, verification.verdict confirmed`
  - `rejected arrangement, final → 'unstated', quote '', every opening unsure, dropped has { field: 'arrangement', generatorValue: 'remote', jevPick: 'onsite' }`
  - `rejected seniority final is not refilled from ingest` (the evidence maps to `senior`; the value stays `unstated`)
  - `confirmed unstated is not refilled` (pins Review Focus 3)
  - `rejected included junk flag removed; rejected omitted flag in missedJunkFlags`
  - `changed confirmed field is re-verified`: `carryVerdicts` with seniority confirmed `senior`→`mid` puts `seniority` in `toAsk` (pins Review Focus 2). Unchanged confirmed `arrangement` is kept.
  - `needsReview true for dropped field; true for unsure engagement; false when all confirmed and no conflicts`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): apply Jev verdicts; drop what Jev still rejects`.

### Task 7: AI SDK generator, services and the loop

**Files:**

- Modify: `apps/xjobs/package.json` (add `ai@^7.0.164`, `@openrouter/ai-sdk-provider@^3.1.0`), `models/types.ts`, `models/extraction.model.ts` (rewrite), `models/client.ts` (`toModelError` handles `APICallError`), `services/extraction-pipeline.service.ts` (rewrite), `config/processor.config.ts`, `apps/xjobs/src/config/environment.validation.ts`, `processor.module.ts`, `services/processor.service.ts` (`createProcessorService`, the step comment), `testing/fakes.ts`, `controllers/processor.controller.ts` (preview response unchanged in shape)
- Create: `services/generation.service.ts`, `services/verification.service.ts`
- Delete: `services/decision.service.ts`, `services/extraction.service.ts` (move `zodErrors` to `schema/errors.ts`)
- Test: `models/extraction.model.spec.ts` (rewrite), `services/extraction-pipeline.service.spec.ts` (new), `services/processor.service.spec.ts` (un-todo Task 4's tests), `config/validation.spec.ts`

**Interfaces:**

- Produces:
  - `ProcessorConfig` gains `maxRegenerations: number` (env `PROCESSOR_MAX_REGENERATIONS`, int ≥ 0, default 2) and `generationTries: number` (env `PROCESSOR_GENERATION_TRIES`, int ≥ 1, default 3).
  - `abstract class ExtractionModel { abstract generate(input: PostingInput, req: { systemPrompt: string; schema: z.ZodType; retryErrors?: string[]; feedback?: FieldVerdict[] }): Promise<{ output: unknown; meta: ModelCallMeta }> }`. One call, with no internal retries. Schema-invalid output throws `ModelOutputError(message, meta)` whose message lists the Zod issues.
  - `class AiSdkExtractionModel extends ExtractionModel`, constructed with `(apiKey: string, model: string, pricing: ModelPricing)`. Built on `createOpenRouter({ apiKey })` and `generateText` with structured output (`Output.object({ schema })`), or `generateObject` if that is the installed v7 API (check `node_modules/ai` docs). Settings: `maxRetries: 0`, OpenRouter `usage: { include: true }`, and `provider: { require_parameters: true }` through the provider's extra body. Cost comes from `providerMetadata.openrouter.usage.cost`, else from `pricing.costOf`. The system prompt keeps `cacheControl: ephemeral` through provider options. `NoObjectGeneratedError` → `ModelOutputError`. `APICallError` → `toModelError` by status.
  - `GenerationService.generate(input, vocabulary, feedback: FieldVerdict[] | undefined, step: 'generation' | 'generation_retry', log): Promise<{ ok: true; assembled: AssembledDocument } | { ok: false; errors: string[] }>`. Up to `config.generationTries` calls. Assembler `ExtractionInvalidError` and `ModelOutputError` feed the next try's `retryErrors`. The first call is logged with `step`, later tries with `'generation_retry'`.
  - `VerificationService.verify(doc, input, vocabulary, keys: Set<ClosedQuestionKey> | undefined, log): Promise<FieldVerdict[]>`. One Jev call, logged `'verification'`. `ModelOutputError` → every asked field `unconfirmed`, logged `invalid`. Other errors are thrown.
  - `ExtractionPipeline.run(input, vocabulary, log): Promise<AssembledDocument>` implements spec §1 with `carryVerdicts` and `applyVerdicts`. A first generation with `ok: false` throws `ExtractionFailed(errors)`. A later `ok: false` finalizes the previous document with `regenerationInvalid: true`.
- Prompt: `prompts/system.prompt.ts` gets the requirements section (one technology per requirement, groups for alternatives with the "Python, TypeScript or Go" example, `kind` rules carried over from today's `mainStack`/`mustHaves`/`niceToHaves` text, the importance bands with examples, `domain` and `years` rules), the `yearsRequired` range, and no fallback text. Regeneration feedback is a separate user message built in `extraction.model.ts`, listing per rejected field: the field's question, the generator's value, Jev's pick and score, the instruction to re-read the posting, and that `unstated` is allowed. It never says to adopt Jev's pick.

- [ ] **Step 1: Install** with `pnpm --filter @xjobs/xjobs add ai@^7.0.164 @openrouter/ai-sdk-provider@^3.1.0`. Read the installed `ai` structured-output API and record which call you use in the task report.
- [ ] **Step 2: Failing model tests** (`models/extraction.model.spec.ts`), with the AI SDK's mock language model (`ai/test` `MockLanguageModelV*`) injected through a constructor seam `(languageModel?: LanguageModel)`:
  - `valid object → output and meta with cost from provider metadata`
  - `schema-invalid object → ModelOutputError listing paths`
  - `402 APICallError → ProviderUnavailableError`; `429 → TransientModelError`; `400 → ModelRequestError`
  - `feedback renders a message naming the field, the generator value, Jev's pick and score, and not "use"/"adopt"`
  - `request sets maxRetries 0 and require_parameters`
- [ ] **Step 3: Failing pipeline tests** (`services/extraction-pipeline.service.spec.ts`), with fake models from `testing/fakes.ts`, asserting calls and logged steps:
  - `confirmed first time`: 1 generation, 1 verification, `rounds 1`
  - `rejected then fixed`: the second generation receives feedback for `seniority` only; the second verification asks only `seniority` and the fields that changed
  - `rejected twice → dropped`: 3 generations, 3 verifications, `verification.dropped` has the field, `needsReview` true
  - `unconfirmed only → no regeneration`
  - `schema fails twice then passes`: logged steps `generation, generation_retry, generation_retry, verification`
  - `first generation fails all tries → ExtractionFailed`
  - `regeneration fails all tries → previous document finalized, regenerationInvalid true`
  - `Jev invalid output → unconfirmed, logged invalid`
  - `Jev 402 → ProviderUnavailableError propagates`
  - `maxRegenerations 0 → one round, rejected fields dropped`
- [ ] **Step 4: Run.** Expected: FAIL.
- [ ] **Step 5: Implement** the interfaces above. Wire the module: `ExtractionModel` → `AiSdkExtractionModel(apiKey, config.extractionModel, pricing)`. `DecisionModel` is unchanged. Remove `DecisionService`/`ExtractionService` from the providers and from `createProcessorService`. Keep the startup `checkModels` on `@openrouter/sdk`.
- [ ] **Step 6: Run** the whole processor suite and `npx nx typecheck xjobs`. Expected: PASS, with no remaining `it.todo` from Task 4.
- [ ] **Step 7: Smoke** with `pnpm --filter @xjobs/xjobs processor:smoke` (needs the key in the user's env; if unavailable, say so and leave it for the human). Expected: both models answer.
- [ ] **Step 8: Commit** `feat(processor): generate with the AI SDK, verify with Jev, regenerate on rejection`.

### Task 8: Golden set and eval for the new flow

**Files:**

- Modify: `golden/golden.ts` (golden case types), `golden/score.ts`, `golden/import.ts`, `scripts/processor-eval.ts`, `scripts/processor-golden-draft.ts`, `golden/cases/*.json` (73 files)
- Create: `apps/xjobs/src/scripts/processor-golden-v2.ts` (one-off converter of the golden cases, kept in the repo as the record of the conversion)
- Test: `golden/score.spec.ts`, `golden/golden.spec.ts`

**Interfaces:**

- Golden `expected.requirements: { code: string; kind: 'main'|'must'|'nice'; domain: SkillDomain | null; years: { min, max } | null; group: string | null }[]`, `expected.groups`, `expected.yearsRequired: { min, max } | null`. Conversion: each `mainStack` group with one option → a standalone `main`; with several → a group with `min: 1`. `domain` and `years` are `null` with `drafted.requirements = true` until a human labels them. Scoring skips unlabeled `domain`/`years`.
- `summarize` adds: per closed field `{ confirmed, unconfirmed, rejected }` shares; `rejectionPrecision` (rejected generator values that were wrong per golden ÷ all rejected); `roundsPerJob`, `generatorCallsPerJob`, `verifierCallsPerJob`, `costPerJob`. Requirement scores: technology recall/precision on required (main + must) and on nice, kind accuracy, domain and years accuracy on labeled cases. `sureContradicted` is kept. The suggested threshold now reads confirmations: the lowest score at which `confirmed` answers are ≥ 98% right.
- `processor:eval` accepts `--generator <modelId>`, defaulting to config, so it can run once with Opus and once with DeepSeek, and writes `golden/last-report.<slug>.json`.

- [ ] **Step 1: Failing tests:** score a case where the generator lists Python standalone and the golden has Python|Go in a group → required recall 1/2 and precision 1/1. `rejectionPrecision` with 2 rejections, 1 wrong per golden → 0.5. Converting the `10317` case yields 5 requirements in 2 groups.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, run the converter over `golden/cases`, and check that `golden.spec.ts` loads all 73.
- [ ] **Step 4: Run** the golden tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processor): golden set and eval for generate-then-verify`.

### Task 9: Docs and final verification

**Files:**

- Modify: `apps/xjobs/src/modules/processor/README.md` (Flow table step 4, Models and cost, Tables: `requiredTags`/`niceTags` and the new steps, Eval), `.env.example` (the two new variables, commented, with defaults, and the comment on line 56 reworded to "Jev verification and the generator model"), `docs/superpowers/specs/2026-11-01-processor-design.md` (one line at the top: "Extraction flow superseded by 2026-11-07-generate-then-verify-design.md")

- [ ] **Step 1: Update the docs** as listed.
- [ ] **Step 2: Run** `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 3: Run** `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 4: Hand off** to the human with their run order: `processor:eval` with Opus and with DeepSeek, then set thresholds from the reports, then `db:reprocess -- --all-in-scope`. Claude does not run reprocessing on shared data.
- [ ] **Step 5: Commit** `docs(processor): generate-then-verify flow`.

# Processor: generate first, Jev verifies

Revises the extraction flow of `2026-11-01-processor-design.md`. Everything that spec says about scope, statuses, claims, the reuse key, budget, list tables and vocabulary stays, unless this document changes it.

## Intent

Today Jev goes first: it answers the closed questions, and Opus extracts the rest and re-answers the questions Jev was unsure about. `FactAssembler` merges the two. The result is a document where nobody checks the generator's closed answers, and where the cheap model's guesses are the default.

The new flow turns that around:

1. **A generator model** (Opus or DeepSeek, whichever `PROCESSOR_EXTRACTION_MODEL` names) writes the **whole** structured document, closed fields included, through the **Vercel AI SDK**, with retries until the output matches the schema.
2. **Jev verifies** the generator's closed fields against the posting and returns a confidence score for each.
3. **When Jev says a field is wrong**, the generator writes the document again, told which fields Jev rejected and why. Then Jev verifies again.
4. **Jev is the last judge.** After at most 2 regenerations, a field Jev still rejects is not stored: it becomes `unstated`/null, and the job is marked `needsReview`.

Why: a wrong `sure` fact causes the two worst failures of the product (applying to the wrong job, rejecting the right one). A second, independent model checking every closed fact catches those mistakes. And because it checks the strong model instead of being the default answer, the stored value is always one a strong model wrote and an independent model confirmed.

## Goals

- The generator answers every field. Jev answers no field on its own. It only verifies.
- The structured output goes through the Vercel AI SDK (`ai`, with `@openrouter/ai-sdk-provider`), using a Zod schema built from the **approved rows of the list tables**, and schema retries come from the SDK's structured-output handling.
- The model for each role comes from config only (`PROCESSOR_EXTRACTION_MODEL`, `PROCESSOR_DECISION_MODEL`). Switching Opus ↔ DeepSeek needs no code change.
- Every closed fact records the verdict Jev gave it and the score.
- Every model call (each generation, each schema retry, each verification) is logged in `processing_attempts` and counted against the daily budget.
- The processor's closed values come from the list tables everywhere. No leftover hard-coded enum decides a processor fact.
- The tech stack comes out as unified, per-technology requirements with domain, years, importance and a quote each, so matching can compare it with a profile's skills (§5a).

## Non-goals

- Jev verifying open-ended facts (stack, salary, openings, quotes, languages, work authorization). They have no fixed options for Jev to choose between. They keep today's quote, evidence and consistency checks, and stay generator-only.
- Moving Jev onto the AI SDK. Jev is served by OpenRouter's Decisions API, which the AI SDK does not wrap. Jev stays on `@openrouter/sdk` (`models/decision.model.ts`).
- Removing the profile enums (`Position`, `Seniority`, `Engagement`, `Arrangement`). That is steps 2 and 3 of `2026-11-05-preferences-and-eligibility-design.md`, which already owns it. This design only makes sure the processor side reads the tables (see §6).
- Changing scope, statuses, sweeper, claims or the failure table beyond the new step names.

## Anti-goals

- **A rejected value stored as fact.** If Jev still rejects a field after the last round, the value is dropped, never kept "because the generator insisted".
- **Regenerating forever, or silent spend.** Rounds and generator calls per job have hard caps (§3), and every call is logged with its cost.
- **Jev's pick silently replacing the generator's.** Jev judges. It does not write values. A disagreement leads to regeneration or to `unstated`, never to Jev's answer being stored.
- **Enum drift.** The generator's schema and Jev's options must come from the same approved rows, read once per job.

## Design

### 1. Flow of one job

`ExtractionPipeline.run(input, vocabulary, log)` becomes:

```
round = 0
doc   = generate(input, vocabulary, feedback = none)          // §2
loop:
  verdicts = verify(doc, input, vocabulary)                   // §3
  if no field is rejected: return finalize(doc, verdicts)     // §4
  if round == MAX_REGENERATIONS: return finalize(doc, verdicts, dropRejected = true)
  round += 1
  doc = generate(input, vocabulary, feedback = rejections(verdicts))
```

`DecisionService` (Jev answers first) and the `fallback` part of the model output schema are removed. `FactAssembler` stays: it still does the quote and evidence checks, maps terms to list codes and builds the final shape. It now runs on each generated document **before** verification, so Jev only sees documents that are valid. An `ExtractionInvalidError` from the assembler counts as a schema failure of that generation (§2).

### 2. Generation (Vercel AI SDK)

- `models/extraction.model.ts` is rewritten on the AI SDK: `ai` 7.x with `@openrouter/ai-sdk-provider` 3.x (current at writing: `ai@7.0.164`, provider `3.1.0`, which accepts zod `^4.1.8`). The model is `openrouter(config.extractionModel)`. Nothing in code names Opus or DeepSeek.
- The schema is today's `modelOutputSchema(options)`, without the `fallback` object. It is a Zod schema whose enums come from the approved list rows. The SDK gets the Zod schema directly. Whether `flattenForStrict` is still needed depends on what the provider sends; the builder keeps it only if a strict-mode provider rejects the SDK's schema.
- **Schema retries:** a generation is up to **3 tries**. A try that fails the Zod schema, or fails the assembler, is retried with its validation errors added to the prompt. Use the SDK's structured-output failure (`NoObjectGeneratedError`, the repair hook, or whatever its v7 equivalent is) rather than hand-parsing JSON. After 3 failed tries the job fails as "output invalid", as it does today after 2.
- **Transport retries stay off** (`maxRetries: 0`). The failure policy owns transient errors (408, 429, 5xx → `pending` until `PROCESSOR_MAX_ATTEMPTS`), and a hidden SDK retry would double-spend outside the log. _(my call)_ `toModelError` maps the SDK's errors (`APICallError` status codes) to the same classes as today: 401/402/403 provider unavailable, 408/429/5xx transient, other 4xx request error, unreadable output an output error.
- **Routing:** keep `provider.require_parameters: true` (through the provider's extra body or settings) so no route ignores the schema. The startup check that the model supports `response_format`/`structured_outputs` and has a price stays.
- **Cost:** request OpenRouter usage accounting (`usage: { include: true }`) and read `cost` from the provider metadata. When it is missing, estimate it from list prices, as today.
- **Feedback on regeneration:** the prompt gets a section listing each rejected field: the generator's last value, Jev's pick, Jev's score and the field's question. It tells the generator to re-read the posting for those fields, and that `unstated` is allowed. It does **not** tell it to copy Jev's pick.

### 3. Verification (Jev)

- One Decisions API call per round, with one question per closed field. The fields are `arrangement`, `seniority`, `roleKind`, `contractType`, `engagement`, `isSoftwareEngineeringRole`, `sponsorshipOffered`, and one per approved junk flag.
- **Every question is a `choice`**, with the same options the generator's schema allowed (the approved codes, `unstated` included where the list has it). Booleans and junk flags are asked as a choice of `yes` / `no`. Jev's yes/no (`noul`) answers carry no confidence, so a choice is the only way to get a score. `rules/questions.ts` keeps the question wording and is rebuilt on this rule.
- Jev answers independently: the question does not show the generator's value. Its pick is then compared with the generator's value:

| Jev's pick vs. the generator's value | score ≥ threshold | score < threshold |
| ------------------------------------ | ----------------- | ----------------- |
| same                                 | `confirmed`       | `unconfirmed`     |
| different                            | `rejected`        | `unconfirmed`     |

- Thresholds stay in `config/thresholds.ts`, keyed by the pinned decision model, and now mean "minimum score for a verdict". An unknown model or key has no threshold, so every field comes back `unconfirmed`, with today's once-per-process warning.
- **Only `rejected` triggers a regeneration.** _(my call)_ A low score means Jev can't tell, and a new generation can't fix that. An `unconfirmed` field keeps the generator's value with `confidence: 'unsure'`. The job is marked `needsReview` only if that field is one qualify filters on (`arrangement`, `seniority`, `roleKind`, `contractType`, `engagement`, `isSoftwareEngineeringRole`).
- **Re-verifying after a regeneration:** fields whose value did not change and were `confirmed` keep their verdict and aren't asked again. Every other closed field is asked again. _(my call: saves a Jev call's worth of questions, and an unchanged confirmed value has nothing new for Jev to judge)_
- Jev output that is unusable (missing questions, an option never offered) makes the affected fields `unconfirmed` and is logged `invalid`, as today. A Jev provider or transport error ends the run through the failure policy, as today.
- **Null values** _(my call)_: every Jev question includes `unstated` as an option, booleans included (`yes` / `no` / `unstated`). A generator null is compared as `unstated`. So "the posting doesn't say" is verified like any other value, and a null never counts as "different" by default.
- **Junk flags, one verdict per flag** _(my call)_: for each approved flag, the generator's answer is "yes" if the flag is in its `junkFlags` array and "no" otherwise. Jev's yes/no pick is compared with that. A flag the generator included that Jev rejects, or a flag it left out that Jev says applies, is a rejection and triggers a regeneration. After the last round, a rejected flag the generator included is removed from the array. A flag Jev wants that the generator never included is not added, because Jev doesn't write values, but it is recorded in the `verification` summary and sets `needsReview`. The rest of the array stays.
- **Ingest evidence** _(my call)_: the generator sees the LinkedIn evidence as context, as today. `resolve-facts.ts`'s fill (`contractType`/`seniority` from ingest when the model says `unstated`) still runs **before** verification, so Jev verifies the ingest-filled value like any other, and it keeps `decidedBy: 'ingest'`. The "distrust Jev when it contradicts evidence" rule is removed, since Jev no longer supplies values. A value dropped after the last round is **never** refilled from ingest. Dropped means dropped.
- **Arrangement and openings** _(my call)_: `openings[].arrangements` is open-ended and is not verified on its own. When the top-level `arrangement` is finally rejected, every opening gets `confidence: 'unsure'` (its arrangements stay, since the schema needs at least one), and the job is `needsReview`. So qualify never treats a rejected arrangement as `sure` through the openings. When `arrangement` is confirmed and an opening's arrangements don't include it, that is recorded as an evidence conflict, as today's consistency check does.

### 4. Finalizing

- `confirmed`: value kept, `confidence: 'sure'`, `score` = Jev's score.
- `unconfirmed`: value kept, `confidence: 'unsure'`, `score` = Jev's score (or null when Jev gave none).
- `rejected` after the last round: value set to null (`unstated` for lists that have it), `confidence: 'unsure'`, the quote cleared, `needsReview = true`.
- Every fact keeps a `verification` record: `{ verdict, score, jevPick, rounds }`. The document gets a top-level `verification` summary: rounds used, and per finally-rejected field the generator's last value and Jev's pick. This is the reason qualify needs so a wrong drop can be found and fixed later.
- The ingest evidence checks (`rules/evidence.ts`) still run and can still mark conflicts. They are separate from Jev's verdict.
- **`needsReview`** stays computed from the document by `rules/validate.ts`. Today's rule (any of arrangement, openings, seniority, roleKind, contractType or mainStack unsure, or any conflict) is kept, and these are **added** to it: any finally-rejected field or junk flag, and an `unconfirmed` `engagement` or `isSoftwareEngineeringRole`. _(my call: a union, so no job leaves the review lane it would be in today)_
- **A regeneration that fails all its schema tries** _(my call)_: the run does not fail. It finalizes the last valid document with that round's verdicts, rejected fields dropped as after the last round, and records `regenerationInvalid` in the `verification` summary. Only a first generation that never produces a valid document fails the job as "output invalid".
- **Budget mid-job** _(my call)_: `ProcessorGuard` is checked before claiming, as today, and a claimed job runs to the end. The budget can be overshot by at most one job's worst case per concurrent worker. That is cheaper than restarting a half-paid job from its first generation.

### 5. Data shape and contract changes

- **Fact envelope** (`schema/fact.ts`): `decidedBy` becomes `'ingest' | 'generator'`, and `model` keeps the exact model ID that wrote it, so Opus vs. DeepSeek stays visible without being baked into an enum. A `verification` field is added (nullable, null for open-ended and ingest facts). `SCHEMA_VERSION` is bumped. Old rows stay readable as they are: `data` is append-only JSON, and nothing rewrites history.
- **`processing_attempts.step`:** the check becomes `step IN ('decision', 'extraction', 'extraction_retry', 'generation', 'generation_retry', 'verification')`. The old values stay allowed for existing rows. New runs write only the new three. The change goes in `contract.prisma` with a migration.
- **`job_extractions`:** `decisionModel` and `extractionModel` keep their names and their place in the reuse key (they now mean verifier and generator). _(my call: renaming touches the reuse index and every query, for no behavior change)_ The typed columns are filled from the finalized document as today, so a dropped field is null in its column.
- **Prompt and schema bump:** the new prompt hash and schema version change the reuse key, so every job is processed again on its next run. After the eval passes, run `db:reprocess -- --all-in-scope`.

### 5a. Tech stack: unified requirements, ready for skill matching

Matching compares a job's stack with a profile's `ProfileSkill` rows (`technology` as a `tech_tags` code, `domain`, `mastery` 0–10, `importance` 0–10). Today's `techStack` (`mainStack` / `mustHaves` / `niceToHaves` groups of `anyOf` terms, one quote for the whole stack) has no domain, no years per skill, and no quote per skill, and its typed columns mix required and nice-to-have tags. It is replaced by:

```ts
techStack: {                       // still one fact envelope; its quote is unused ("")
  value: {
    requirements: [
      {
        technology: { text: string, code: string | null }, // one technology; code resolved to tech_tags as today
        kind:       'main' | 'must' | 'nice',
        importance: number,         // integer 1–10, output by the model, checked against kind
        domain:     SkillDomain | null,  // backend | frontend | fullstack | mobile | devops | data | ml | security | qa
        years:      { min: number | null, max: number | null } | null,
        quote:      string,         // the sentence this requirement comes from
        confidence: 'sure' | 'unsure',
        group:      string | null,  // requirements sharing a group are alternatives
      },
    ],
    groups: [{ id: string, min: number }], // "Python, TypeScript or Go" → one group, min 1; "two of …" → min 2
  },
  confidence, decidedBy, score, model, verification: null,
}
```

Rules (agreed in the design discussion unless marked _(my call)_):

- **One technology per requirement.** Alternatives are separate requirements that share a `group`. A requirement with `group: null` is needed on its own. A group is satisfied when `min` of its members are.
- **`mainStack` is folded in** as `kind: 'main'`: the languages or frameworks the role is mostly written in, with the same prompt rules as today's `mainStack`. `mustHaves` → `kind: 'must'`, `niceToHaves` → `kind: 'nice'`.
- **`importance` is part of the structured output schema.** The model sets it per requirement as an integer on a scale of 1 to 10 (10 = most important; a requirement is never 0, since it is in the posting at all), comparable with `ProfileSkill.importance` (0–10), judging from the posting's emphasis (repeated, "strong", "expert", core to the duties → higher). Nice-to-haves always rank below required skills, so matching scores a missing one as a small penalty, never a rejection. The bands, enforced by the assembler _(my call)_: `main` 8–10, `must` 5–9, `nice` 1–4. A value outside its kind's band is invalid output and goes to the schema retry (§2). The prompt states the bands and gives examples.
- **`domain`** uses the contract's `SkillDomain` codes (the same values `ProfileSkill.domain` uses, which the eligibility spec keeps as an enum). It is null when the posting doesn't tie the skill to a domain. Matching then accepts any domain for that skill.
- **`years` is `{ min, max }`.** "3+ years" → `{ min: 3, max: null }`, "3–5 years" → `{ min: 3, max: 5 }`, not stated → `null`. `max` is never below `min`.
- **Job-level `yearsRequired`** becomes the same `{ min, max }` object, so both levels read alike. _(my call)_
- **Quote per requirement (the preventive fix).** The quote check runs on each requirement separately. A requirement whose quote isn't found in the posting gets its quote cleared and `confidence: 'unsure'`. The rest of the stack stays untouched, and nothing is dropped silently. A `main` requirement that is `unsure` sets `needsReview` (it replaces "mainStack unsure" in today's rule).
- **Assembler checks** (invalid output → schema retry, §2): every non-null `group` names an entry in `groups`; each group has at least 2 members and `1 ≤ min ≤` its member count; members of one group share a `kind`; the same `(technology.code, domain)` appears only once; `importance` is an integer inside its kind's band.
- **Not verified by Jev.** The stack is open-ended (§ Non-goals). It relies on per-requirement quotes and the eval.
- **Typed columns on `job_extractions`:** `techTags` (all codes, as today), `mainStackTags` (`kind: 'main'`, as today), plus new `requiredTags` (main + must) and `niceTags` (nice), each `String[]` with a GIN index, added through the contract. Codes only. An unresolved term (`code: null`) stays in `data` and is proposed as a term as today, but appears in no column until it's approved and the job is reprocessed.
- **Prompt:** the `mainStack` and `mustHaves`/`niceToHaves` sections of `prompts/system.prompt.ts` are rewritten for this shape, with today's examples carried over ("Python, TypeScript or Go" → three requirements in one group).
- **Golden set:** the golden cases' expected stacks are converted to the new shape (mechanically where possible, `domain` and `years` labeled by hand), and the eval scores tech stack per requirement: technology, kind, domain and years.

### 6. Enums and the list tables

What the check of the contract on 2026-11-07 found, and what this work does about it:

- **Already from the tables:** the generator's Zod enums (`schema/model-output.ts` builds them from the approved rows) and Jev's options (`rules/questions.ts`). Keep both, and build both from the **same** `Vocabulary` snapshot loaded once per job. A test asserts that each closed field's schema enum and its Jev options are the same set.
- **Still from a hard-coded enum:** `rules/validate.ts` builds `ENGINEERING_CODES` from the `Position` enum. It switches to `role_kinds.isEngineering` (added by the eligibility work). `VocabRepository` loads that column into the `Vocabulary`, and the in-memory test vocabulary carries it. Without this change, a role kind approved later (or one of `support`, `devrel`, … that `Position` lacks) would fail the role-kind/engineering consistency check.
- **Hard-coded on purpose:** `sponsorshipOffered` (`yes`/`no`/`unstated`), `placeStrictness`, salary period and language level are not list tables and stay in code.
- **Profile enums** (`Profile.position`/`engagements`/`seniorities`, `QuerySearchBuilder.experience`/`type`) still drift from the tables (`role_kinds` has codes `Position` lacks, and `engagements` has `unstated`). This is owned by the eligibility spec's switch and remove steps. It is not done here, but **matching must not ship comparing those enum columns to extraction codes**. It must read the new code columns.

### 7. Config

Unchanged: `PROCESSOR_EXTRACTION_MODEL` (Opus, e.g. `anthropic/claude-opus-5.5`, or DeepSeek, e.g. `deepseek/deepseek-v4.1-flash-1017`) and `PROCESSOR_DECISION_MODEL` (`typesafe/jev-1.14`).

New, with defaults _(my call)_:

- `PROCESSOR_MAX_REGENERATIONS=2`: the rounds after the first generation.
- `PROCESSOR_GENERATION_TRIES=3`: schema tries per generation.

Worst case per job: 3 generations × 3 tries = 9 generator calls, plus 3 Jev calls. The daily budget is the ceiling, and the eval reports the real average.

### 8. Eval

`processor:eval` runs the new flow over the golden set and reports, in addition to today's report:

- per closed field: the share `confirmed` / `unconfirmed` / `rejected`, and the final accuracy against golden values;
- **Jev's rejection precision:** of the generator values Jev rejected, how many were actually wrong (by golden). This shows whether Jev as last judge drops right answers, which would mean missing the right jobs;
- rounds per job, and generator and Jev calls per job, with the cost per job, for each generator model run (run once with Opus and once with DeepSeek);
- `sureContradicted` as today, which must not get worse than the current flow's.

The threshold per field is set from this report: the lowest score at which Jev's confirmations are ≥ 98% correct.

## What's left to the builder

- The exact AI SDK v7 call (`generateObject` vs. `generateText` with structured output) and how the schema-retry loop wraps it, as long as §2's behavior holds.
- How the regeneration feedback is worded in the prompt.
- Whether `flattenForStrict` survives.
- The order of tasks, and how the existing tests for `DecisionService`/fallback are retired.
- TypeScript names for the verdict types.

## Verification

- Unit tests for the loop: confirmed first time (1 generation, 1 Jev call); rejected then fixed; rejected twice and dropped (`needsReview`, value null, reason recorded, not refilled from ingest); unconfirmed kept as unsure; schema fails twice then passes; first generation fails 3 times → output invalid; a regeneration fails 3 times → last valid document finalized; Jev invalid output → unconfirmed; provider 402 during verification → provider unavailable; a junk flag rejected then removed; a rejected arrangement makes every opening unsure; a generator null compared as `unstated`.
- The enum/options equality test from §6, and the `isEngineering` switch test.
- Tech stack: alternatives in one group, `min: 2` groups, a standalone requirement, a bad quote making only its own requirement unsure, a group with an unknown id or `min` above its size → invalid, a `nice` requirement with importance 6 → invalid, `years` with `max < min` → invalid, and the new `requiredTags`/`niceTags` columns filled correctly.
- The contract migration applies, and old `step` values still insert.
- `processor:eval` with both generator models, results compared with the current flow before reprocessing.
- `npx nx run-many -t lint test build typecheck` green.

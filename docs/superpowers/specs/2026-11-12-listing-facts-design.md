# Listing facts, combined facts and matching gaps (Phase 3, slice 02)

Date: 2026-11-12
Status: approved
Roadmap: [02-listing-facts](../../roadmap/phase-3-find-quality/02-listing-facts.md)
Builds on: [slice 01, harvestapi](2026-11-11-linkedin-source-harvestapi-design.md) (PR 52)
Absorbs: Phase 2 slices [08 match languages](../../roadmap/phase-2-find/08-match-languages.md) and [09 match work authorization](../../roadmap/phase-2-find/09-match-work-authorization.md)
Followed by: [03 processor quality](../../roadmap/phase-3-find-quality/03-processor-quality.md), right after this slice _(user)_

## Intent

The first real results on `10xjobs-dev` were poor, and the cause is structural. The enrichment and matching layers are entangled:

- The processor reads LinkedIn's listing fields alongside the description.
- It quietly fills gaps from them, and blends the result into one extraction document.
- The matcher reads that document without knowing which values were stated and which were guessed.
- That is where "Worldwide" on Casablanca jobs comes from. It's also why a seniority taken from LinkedIn's "Mid-Senior level" can reject a job, and why `needsReview` fires on 59 of 60 jobs.

This slice separates the layers:

1. **The processor reads only the job title and description.** It says what the description states, or `unstated`.
2. **LinkedIn's values stay LinkedIn's** (`normalized_jobs`), as slice 01 stored them.
3. **A new deterministic step combines the two** into one set of facts per job. The description wins whenever it states a fact. Every disagreement is stored as a conflict.
4. **The matcher reads only the combined facts.**

It also closes the gaps between what users set in their preferences and what the matcher checks. Today only position, seniority, location and stack are checked. And it changes one principle: **an `unsure` fact never rejects a job.** A job that would be rejected only on unsure facts goes to the user's review list instead.

Only the LinkedIn job board matters for now _(user)_. Ashby, Greenhouse and LinkedIn posts are left as they are.

## Goals

- The processor's input is the title and the description, nothing else. Its prompt, input hash, golden set and preview endpoint carry no listing data.
- A combined-facts row per job, built by code from the latest extraction and the job's LinkedIn values, with conflicts recorded.
- A shared place resolver (names, aliases, accent-insensitive) used by both the listing and the processor's cities.
- The matcher reads combined facts. It re-decides a job when its combined facts change, when a profile or the user's work authorization changes, or when a city is approved or aliased.
- New match rules: contract type, salary and currency, required languages, posting language, work authorization.
- A third match outcome, `review`. Each user decides on their own review items. Any user can report a fact as wrong, and reports are only logged.
- A recheck command that lists LinkedIn place values that didn't map, so the mapping tables can be checked once collection resumes.

## Non-goals

- **Processor quality** (slice 03): unsure rates, tech-stack coverage, the model's own place mistakes, what `needsReview` means, the verifier's cost. This slice only removes listing data from the prompt.
- **Acting on mismatch reports.** They're logged only. The processor, the combined facts and the matcher ignore them _(user)_.
- **Search precision** (slice 04).
- **Ashby, Greenhouse and LinkedIn posts.** The matcher keeps matching LinkedIn job board jobs only _(user)_.
- **Notice period.** Postings almost never state a start date, so it isn't matched _(my call)_.
- **Engagement and junk flags in matching.** The processor doesn't read them reliably yet (engagement is unsure on 44 of 60 and dropped on 29, junk flags are unsure on 60 of 60). Slice 03 decides whether they come back _(user)_.
- **Old cheap_scraper jobs.** No `db:renormalize`. They have no structured LinkedIn fields, so their combined facts come from the extraction alone.
- **New Apify runs.** The account is out of credit. Everything is built and tested against the 96 items and the fixtures.

## Anti-goals

- **Wrong jobs through.** A job reaching Matches because a fact the listing knew was left unknown.
- **Right jobs rejected on a guess.** Any rejection resting on an `unsure` value.
- **A flooded review list.** Review must be the exception _(user)_. This slice measures the review share; slice 03 brings it down.
- **Merging the two kinds of fact.** LinkedIn's values and the processor's values never share a field. The combined facts are a third, derived record, never written back into either.
- **Guessed places.** A place that doesn't map falls back to its country, or to no place.

## Sources and how they combine

### Which LinkedIn fields count

LinkedIn's value is the default for matching **only** for these fields, and only when the description is silent _(user)_:

| Fact        | LinkedIn field                              | Notes                                 |
| ----------- | ------------------------------------------- | ------------------------------------- |
| Arrangement | `workplaceType`                             | 91 of 96 items                        |
| Place       | `location.parsed` (+ `geoId`)               | 96 of 96 items                        |
| Salary      | `salary`, when `providedByEmployer` is true | 8 of 96 items, all employer-provided  |
| Closed      | `expireAt`                                  | The only closed signal a search gives |

A LinkedIn default counts like any other value: it can pass or reject a job _(user: "either yes or no, no middle ground")_.

Every other LinkedIn field is display only. That includes `employmentType`, `experienceLevel`, sector, company, applicants and poster. Seniority stays conflict-only: LinkedIn's value is compared, never used.

### Rule per fact

The description wins whenever it states the fact. LinkedIn fills a gap only for the four fields above. Every disagreement is recorded as a conflict _(user)_.

| Fact                                                                                                  | From the description                                | From LinkedIn              | Combined                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| Arrangement                                                                                           | the openings' arrangements, top-level `arrangement` | `workplaceType`            | description, else LinkedIn                                         |
| Places                                                                                                | openings                                            | `location.parsed`          | description openings, else one opening built from LinkedIn (below) |
| Salary                                                                                                | `salary`                                            | employer-provided `salary` | description, else LinkedIn                                         |
| Closed                                                                                                | none                                                | `expireAt` passed          | LinkedIn                                                           |
| Seniority                                                                                             | `seniority`                                         | `experienceLevel`          | description only. A disagreement is a conflict                     |
| Contract type                                                                                         | `contractType`                                      | `employmentType`           | description only. A disagreement is a conflict                     |
| Everything else the matcher reads (position, years, stack, languages, work authorization, time zones) | processor                                           | none                       | processor                                                          |

**What counts as a disagreement:**

- **Seniority and contract type.** LinkedIn's values are broad, so a disagreement is a description value outside the set LinkedIn's value allows. The existing tables in `processor/config/evidence.ts` define those sets (`Mid-Senior level` allows mid through principal; `Contract` allows contract and freelance), and they move into the combined-facts code. `senior` against `Mid-Senior level` isn't a conflict. `junior` against it is.
- **Arrangement.** Disagreement when LinkedIn's arrangement isn't among the description's stated arrangements.
- **Places.** Disagreement when none of the description's places overlaps LinkedIn's place, using the place hierarchy (a city is inside its country, a country inside its regions). A description that names a different place from LinkedIn is a conflict, not a second opening _(my call; the user agreed the description wins)_.
- **Salary.** Disagreement when both state a salary and either the currency differs or the ranges don't overlap.

A conflict row stores:

- the field
- LinkedIn's value
- the description's value
- the description's quote
- which one won
- the job and extraction ids

**LinkedIn's location is not a location requirement** _(user)_. It says where the job is listed. In the combined facts it becomes a `label` opening, compared with the places the user is open to. A remote job listed as "United States" passes a user open to US remote. A location requirement ("must be based in", "US residents only") is a `limit`, and only the processor can find it, in the description. Work authorization is the same: description only, and a LinkedIn place is never an authorization requirement.

### The listing opening

Built by code when the description's openings carry no place and no time zone, which is today's "listing as a last resort" case:

- **Arrangement.** `workplaceType` mapped `remote`/`hybrid`/`on_site` to `remote`/`hybrid`/`onsite`. Missing means the description's arrangement if stated, else `unstated`.
- **Place,** through the place resolver (below) from `location.parsed`:
  - `regionCode` → our region code;
  - otherwise a city that resolves → that city;
  - otherwise the country code;
  - otherwise no place.
- **Strictness** `label`, no time zones, and a quote naming the source.
- When the description states the arrangement but no place, the listing supplies only the place, and the description's arrangement stands.

### Closed

A job whose `expiresAt` has passed is closed for matching. It leaves the matchable set, so it isn't decided again. Its existing match rows and review decisions stay, and the matches page shows it as closed, as it does today for a closed job _(my call: on main, closed jobs keep their rows, and only merged jobs' rows are deleted)_. It doesn't change `normalized_jobs.closed`. That stays `mergeSources`' ATS rule. The combined facts carry `closed` _(my call: keeps slice 01's "closing from LinkedIn is a matching decision" split)_.

## Places

### The place resolver

One function, used by the listing opening and by the processor's city step:

- **Region codes.** A map from LinkedIn's region codes to ours. The ones seen so far: `EU` → `EU`, `EMEA` → `EMEA`, `NAMER` → `NORTH_AMERICA`. Region `geoId`s from slice 01's table (`91000000` EU, `91000002` EEA, `91000007` EMEA, and so on) map the same way. An unknown region code gives no place.
- **Countries.** `location.parsed.countryCode`, upper case. The location's top-level `countryCode` is not read: it is `"oo"` for regions.
- **Cities.** Matched by country and by name **or alias**, ignoring case and accents. "Fes" finds Fès, "Wien" finds Vienna.
  - The listing never creates a city. One that doesn't resolve falls back to the country _(user)_.
  - The processor's cities stay free text from the model _(user)_. They're created as `proposed` when unknown, as today, but resolved through aliases first, so a known city is never duplicated.
- **State-only texts** ("California, United States", "Casablanca-Settat, Morocco") give the country.

### Seed data

From the Moroccan texts on `10xjobs-dev` (old cheap_scraper jobs; none of the 96 harvest items is Moroccan):

| LinkedIn spelling                                      | Our city               |
| ------------------------------------------------------ | ---------------------- |
| Mechouar; Prefecture of Casablanca                     | Casablanca (aliases)   |
| Fez                                                    | Fès (alias)            |
| Marrakesh                                              | Marrakech (alias)      |
| Salé El Jadida                                         | Salé (alias)           |
| Tangier, Agadir, Meknes, Oujda, Mohammedia, Ben Guerir | new approved MA cities |

Approve the proposed Moroccan cities that occur (Fès, Marrakech, Salé, Tétouan). Accent folding also covers "Velizy" / "Vélizy" and "La Defense" / "La Défense", but those are only added if they're in the city list.

### Recheck

A command lists the LinkedIn place values from the last N days that fell back to a country or to no place, grouped by text and count. The user then approves or aliases them with `db:vocab`.

Moroccan texts matter most here, because how harvestapi parses them (`parsed.city` "Mechouar" or empty) hasn't been seen yet. The recheck is run when collection resumes. Approving or aliasing a city re-decides the jobs that name it.

## The processor change

Remove every way listing data reaches the processor:

- **The input.** The input becomes title and description only. `Evidence`, `PostingInput.evidence` and `companyName` go (`models/types.ts`, `rules/input.ts`, `repositories/processor.repository.ts` `evidenceOf`).
  - The quote check's haystack becomes title plus description.
  - Removing the company name is _my call_: it's listing data, and the processor should see only what the description says.
- **The prompts.** In both the generator and the verifier prompts (`models/extraction.model.ts`, `models/decision.model.ts`), these go:
  - the `Company:` line;
  - the "Listing metadata" block;
  - every rule in `prompts/system.prompt.ts` that mentions the listing: the input paragraph, the quote rule, `fromListing` in the openings path, "Listing metadata as a last resort", and the salary line.
- **The combining code.** `config/evidence.ts` and `rules/evidence.ts` move to the combined-facts step. So do the listing parts of `rules/resolve-facts.ts` (`withIngest`, `resolveSalary`'s listing branch, `fromListing` openings).
- **The schema.** `fromListing`, `decidedBy: 'ingest'` and the document's `conflicts` leave it. Bump `EXTRACTION_SCHEMA_VERSION` to 3. Stored v2 documents must still parse, or be read only through the combined facts. The builder decides which.
- **`needsReview`.** It stops counting conflicts and listing openings. Otherwise it's unchanged; its meaning is slice 03's.
- **Preview and golden set.** The preview DTO and controller lose their `location`, `contractType` and `experienceLevel` fields. The golden set drops `evidence` and its `ingestShare` metric. Golden expectations for cases whose openings came from the listing are re-labelled to the description-only answer (for example case 10317).
- **Places.** Typed columns' region-to-country expansion (`rules/typed-columns.ts`) is dropped if nothing reads it. The builder checks `users` and `queries` for readers first. The matcher's own expansion is the one that's kept.

**Reprocessing.** Every input hash changes, so no earlier extraction is reused.

- On dev, only 60 jobs are `processed`: about $0.50 to redo with `db:reprocess -- --all-in-scope`, run by hand after deploy.
- The other 3,988 are a stalled `pending` backlog of old cheap_scraper jobs, about $33 at today's cost. Whether to work through that backlog is a separate decision. This slice changes nothing about it, and nothing reprocesses automatically.

## The combined facts

### Storage

Two new engine-only tables. They're shared, not user-scoped, like the other ingest and processor tables: RLS on, no policies. Names are the builder's.

- **`job_facts`.** One row per job, rebuilt whenever its inputs change. It stores:
  - the extraction id and the LinkedIn record version it was built from;
  - a `FACTS_VERSION` (the rule set's version);
  - per fact the value, its confidence and its source (`description` or `linkedin`), plus the quote;
  - `closed`.

  It holds every fact the matcher reads: openings (places with resolved city ids, strictness, time zones), arrangement, position and is-software-engineering, seniority and years required, contract type, salary, required languages, work authorization and sponsorship, tech stack, and posting language (below).

- **`job_fact_conflicts`.** The conflict rows described above.

**When it's built.**

- After each extraction is saved.
- After ingest changes a job's LinkedIn values.
- When the expiry passes. The builder chooses between a periodic sweep and computing it at match time.
- On a `FACTS_VERSION` bump, by a sweep like the matcher's.

Building is pure code and costs nothing, so a rebuild is cheap.

**Posting language.** Detected by code from the description, with no model and no reprocessing _(my call)_. The builder picks a maintained detector library. It's stored on `job_facts` with its confidence. Below the detector's confidence threshold, or on a very short text, the value is `unknown`. A bilingual posting records every language that makes up a real share of the text, with one stray English line not counting. The share threshold is the builder's call, tested on the fixtures.

## Matching

### What the matcher reads

Only `job_facts` (plus profiles, user eligibility and vocabulary). It no longer re-parses `job_extractions.data`. `JobMatch.extractionId` stays for traceability, and a `factsVersion` or facts reference is added, so a stale row is any row decided on older facts.

### Outcomes

Today: `qualified` (optionally `unverified`) or `rejected`.

New, a third outcome: **`review`**.

- Any rule that fails on a **sure** value → `rejected`, as today.
- Otherwise, any rule that fails only because of an **unsure** value → `review`. The check records which rule and which fact.
- Otherwise → `qualified`, with `unverified` when a check is unknown or rests on an unsure value, as today.

Each rule now returns whether its result rests on an unsure value. A LinkedIn default counts as sure.

### Rules

Existing rules (position, seniority, location, stack) keep their logic, except that a failure resting on an unsure value becomes a review. The new rules:

| Rule                    | Pass                                                                                                  | Fail                                                                               | Unknown                                            | Review                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| **Contract type**       | in the profile's `contractTypes`                                                                      | not in it                                                                          | `unstated`                                         | unsure and not in it                       |
| **Salary**              | best pay ≥ the profile's minimum                                                                      | best pay below the minimum by more than 10%                                        | no salary, can't convert, or within the 10% margin | unsure and would fail                      |
| **Accepted currencies** | currency accepted, or the profile accepts any                                                         | currency not in the list                                                           | no currency stated                                 | unsure and would fail                      |
| **Required languages**  | every required language held at or above its level                                                    | one missing, or held at a lower level (working < fluent < native)                  | none stated                                        | unsure and would fail                      |
| **Posting language**    | the profile speaks one of the posting's languages, at any level                                       | it speaks none of them _(user: a deal breaker)_                                    | detector unsure or text too short                  | none (the detector's own doubt is unknown) |
| **Work authorization**  | the user meets every requirement (kind and place, through the place hierarchy and `residenceCountry`) | one isn't met, and the job doesn't offer sponsorship or the user doesn't accept it | none stated                                        | unsure and would fail                      |

**Salary details** _(user: convert with exchange rates and standard hours)_:

- **Best pay.** The job's max, or its min when there's no max, converted to the profile's currency and period _(my call)_.
- **Standard hours:** 8 hours a day, 40 a week, 2,080 a year; a month is a year ÷ 12 _(my call)_.
- **Exchange rates.** A small rates table, refreshed daily from a free public source that covers MAD. The last good rates are used when a refresh fails.
  - The builder picks the source, and must confirm it covers MAD, EUR, USD and GBP.
  - An unknown currency can't be converted, so the result is unknown.
- **The 10% margin** absorbs exchange-rate and rounding noise, in favour of not missing the right jobs _(my call)_.
- **LinkedIn salary period.** `HOURLY`, `DAILY`, `MONTHLY` and `YEARLY` map to `hour`, `day`, `month` and `year`. Anything else drops the LinkedIn salary.
- **Currency.** A currency outside a fixed ISO 4217 list, from either source, is dropped. The amounts stay, and the currency becomes null _(my call)_.

**Work authorization** follows the Phase 2 slice 09 brief:

- Eligibility is per user (`work_authorizations`, `residenceCountry`, `acceptsSponsorship`) and is loaded with the profile.
- It's checked only against requirements the description states. A place mention is never a requirement.
- **What meets a requirement** _(my call)_, for a place the user's authorization covers through the place hierarchy:

  | Requirement   | Met by                                        |
  | ------------- | --------------------------------------------- |
  | `citizenship` | citizenship                                   |
  | `work-permit` | work permit or citizenship                    |
  | `residency`   | residency, citizenship, or `residenceCountry` |
  | `clearance`   | clearance                                     |

- **Sponsorship.** An unmet requirement fails unless the job says `sponsorship: yes` and the user's `acceptsSponsorship` is true. A job silent on sponsorship counts as no sponsorship, and so does `acceptsSponsorship` null _(my call: a stated requirement the user doesn't meet is a sure fact)_. `citizenship` and `clearance` can't be sponsored, so they fail whatever the sponsorship.
- **Required languages:** the prompt already leaves out languages stated as a plus ("A language described as a plus is not required"), so a missing required language is a real requirement.

**Not built here:** the Rejected view (Phase 2 slice 05).

**Not matched:**

- engagement and junk flags (see Non-goals);
- notice period;
- `contractMonths`, since no preference reads it.

### Re-matching

A job is re-decided for a profile when any of these changes:

- the job's `job_facts` (a new extraction, new LinkedIn values, the expiry passing, a `FACTS_VERSION` bump);
- the profile: each decision records the profile's `updatedAt`, and a row decided before it is stale. That's all this slice takes from Phase 2 slice 07 (no recent-window rules, and no explaining old decisions after an edit) _(my call)_;
- the user's work authorization, residence or sponsorship. The web app writes `work_authorizations` straight to Supabase, and a deleted row leaves no trace. So a per-user eligibility version is bumped by a database trigger on any insert, update or delete of those rows and those user columns, and each decision records the version it read _(my call)_;
- a city approval, alias or reject that touches the job's places;
- `MATCHER_VERSION` (bumped by this slice).

The existing sweep finds stale rows. The builder checks the possible BullMQ gap the matcher review found, where a forced rematch may be swallowed by a queued job with the same id, and fixes it if real.

### Measures

After deploy, a query (or a line in the matcher's logs) reports:

- the share of decided jobs per outcome;
- for `review`, the share per rule and per fact.

That share is slice 03's target. Review must stay the exception _(user)_.

## The review list and mismatch reports

### Review (per user)

- Jobs with outcome `review` appear in the web app as a Review tab next to Matches, built from `components/ui` and theme tokens per `apps/web/DESIGN.md`.
- Each item shows:
  - the rule that would have rejected it;
  - the unsure fact and its description quote;
  - LinkedIn's value when there's a conflict.
- The user moves it to Matches or Rejected. There is no Rejected view yet: Phase 2 slice 05 builds it later, and is noted to list these jobs. Until then, a job moved to Rejected just leaves the Review list _(user: keep the Rejected view out of this slice)_. The decision is stored per user and profile, as an overlay row next to the match. It holds the user's choice, the rule and fact that sent the job to review (the reason), and an optional note.
- **How long it lasts** _(my call)_. It applies while the engine's outcome for that job is still `review` on the same rule and fact. If a re-decision gives a different outcome, such as a sure reject, a qualify, or review on another fact, the engine's outcome wins, and the old decision is kept only as history.
- RLS: owner read and write.

### Mismatch reports (everyone)

- Any user can report a fact as wrong on any job they can see: "this says senior, it's mid" _(user)_.
- A report stores:
  - the job, the field and the extraction id;
  - the processor's value and quote;
  - LinkedIn's value, when there is one;
  - the value the user says is right, and an optional note;
  - the reporter and the time.
- RLS: a user inserts their own reports and reads their own. Only the engine reads them all.
- **Reports change nothing in this slice** _(user)_. They're a log for improving the prompt and the golden set later, for example by turning a reported job into a golden case.

### The matches page

The matches page reads facts through `match_details`, from `job_extractions.data`. After PR 2, places and arrangements that came from LinkedIn are no longer in the extraction, so the page would no longer agree with the decision.

- `match_details` reads `job_facts` instead, in PR 3, so the page never sits in that state.
- It shows each fact's source (description or LinkedIn) and any conflict next to it _(my call)_.

## The mapper change

A `NORMALIZER_VERSION` bump, without `db:renormalize` _(user)_. New fields on the normalized record and `normalized_jobs`:

- `location.parsed.city` and `state`
- the location's `geoId`
- `salary.providedByEmployer`

Old cheap_scraper records get nulls.

## Order of PRs

1. Mapper fields, place resolver, Moroccan seed data and the recheck command.
2. Processor cleanup: description-only input, prompt, schema v3, golden set, preview.
3. Combined facts and conflicts. The matcher reads `job_facts`, with no rule changes yet. A `MATCHER_VERSION` bump.
4. The `review` outcome and the unsure principle on the existing rules, plus the measures.
5. New rules: contract type, salary with rates, currencies, required and posting languages, work authorization. Re-matching on profile, eligibility and city changes.
6. The web app: the review list, per-user decisions, mismatch reports.

## Tests

- **Data.** The 96 unique harvest items are at `tmp/harvest-items/items.json` (gitignored: they still hold hiring-team names). Copy a scrubbed selection into `ingest/utils/fixtures/` covering:
  - each region code
  - a state-only US place
  - a French suburb city
  - an employer-provided salary
  - a missing `workplaceType`
- **Moroccan cases.** The dev texts are recorded as synthetic `location.parsed` fixtures.
- **Pure functions** each get table tests: the listing opening, the place resolver (aliases, accents, fallbacks), the rule per fact and its conflicts, salary conversion, posting-language detection, and each new rule (including every `unknown` and `review` path).
- **Processor.** No prompt, input or hash contains listing data. The golden set still runs.
- **Matcher.**
  - review versus reject on unsure facts;
  - stale rows after each re-match trigger;
  - expiry removes a job.
- **After deploy, on dev:**
  - reprocess the 60 jobs and rebuild their facts;
  - check the Casablanca jobs no longer get Worldwide;
  - read the outcome shares.

## Left to the builder

- Table, column and field names.
- How `job_facts` stores facts: typed columns, jsonb or both.
- Whether stored v2 extractions keep parsing.
- The language detector and its thresholds.
- The exchange-rate source, which must cover MAD.
- The expiry mechanism.
- Whether the typed region columns on `job_extractions` go.

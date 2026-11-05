# Preferences and eligibility schema

Phase 1, slices 04 and 05, written as one spec. Date: 2026-11-05.

## Intent

Each profile has to hold every reason its owner would turn a job down, in a form Phase 2's qualify step can compare directly against what the processor extracts from each posting. Then a rejection can name the rule and both values ("posting requires a US work permit; you hold none for US").

The processor already writes each job's facts as codes from its own value lists (the vocabulary tables: `tech_tags`, `role_kinds`, `seniorities`, `contract_types`, `engagements`, `regions`, `countries`, `cities`, `region_countries`). The profile today keeps its own copies of some of those lists as enums (`Technology`, `Position`, `Region`, `Language`…), and free text for locations. Copies drift, and free text can't be compared to codes reliably. A drifted copy produces wrong rejections, which is one of the project's anti-goals.

**The core decision (user's):** the profile and eligibility use the processor's value lists as their only source. There is one list per kind of value, and the profile stores codes from it.

Slices 04 and 05 are merged into this one spec because they share these lists and both change `contract.prisma`.

## Goals

- Every preference and eligibility value can be stored and read back, and the database rejects any value that is not an approved entry of its list.
- Profile, eligibility and job facts use the same codes, so Phase 2 compares like with like.
- No second, hand-kept copy of any value list remains that can drift from the processor's.
- Users can read the approved entries of every list (for pickers in the web app) and can't change any list.
- Query generation keeps working from the new fields.

## Non-goals

- **Qualify logic.** How a job is judged against these fields is Phase 2. This spec only decides what is stored.
- **Travel.** The processor doesn't extract travel, so a travel preference couldn't be checked. Dropped. _(my call)_
- **Free-text titles.** They were only for semantic matching, which is Phase 2. `position` (a role kind) is the target role. Dropped. _(my call)_
- **Preference history.** Published profiles are frozen, so there's nothing to track. _(my call)_
- **Users adding entries to a list.** A missing tech, city and so on is added by an admin through `db:vocab`. _(my call)_
- **Currency conversion** between a job's salary and the user's minimum. Phase 2.
- **A maximum salary.** The user decided on a minimum only.
- **The web UI.** Slices 07 and 08.

## Anti-goals

- **"Any" read as "none".** No field may use an empty value to mean "I don't mind". See "Any versus none".
- **Wrong rejections from mismatched vocabularies,** such as the text "Europe" against the code `EU`.
- **A profile pointing at an unapproved or meaningless value:** a `proposed` term, or `unstated`/`other`, which exist only to describe jobs.

## Decided by the user

- The processor's value lists are the single source. Profile enums that copy them go away.
- Profile locations become place codes instead of free text.
- Salary: an optional minimum with its currency and period. No maximum.
- Accepted payment currencies: a separate list, and every currency is accepted by default. A job can later be rejected when it pays in a currency the user doesn't accept.
- Hours and hired-as are separate fields (locked in the roadmap).
- From now on everyone branches from `main` and opens PRs to `main`; `develop` is retired.
- The user sets these decisions. The teammate who builds the engine is informed of them, including the engine changes listed below.

## Value lists

| List (table)           | Used by                                        | Allowed in profile or eligibility                       |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `role_kinds`           | `Profile.position`                             | approved and marked engineering (see below)             |
| `seniorities`          | `Profile.seniorities`                          | approved, except `unstated`                             |
| `contract_types`       | `Profile.contractTypes`                        | approved, except `unstated`                             |
| `engagements`          | `Profile.engagements`                          | approved, except `unstated`                             |
| `tech_tags`            | `ProfileSkill.technology`                      | approved                                                |
| `regions`              | location places, work authorization places     | approved                                                |
| `countries`            | location places, work authorization, residence | approved                                                |
| `cities`               | location places                                | approved                                                |
| `iso_languages` (new)  | `Profile.languages`                            | two lowercase letters, as the processor's schema uses   |
| `iso_currencies` (new) | salary currency, accepted currencies           | three uppercase letters, as the processor's schema uses |

- **Engineering role kinds** _(my call)_. `role_kinds` gets a boolean column, `isEngineering`. It is seeded `true` for exactly the 17 codes in today's `Position` enum and `false` for the rest (`support`, `qa_manual`, `devrel`, `ux_engineering`, `ai_training`, `seo_marketing_web`, `other`, `unstated`). A profile may target only an approved, engineering role kind, so users can target what they can today and nothing new. The processor's `rules/validate.ts` builds `ENGINEERING_CODES` from the `Position` enum today; it switches to this column.
- **Search wording is not a value list** _(my call)_. The query-generation maps `POSITION_TITLES`, `TECHNOLOGY_TERMS` and `SENIORITY_WORDS` (in `modules/queries/builders/keywords.ts`), and `LINKEDIN_TERMS` and `EXPERIENCE_LEVELS` (in `channels/linkedin_board.builder.ts`), hold search phrasing such as `go` → "golang" and three title variants per role. They stay, re-keyed from enums to code strings, and become partial maps. Replacing them with table labels would make searches worse.
- **Which techs get searched** _(my call)_. A profile's tech stack may hold any approved tech tag, including concepts such as `saas` or `microservices`, because the stack is a ceiling for qualify. Query generation picks its top technologies only among the profile's techs that have an entry in `TECHNOLOGY_TERMS`, so a concept is never sent as a search keyword. Adding search wording for a new tag is a code change in the engine.
- Approved terms are never deleted (`VocabRepository.reject` deletes only `proposed` ones), so a stored code stays valid.
- Languages and currencies have no vocabulary table today. Each gets a small seeded reference table (`code`, `label`) from one checked-in constant list, because the database has to reject a bad code on a direct insert and the picker needs labels _(my call)_.
- **How** the database enforces "approved entry of list X" for arrays (child tables with foreign keys, a trigger, or a check function) is left to the builder. The requirement is that a direct `supabase-js` insert with a bad code fails, because the web app writes these rows itself through RLS.
- The TypeScript enums `Technology`, `Position`, `Region` and `Language`, and their twins in `apps/xjobs/src/common/enums`, are removed. Code that needs the values reads them from the tables. Where a type is useful, use `string` or a branded string, not a hand-kept union. `SkillDomain`, `ProfileState`, `Channel`, `ContactKind` and the arrangement keys (`remote`, `hybrid`, `onsite`) are not processor lists and stay as they are. Whether `Seniority` and `Engagement` stay as TypeScript unions mirroring their tables is the builder's call, as long as a test fails when the two disagree.

## Profile (per target position)

Changes to `Profile` as it is on `main` today:

| Field                                           | Change      | Shape                                                                                                                                                    |
| ----------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`                                      | changed     | one `role_kinds` code                                                                                                                                    |
| `seniorities`                                   | changed     | non-empty set of `seniorities` codes                                                                                                                     |
| `locations`                                     | changed     | `{ remote: Place[], hybrid: Place[], onsite: Place[] }`, see below                                                                                       |
| `contractTypes`                                 | **new**     | non-empty set of `contract_types` codes (full time, part time, contract, temporary, internship, freelance, volunteer…)                                   |
| `engagements`                                   | changed     | non-empty set of `engagements` codes (hired as: employee, contractor, eor, agency, per_task)                                                             |
| `languages`                                     | changed     | non-empty list of `{ lang, level }`, `lang` ISO 639-1, `level` one of `native`, `fluent`, `working`; one entry per `lang`                                |
| `salaryMin`, `salaryCurrency`, `salaryPeriod`   | **new**     | optional and all-or-nothing: an integer > 0 in whole currency units, an ISO 4217 code, and one of `hour`, `day`, `month`, `year` (the processor's units) |
| `acceptsAnyCurrency`, `acceptedCurrencies`      | **new**     | `acceptsAnyCurrency` defaults to `true`. When it is `true`, the list is empty. When it is `false`, the list holds one or more ISO 4217 codes.            |
| `country`, `city`                               | **removed** | Residence moves to the user (see Eligibility).                                                                                                           |
| `timezoneCurrent`, `timezoneMin`, `timezoneMax` | unchanged   | UTC offsets in minutes. The processor uses offset ranges in hours and ignores daylight saving time, so the two compare directly.                         |
| `yearsOfExperience`, `noticePeriodDays`         | unchanged   |                                                                                                                                                          |
| resume columns, `state`, `publishedAt`          | unchanged   |                                                                                                                                                          |

`ProfileSkill.technology` changes from the `Technology` enum to a `tech_tags` code. `domain`, `mastery` and `importance` are unchanged, and so is the rule that the stack is a ceiling.

### Places

A `Place` has the processor's place shape, with a city held by id:

- `{ "kind": "worldwide" }`
- `{ "kind": "region", "code": "<regions code>" }`
- `{ "kind": "country", "code": "<countries code>" }`
- `{ "kind": "city", "id": "<cities id>" }`

The existing locations rules stay: at most 20 places per arrangement, at least one place overall, and no duplicate within a list. "Worldwide" is the `worldwide` kind, not the `GLOBAL` region _(my call; the builder may block `GLOBAL` in profiles)_.

### Any versus none

- A set field (`seniorities`, `contractTypes`, `engagements`, `languages`) must be non-empty. "I don't mind" means selecting every value. Phase 2 never sees an empty set.
- Currency is the one exception, because ticking roughly 180 currencies is unworkable and a saved list would miss any added later. "Any" is the explicit flag `acceptsAnyCurrency`, never an empty list.
- Salary is a single optional rule. If it's absent, there is no salary rule.
- An arrangement with an empty locations list means that arrangement isn't wanted, as it does today.

## Eligibility (per user)

Eligibility belongs to the user, not to each profile, because legal status doesn't change with the target role _(my call)_. It is stored as new fields on `users`, plus whatever child table the builder picks for the list.

| Field                | Shape                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `residenceCountry`   | a `countries` code, the country the user lives in. Nullable in the database, because the sign-up trigger creates the row empty.                                                                   |
| `workAuthorizations` | a list of `{ kind, place }`. `kind` is one of `work-permit`, `citizenship`, `residency`, `clearance`, the processor's four kinds. `place` is a `countries` or `regions` code. No duplicate pairs. |
| `acceptsSponsorship` | a boolean, nullable until answered: "I would take a job that sponsors my visa".                                                                                                                   |

- **Empty authorizations mean none.** That's a real answer here, unlike the preference sets, because "any" makes no sense for legal status. The setup UI suggests the residence country, but nothing is implied automatically _(my call)_.
- **Ready to publish:** the engine's publish action refuses a profile whose owner has no `residenceCountry` or an unanswered `acceptsSponsorship` _(my call)_.
- **Eligibility isn't frozen.** A user can edit it at any time, and the change applies to all their profiles, published ones included. Note for Phase 2: since eligibility can change after a rejection, a qualify decision should record the eligibility values it used.
- **`users.address` is separate.** It's a postal address for applications and is optional. Residence is not derived from it _(my call)_.

## Access (RLS)

- **New profile columns** follow the existing profile policies and column grants: the owner can write them only while the profile is a draft.
- **Eligibility columns on `users`** follow the existing owner read and update policies. Grant update on the new columns. A child table for authorizations, if the builder picks one, carries `userId`, gets owner policies, and is added to the two-user isolation harness.
- **Value lists:** `authenticated` gets `SELECT` on the approved rows of each list table, limited to the columns a picker needs (`code`, `label`, `aliases`, plus `name`, `countryCode` and `id` for cities, and both columns of `region_countries`). There is no write access and no access to `proposed` rows or counters. This replaces the roadmap's "only shared table users can read" with this read-only set. Every table keeps RLS on, so the CI check still passes.
- **Tests:** a user reads approved rows; can't read proposed rows; can't insert, update or delete in any list; and can't store a proposed, unknown, `unstated` or `other` code in any profile or eligibility field.

## Who builds what, and in what order

One plan, with the work split between the user and the teammate _(user's decision)_. Every PR leaves `main` green and needs no temporary compatibility code, because the work runs in three steps:

1. **Add (the user):** the new columns and tables, `role_kinds.isEngineering`, the list read access, eligibility, and their tests, all added next to the old enum columns, which keep working. During this step the new fields may use new column names where an old column still holds the old shape. That choice is the builder's.
2. **Switch (the teammate):** the engine changes below. Afterwards, nothing in the engine reads the old columns or enums.
3. **Remove (the user):** drop the old columns, the `Technology`, `Position`, `Region` and `Language` enums and their TypeScript twins, and rename new columns to their final names if step 1 used temporary ones. Regenerate the web app's database types.

Step 1 starts after the shared-dev-database plan's first PR (the `libs/database` move) has merged, because that PR moves the same contract and enum files.

## Engine changes (step 2, the teammate)

- **Query generation**
  - Reads tech tag codes and `Place` values instead of enums and free text.
  - Builds a place's search text from its label: a city is "name, country label", and region and country labels are used as they are. Keeps the LinkedIn geoId lookup keyed by that text, re-keying `LINKEDIN_GEO_IDS` where needed.
  - Bumps the query recipe version and runs `db:regenerate` once.
- **Profile endpoints and DTOs** in `modules/users`, which are temporary, either follow the new shape or are removed if the web app already covers them. The builder chooses.
- **Publish action** adds the eligibility readiness check above.
- **Query generation wording**: re-key the search wording maps by code string and select top technologies only among techs that have search wording (see Value lists).
- **Processor** switches `ENGINEERING_CODES` to `role_kinds.isEngineering`, and tightens `workAuthorization.requirements[].kind` from any string to the four kinds, so job values and user values come from one list.
- **Profile fields used in qualify:** none yet. Qualify is Phase 2.

## Constraints

- `contract.prisma` is the only schema source, RLS included. The in-flight shared-dev-database plan (`docs/superpowers/plans/2026-11-05-shared-dev-database.md`) moves it to `libs/database`. Use whichever path is current when this is built.
- No production data exists. Existing profiles in local or shared dev databases don't need converting, and the builder may clear them as the locations change did _(my call)_. Approved vocabulary rows must be kept, because they hold manual approvals.
- The web app's database types are regenerated after the migration.

## Roadmap docs to update in the same PR

- `phase-1-accounts-and-preferences/04-preferences-schema.md` and `05-eligibility-schema.md`: point both to this spec as their combined spec, and correct "What already exists" (`seniorities` and `locations`; no `regions` or `arrangements`).
- `07-guided-setup-ui.md`: drop "adding a missing tech to the shared catalog". Pickers load approved entries from the list tables. Add an eligibility step (residence, authorizations, sponsorship). The location picker offers places, not free text.
- `phase-1-accounts-and-preferences/README.md`: the data rules now include the read-only list tables, and the slices table shows 04 and 05 as one spec.

## Left to the builder

- How "approved entry of list X" is enforced for arrays and JSON.
- Child tables or JSON columns for `languages`, `workAuthorizations` and accepted currencies.
- The source of the ISO 639-1 and ISO 4217 constant lists.
- Whether to seed more approved cities so the onsite and hybrid picker isn't sparse at launch.
- How each of the three steps splits into PRs.

## Done when

- Every field above can be stored and read back for a profile and a user, and invalid values are rejected by the database itself.
- Users can read the approved entries of every list and nothing else in them.
- The isolation harness covers every new table, and the tests listed under Access pass.
- Query generation produces searches from the new fields.
- No hand-kept copy of a processor list remains.

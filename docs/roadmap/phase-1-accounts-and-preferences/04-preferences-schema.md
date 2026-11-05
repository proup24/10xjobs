# 04: Preferences schema

Spec: [Preferences and eligibility schema](../../superpowers/specs/2026-11-05-preferences-and-eligibility-design.md), shared with slice 05.

## Goal

Make each profile's job preferences complete enough that Phase 2 can check a job against them and name the rule when it rejects one. The engine's `Profile` and `ProfileSkill` models are the starting point; this slice changes them rather than building a new schema.

## What already exists (on `main`)

`Profile`, one per target position, many per user:

- `position` (enum), `seniorities` (a set of enum values), `yearsOfExperience`.
- `languages` (enum: AR, FR, EN, ES).
- `locations`: `{ remote, hybrid, onsite }`, each a list of location text. An empty list means that arrangement isn't wanted.
- `country` and `city`, which the spec moves to the user as residence.
- Timezone as UTC offsets in minutes: `timezoneCurrent`, `timezoneMin`, `timezoneMax`.
- `engagements` (employee, contractor, eor, agency, per_task).
- `noticePeriodDays`.
- `state` (draft or published), and resume columns (slice 06).

There are no `regions` or `arrangements` columns; the arrangement keys live inside `locations`.

The spec adds the new fields next to the old ones (`contractTypes`, `places`, `spokenLanguages`, `salaryMin`/`salaryCurrency`/`salaryPeriod`, `acceptsAnyCurrency`/`acceptedCurrencies`), in three steps. Step 1 (add, PR A) is on branch `feat/preferences-add`; step 2 (switch the engine) and step 3 (remove) are pending. The old columns and enums go, and `places` and `spokenLanguages` are renamed to `locations` and `languages` in step 3 (PR C), once the engine has switched.

`ProfileSkill`, the tech stack: `technology` (a fixed enum), `domain`, `mastery` (0–10) and `importance` (0–10). Query generation searches the top technologies by importance.

## In scope

- Agreeing which preferences from the first draft get added to `Profile`, and adding them:
  - **Hours:** full-time, part-time. Missing today.
  - **Travel:** dropped. The processor doesn't extract it, so it couldn't be checked (see the spec's Non-goals).
  - **Hired as:** the first draft had employee, employee through an employer of record, B2B contractor, corp-to-corp. `Engagement` has employee, contractor, eor, agency, per_task. Settle one list.
  - **Titles:** dropped. They were only for Phase 2's semantic matching; `position` is the target role (see the spec's Non-goals).
- RLS on any new table (slice 02's pattern), and every one added to the isolation harness.
- Validation the web app and the engine share. The enums already have TypeScript twins in `apps/xjobs/src/common/enums`.

## Out of scope

- User-defined custom rules (not on the roadmap).
- Matching logic: semantic title matching, required-vs-nice-to-have techs and so on are Phase 2.
- Rewriting the existing fields without a reason. Query generation depends on them.

## Locked

- The set of preference types is fixed, and every preference is strict.
- One profile per target position; a user can have several.
- Published profiles are frozen. To change one, the user deletes it and creates a new one.
- Tech stack is a ceiling. A job is a miss if it requires a tech outside the stack, and the job doesn't have to use everything in it.
- Hours and hired-as are separate fields.

## For the slice spec

- The exact values of each new enum, and the single hired-as list.
- Languages: settled in the spec. ISO 639-1 codes, each with a level (`native`, `fluent` or `working`).
- Timezones: keep UTC offset ranges, or move to IANA names. Offsets don't follow daylight saving time.
- Technologies: settled in the spec. Profiles use the processor's `tech_tags` list. Users can't add entries; an admin adds them through `db:vocab`.
- Whether "no preference" is allowed per field, and how "any" is stored so Phase 2 doesn't treat it as "none".
- Whether to keep a history of preference changes. Published profiles are frozen, so a Phase 2 rejection already points at the rule as it was.

## Done when

Every agreed preference can be stored and read back for a profile with valid values only, and the isolation harness covers every new table.

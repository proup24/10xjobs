# 04: Preferences schema

## Goal

Make each profile's job preferences complete enough that Phase 2 can check a job against them and name the rule when it rejects one. The engine's `Profile` and `ProfileSkill` models are the starting point; this slice changes them rather than building a new schema.

## What already exists (on `main`)

`Profile`, one per target position, many per user:

- `position` (enum), `seniority` (enum), `yearsOfExperience`.
- `languages` (enum: AR, FR, EN, ES).
- `country` (ISO code), `city`, `regions` (regions the user belongs to, for example Morocco → MENA, NORTH_AFRICA, EMEA).
- Timezone as UTC offsets in minutes: `timezoneCurrent`, `timezoneMin`, `timezoneMax`.
- `engagements` (employee, contractor, eor, agency, per_task) and `arrangements` (remote, hybrid, onsite, unstated).
- `noticePeriodDays`.
- `state` (draft or published), and resume columns (slice 06).

`ProfileSkill`, the tech stack: `technology` (a fixed enum), `domain`, `mastery` (0–10) and `importance` (0–10). Query generation searches the top technologies by importance.

## In scope

- Agreeing which preferences from the first draft get added to `Profile`, and adding them:
  - **Hours:** full-time, part-time. Missing today.
  - **Travel:** enum or limit. Missing today.
  - **Hired as:** the first draft had employee, employee through an employer of record, B2B contractor, corp-to-corp. `Engagement` has employee, contractor, eor, agency, per_task. Settle one list.
  - **Titles:** free-text titles alongside the `position` enum, for Phase 2's semantic matching, or not.
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
- Languages: keep the enum and add values as needed, or move to ISO codes. Whether languages carry a proficiency level.
- Timezones: keep UTC offset ranges, or move to IANA names. Offsets don't follow daylight saving time.
- Technologies: keep the fixed enum (adding one is a migration), or move to a shared catalog users can add to. The catalog would be the only shared table users can read.
- Whether "no preference" is allowed per field, and how "any" is stored so Phase 2 doesn't treat it as "none".
- Whether to keep a history of preference changes. Published profiles are frozen, so a Phase 2 rejection already points at the rule as it was.

## Done when

Every agreed preference can be stored and read back for a profile with valid values only, and the isolation harness covers every new table.

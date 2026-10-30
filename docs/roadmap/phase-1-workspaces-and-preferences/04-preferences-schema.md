# 04: Preferences schema

## Goal

Store each workspace's job preferences as strict, named rules that Phase 2 can check a job against and cite when it rejects one.

## In scope

- Tables, enums and constraints for the fixed preference set:
  - **Spoken languages:** ISO language codes, possibly with a proficiency level.
  - **Locations and timezones:** ISO country codes and IANA timezones.
  - **Work arrangement:** enum (remote, hybrid, on-site).
  - **Hours:** enum (full-time, part-time).
  - **Hired as:** enum (employee, employee through an employer of record, B2B contractor, corp-to-corp).
  - **Titles:** a list of free-text titles.
  - **Travel:** enum or limit.
  - **Seniority:** enum.
  - **Tech stack:** links to the shared tech catalog.
- The shared tech catalog: case-insensitive unique names, aliases ("NodeJS", "node.js" → Node.js), seeded with a starter list.
- Reference data for languages, countries and timezones.
- RLS on all workspace-scoped preference tables, and every one added to the isolation harness.
- Validation that the web app and, later, the engine share (for example one schema module).

## Out of scope

- User-defined custom rules (not on the roadmap).
- Matching logic: semantic title matching, required-vs-nice-to-have techs and so on are Phase 2.
- History of preference changes. Recommended, but the slice spec decides.

## Locked

- The set of preference types is fixed, and every preference is strict.
- Enums for short lists we own, ISO and IANA codes for standard lists, a catalog table for tech stack, free text for titles.
- The tech catalog is shared across workspaces: an addition by any user is available to all. Users can add entries but can't edit or delete them. Who added an entry is stored but never shown to other workspaces.
- Tech stack is a ceiling. A job is a miss if it requires a tech outside the stack, and the job doesn't have to use everything in it.
- Hours and hired-as are separate fields.

## For the slice spec

- The exact values of each enum: seniority levels, travel options, and whether "remote" needs qualifiers.
- How location and timezone combine. Does "remote, EU timezones" mean a list of timezones, a UTC offset range, regions, or countries? This is the least settled preference.
- Whether spoken languages carry a proficiency level.
- Whether each preference category is required, or "no preference" is allowed (and how "any" is stored so Phase 2 doesn't treat it as "none").
- One row per value, or one row per category holding an array, per category.
- How users add a tech: an insert policy or a function that normalizes names and checks aliases first. Plus a size limit and basic abuse limits on additions.
- Whether to keep a history of preference changes, so a Phase 2 rejection can be traced to the rule as it was when it was applied.

## Done when

Every preference type can be stored and read back for a workspace with valid values only, the tech catalog accepts new entries without near-duplicates, and the isolation harness covers every new workspace-scoped table.

# 07: Guided setup UI

## Goal

A first-time user goes from the invite email to a complete set of preferences, eligibility and a resume through a short setup, one step at a time.

## In scope

- A step-by-step setup that creates the user's first profile and writes to the schemas from slices 04–06, directly through Supabase as the signed-in user.
- Progress saved as the user goes, so leaving midway and coming back works.
- Pickers that load the approved entries of each value list (techs, roles, seniorities, contract types, engagements, regions, countries, cities, languages, currencies). They are read-only, so a missing entry is added by an admin, not by the user.
- An eligibility step: country of residence, work authorizations and visa sponsorship.
- A location picker that offers places (worldwide, region, country, city), not free text.
- Sending users with unfinished setup back to it.

## Out of scope

- Editing after setup (slice 08), though the two should share components.
- Showing any jobs (Phase 2).

## Locked

- Short, guided, one step at a time.
- The UI is shaped once slices 01–06 have landed. Backend and schema take priority.
- Starts after slice 06a, [Preferences switch and final names](../../superpowers/specs/2026-11-07-preferences-switch-and-remove-design.md) (steps 2 and 3 of the preferences and eligibility plan), which switches the engine and gives the new columns their final names (`places` → `locations`, `spokenLanguages` → `languages`).

## For the slice spec

- The order and grouping of steps.
- What counts as "complete" enough to finish setup, which follows from slice 04's required-vs-optional decision.
- The component and styling baseline, if slice 01 deferred it.
- Mobile support: required, or desktop-first.
- Whether to show mockups during the slice brainstorm.

## Done when

An invited user can finish setup in one sitting or across several, and everything they entered is stored and valid.

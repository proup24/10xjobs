# 07: Guided setup UI

## Goal

A first-time user goes from the invite email to a complete set of preferences, eligibility and a resume through a short setup, one step at a time.

## In scope

- A step-by-step setup that creates the user's first profile and writes to the schemas from slices 04–06, directly through Supabase as the signed-in user.
- Progress saved as the user goes, so leaving midway and coming back works.
- Adding a missing tech to the shared catalog from the tech stack step.
- Sending users with unfinished setup back to it.

## Out of scope

- Editing after setup (slice 08), though the two should share components.
- Showing any jobs (Phase 2).

## Locked

- Short, guided, one step at a time.
- The UI is shaped once slices 01–06 have landed. Backend and schema take priority.

## For the slice spec

- The order and grouping of steps.
- What counts as "complete" enough to finish setup, which follows from slice 04's required-vs-optional decision.
- The component and styling baseline, if slice 01 deferred it.
- Mobile support: required, or desktop-first.
- Whether to show mockups during the slice brainstorm.

## Done when

An invited user can finish setup in one sitting or across several, and everything they entered is stored and valid.

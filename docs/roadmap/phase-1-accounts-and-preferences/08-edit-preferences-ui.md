# 08: Edit preferences UI

## Goal

After setup, a user can view and change any preference, their eligibility and their resume.

## In scope

- A settings area covering every category from slices 04–06.
- Replacing the resume file, on drafts and published profiles, using slice 06's actions.
- Deleting a draft only through slice 06's `deleteDraftProfile`.
- Several profiles per user: in scope (spec 2026-11-09, `docs/superpowers/specs/2026-11-09-edit-preferences-design.md`).
- Admin invite page: out. Invites stay a script.

## Reuse from slice 07

Slice 08 reuses the frame-free step forms in `apps/web/src/components/setup`: `AboutForm`, `EligibilityForm`, `JobForm` and `TermsForm`. Each takes `formId`, `initial`, `onSave` and `onSaved`, plus an optional `onStatusChange`, which must be a stable callback. The setup rules apply unchanged: a star marks at most two techs, and only searchable ones; a rating is 1-5 and is stored as mastery = rating x 2.

- `ResumeStep` is not frame-free yet: split it into a resume field and the step wrapper before reusing it.
- A form mounted outside the setup flow must pass `onStatusChange` to show the `_form` error.

## Out of scope

- Account deletion.
- Suggestions to change preferences based on fit or reject feedback (the feedback loop, Phase 2 or later).

## Locked

- Every preference type set during setup is editable afterwards.
- Same start condition as slice 07: after steps 2 and 3 of the preferences and eligibility plan.

## Settled by the slice spec

- One Preferences page with tabs down the side (You: contacts, where you can work; Profiles: each profile's job, terms and resume), each section at its own URL under `/preferences`.
- Changes save per section, with an explicit Save button. Leaving a section with unsaved edits asks first.
- No visible preference history.

## Done when

Every value set during setup can be changed and the change is stored, which completes the phase's "set and edit" exit criterion.

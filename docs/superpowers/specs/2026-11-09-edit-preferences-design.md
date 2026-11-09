# Edit preferences

Phase 1, slice 08. Date: 2026-11-09.

Brief: [08-edit-preferences-ui.md](../../roadmap/phase-1-accounts-and-preferences/08-edit-preferences-ui.md). Builds on [guided setup](2026-11-08-guided-setup-design.md) (slice 07), [resume storage](2026-11-06-resume-storage-design.md) (slice 06) and [preferences and eligibility](2026-11-05-preferences-and-eligibility-design.md). UI rules: [`apps/web/DESIGN.md`](../../../apps/web/DESIGN.md).

## Intent

After setup, a user can change anything they entered during setup, except their name and email _(user)_, and can keep more than one job-search profile _(user)_. This finishes the phase's exit criterion: "an invited user can create and edit their profiles (preferences, eligibility and resume)".

## Goals

- A **Preferences** page where every setup answer except name and email can be changed and saved.
- **Several profiles per user.** Add one (starting blank or as a copy of an existing one), edit each, delete a draft.
- **A resume per profile**, which can be replaced at any time.
- Reuse slice 07's step forms unchanged where possible. Same rules, same pickers, same validation.

## Non-goals

- Editing the name _(user: fixed, no visible field)_ or the email (it's the account's identity).
- An admin invite page _(user: keep the admin script for this phase)_.
- Publishing, and editing or deleting published profiles. There's no publish in Phase 1, so every profile is a draft. Published profiles stay frozen by RLS, and the UI doesn't have to handle them yet.
- Preference history. Published profiles are frozen, so there's nothing to track (settled in the preferences and eligibility spec). The user can't see a history because none exists.
- Account deletion, and suggestions based on fit or feedback (brief).

## Anti-goals

- An edit that silently widens or narrows what gets matched: the same anti-goals as setup (a tech without a rating, an accidental "no work authorization", a wrong location list).
- A half-finished profile that looks complete, or that the engine could see.
- Replacing one profile's resume and having it change another's.
- Losing edits without warning.
- One-off UI. Build only from `components/ui` and tokens.

## Page layout

_(User chose layout B in the mockups: tabs down the side.)_

A **Preferences** item in the app sidebar (`NAV_ITEMS` in `app-nav.tsx`) opens a page inside `AppShell`. The page has a vertical tab list on the left and the selected form on the right. On phones the tab list becomes a select or dropdown at the top _(my call)_.

The tab list has two groups, because eligibility and contacts belong to the user and the rest to each profile _(my call, accepted as the playback)_:

```
You
  Contacts
  Where you can work
Profiles
  Backend engineer        → The job you want / Location and terms / Resume
  Backend engineer · Berlin
  + New profile
```

- **You → Contacts**: slice 07's `AboutForm` without the name field. The email is shown read-only. Phone, LinkedIn and extra links can be edited. Saving replaces the user's contact rows as setup does. The name stays as stored. `AboutForm` needs a variant, a prop or a split, that hides the name and doesn't send it (builder's call).
- **You → Where you can work**: `EligibilityForm`, unchanged. Its changes apply to every profile.
- **Profiles → <profile>**: selecting a profile shows its three sections: The job you want (`JobForm`), Location and terms (`TermsForm`) and Resume. Whether these are sub-tabs, nested items in the side list, or stacked sections with headings on one screen is the builder's call, as long as it stays within layout B and saving stays per section.
- Each profile shows its position label. When two profiles share a position, the label adds the first location ("Backend engineer · Berlin") _(my call)_. A profile with no resume shows a "Needs a resume" badge.
- URLs are deep-linkable, for example `/preferences/contacts` and `/preferences/profiles/<id>/job`. The exact route shape is the builder's call.

## Saving

- **Per section, with an explicit Save button** _(my call, shown in the mockup, not objected to)_. Each form keeps its own submit, reusing the slice 07 form contract (`formId`, `initial`, `onSave`, `onSaved`, a stable `onStatusChange`). Outside setup, a form must pass `onStatusChange` so the `_form` error shows (brief).
- Success: a "Saved" toast and the user stays on the section. Failure: the setup convention (`notifySaveFailed` toast for failures, field errors for invalid input, `_form` as an alert).
- **Unsaved changes**: leaving a section with edits (another tab, a nav link, a page unload) asks "Discard changes?" through `ConfirmDialog` and `beforeunload` _(my call)_.
- Profile sections save directly to the draft profile and its `profile_skills`, the same writes slice 07 uses after the profile exists ("After the profile exists" in the setup spec). RLS already lets users update their drafts. The setup rules apply unchanged: at most two starred techs, and only searchable ones; every tech rated 1–5 and stored as mastery = rating × 2; star → importance 10, otherwise 5; domain follows the position; at least one searchable tech; the location, time zone, salary and currency rules.

## New profile

- **"+ New profile"** first asks for a starting point _(user)_: **Blank**, or **Copy from** one of the user's profiles. Nothing is preselected.
- **Copy** fills the job answers (position, years, seniority, stack with ratings and stars, languages) and the location and terms answers (places with their arrangements, time zone, contract types, hired-as, notice, salary, currencies) from the source. It also copies the **resume file** as a starting point _(user)_. The copy is a separate file in the new profile's folder, so later replacing either resume never touches the other.
- **The flow** _(my call)_: the database can't hold an incomplete profile, so a new profile goes through a short three-step flow (The job you want, then Location and terms, then Resume), built from the same `StepFrame` and step forms as setup. Answers are kept in the existing per-user setup draft (`profile_setup_drafts`) and saved after every step, so the user can leave and come back. Finishing step 2 creates the profile through the existing create-from-draft function and deletes the draft, exactly as setup does.
- **Creating the second profile needs a database change** _(my call, from the builder check)_. Today's `create_profile_from_setup` (migration `20261108T1324_create_profile_from_setup_idempotent`) refuses on purpose to insert when the user already has a profile: it deletes the draft and returns the oldest profile. That guard against double submits and second tabs stays for setup. The new-profile flow gets its own idempotent create path. My pick is a profile id chosen by the client and stored in the draft (a draft payload version bump), so a repeated call returns that profile instead of inserting again. A separate function or a `purpose` marker is acceptable if it gives the same guarantees: setup's behaviour is unchanged, a new profile is inserted exactly once, and nothing is half-written. This adds a hand-written migration, an update to the `refs/db.json` invariant, and db-tests to PR 2.
- **Save targets**: `saveJob` and `saveTerms` in `src/lib/setup/save.ts` always write to the user's oldest profile once one exists. PR 1 makes them take a target (a profile id, or the draft) so the edit sections and the new-profile flow can reuse them.
- **Resume step**: blank → an upload is required. Copy → the copied file shows with Replace, and Continue keeps it _(user: "they should be able to replace the resume too")_.
- A profile that was created but left before the resume step appears in the list with "Needs a resume" and opens on its Resume section.
- **One new profile in progress at a time** _(my call)_. The draft table has one row per user. "+ New profile" while a draft exists offers to continue it or discard it and start over.
- **Same position twice is allowed** _(my call)_, for example backend in Europe and backend remote in the US.
- **At most 5 profiles per user** _(my call)_, counting a draft in progress. Every published profile will run its own searches in Phase 2. When the limit is reached, "+ New profile" is disabled with a hint.

## Deleting a profile

- A Delete action on each profile, behind `ConfirmDialog`, that goes only through slice 06's `deleteDraftProfile` (brief, locked), so the resume file is cleaned up as well.
- **The last profile can't be deleted** _(my call)_. The user always keeps at least one, and the setup "done" rule depends on that. The action is disabled with a hint.
- After a delete, the page opens the next profile in the list.

## Setup and landing rules

The setup spec's next-step rule looks at "the profile". With several profiles and an in-progress draft, the builder must make sure that:

- a user who finished setup is never sent back to `/setup` because a later profile, or a new-profile draft, is incomplete. Once setup is done, it stays done.
- the draft table being in use for a new profile doesn't confuse setup's step 3 and 4 logic, or the reverse.

How to do this, for example by judging setup on the oldest profile or on "any profile with a resume", is the builder's call. It must be covered by `next-step` and `landing` unit tests.

## Components

Built only from `components/ui` and tokens. Expected new or extended pieces:

- A **vertical tabs** pattern for layout B, with the phone fallback. Check whether `tabs.tsx` (with vertical orientation) or the `sidebar` primitives already cover it before adding anything. A new library component goes into `components/ui`, the `/design` page and `DESIGN.md` first.
- `ResumeStep` split into a frame-free **resume field** and the setup wrapper (brief). The field is used by setup, the profile's Resume section and the new-profile flow.
- `AboutForm` without the name, as above.
- A **starting-point chooser** (Blank / Copy from …) built from existing controls (`RadioGroup` or `Card`s plus a `Select`).

## Responsive and accessibility

As in setup: desktop first, then checked at 360px wide with nothing scrolling sideways. The tab list keeps focus order and `aria-current` or `aria-selected` correct. Dialogs use the library's focus handling.

## Testing

- Unit (web): the AboutForm variant never sends a name; the dirty-state guard; the profile label rule (position, plus location on a clash); the copy mapping (profile → draft payload, every field carried over); the 5-profile limit; the last-profile delete guard; the next-step and landing rules with several profiles and a draft in progress.
- db-tests: copying a resume into the new profile's folder works only within the user's own folders; the create-from-draft function still works when the user already has profiles. Isolation is unchanged, so the two-user harness keeps passing.
- A manual run against the local stack, stated in the PR: edit every section, add a blank profile, add a copied profile and replace its resume, delete a profile.

## PR split (suggested)

1. **Edit**: the Preferences page, layout B, You sections, the existing profile's three sections, the resume field split, the dirty guard.
2. **Many profiles**: the idempotent create path for new profiles (migration and db-tests), New profile (blank and copy, including the resume copy), the profile list, delete, the limit, the next-step and landing changes.

## Left to the builder

- Routes and how tabs map to URLs. Server actions vs. client writes (follow slice 07).
- How the resume is copied (Storage `copy` as the user, or download and re-upload through the existing confirm path), as long as the slice 06 checks (PDF signature, size, ownership, `confirmResume`) still apply to the new file.
- Whether profile sections are sub-tabs, nested side-list items or stacked sections.
- Where the 5-profile limit is enforced (web only, or also in the create function).

## Roadmap updates (first PR)

- `08-edit-preferences-ui.md`: settle "For the slice spec" (one page with side tabs, per-section save, no visible history), record multiple profiles in scope, and note the admin invite page stays a script.

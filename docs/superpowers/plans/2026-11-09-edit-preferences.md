# Edit Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Preferences page where a signed-in user edits every setup answer except name and email, and keeps up to 5 job-search profiles: add (blank or copied, resume included), edit, delete.

**Architecture:** Next.js App Router pages under `apps/web/src/app/(app)/preferences`, a layout with a vertical tab list (layout B), and slice 07's step forms mounted outside the setup flow. Saves go through server actions to targeted save functions (profile id passed in, not "the oldest profile"). New profiles use the existing per-user draft table with a version-2 payload carrying a client-chosen profile id, and a new idempotent database function `create_profile_from_draft` that creates the profile.

**Tech Stack:** Next.js (App Router, server actions), React, supabase-js under RLS, zod, Vitest + Testing Library, Prisma Next migrations (hand-written raw SQL), the `apps/db-tests` suite.

**Spec:** `docs/superpowers/specs/2026-11-09-edit-preferences-design.md`

## Global Constraints

- UI is built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`). A new library component goes into `components/ui`, the `/design` page and `DESIGN.md` before a page uses it.
- No name field anywhere in Preferences, and no save writes `users.name`. The email is shown read-only.
- Setup rules apply unchanged: at most 2 starred techs, only searchable ones; rating 1–5 stored as mastery = rating × 2; star → importance 10, otherwise 5; domain follows the position; at least one searchable tech.
- Draft profiles are deleted only through `deleteDraftProfile` (`apps/web/src/lib/resume/delete-draft.ts`).
- At most **5** profiles per user. The last profile can't be deleted.
- Log lines carry ids and error codes only, never answers, filenames or keys (existing convention in `save.ts`, `confirm.ts`).
- Checked at 360px wide with nothing scrolling sideways.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude never pushes.
- Commands: web tests `npx nx test web -- <path>`; db tests `pnpm db:test` (needs `pnpm db:reset` on the local stack first); CI gate `npx nx run-many -t lint test build typecheck`.

## Review Focus

1. **Double submit on the new profile's "Location and terms" Continue.** Exactly one profile is created and both requests report success with the same id (Task 9 db-test, Task 10 unit test).
2. **A profile URL that isn't the user's** (`/preferences/profiles/<someone else's id>/job`, or a deleted one) renders 404 and never a blank form (Task 7 `requireOwnProfile` test).
3. **A save from a stale tab after the profile was deleted** gives the "Couldn't save" toast, not a crash or a write somewhere else (Task 1 zero-row update test).
4. **The copy source deleted, or without a resume, before the new profile is finished.** The profile is still created and shows "Needs a resume" (Task 10 test).
5. **A finished user whose oldest profile has no resume** (they deleted the original one) is never sent back to `/setup` (Task 14 test).

---

## PR 1: Edit

Branch `feat/edit-preferences` from `main`. Tasks 1–7.

### Task 1: Targeted saves

**Files:**

- Create: `apps/web/src/lib/setup/save-result.ts`
- Modify: `apps/web/src/lib/setup/save.ts`
- Test: `apps/web/src/lib/setup/save.spec.ts`

**Interfaces:**

- Produces (in `save-result.ts`, moved out of `save.ts` unchanged): `type SaveResult`, `fieldErrors(error: ZodError): SaveResult`, `failure(log, what: string, error: unknown): SaveResult`, `logger(deps: Deps): (line: string) => void`, `type Deps = { log?: (line: string) => void }`, `SAVED`, `FAILED`. `save.ts` re-exports `SaveResult` so existing imports keep working.
- Produces (in `save.ts`):
  - `saveContacts(supabase, userId, input: unknown, deps?): Promise<SaveResult>`: parses with `contactsSchema` (= `aboutSchema` without `name`, exported from `answers.ts`), then the contact replacement `saveAbout` does today. Never touches `users`.
  - `saveProfileJob(supabase, profileId: string, input: unknown, isSearchable, deps?): Promise<SaveResult>`: parses with `jobSchema`, then the "with a profile" branch of today's `saveJob` (update columns, `replace_profile_skills`).
  - `saveProfileTerms(supabase, profileId: string, input: unknown, deps?): Promise<SaveResult>`: the same for `termsSchema` / `termsColumns`.
  - `saveAbout` = the name update, then `saveContacts`. `saveJob` / `saveTerms` call the profile variants when `readProfile` finds one. Their behaviour is unchanged.

- [ ] **Step 1: Write failing tests** in `save.spec.ts`, following the file's existing fake-client style:
  - `saveContacts never updates users`: no `from('users')` call; contacts replaced as `saveAbout` does.
  - `saveContacts ignores a name in the input`: input `{ name: 'X', phone: null, linkedin: null, links: [] }` → `saved`, and `users` is not touched.
  - `saveProfileJob writes the given profile, not the oldest`: the update's `.eq('id', …)` and the rpc's `p_profile_id` are the passed id; `profiles` is never read for "oldest".
  - `saveProfileJob returns failed when the update matches no row` (Review Focus 3): update returns `data: []` → `{ status: 'failed' }`.
  - `saveProfileTerms` gets the same two tests.
  - The existing `saveAbout`, `saveJob` and `saveTerms` tests stay green unchanged.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/setup/save.spec.ts`. Expected: the new tests FAIL (functions not exported).
- [ ] **Step 3: Implement** the move to `save-result.ts`, `contactsSchema` in `answers.ts` (`aboutSchema.omit({ name: true })`, keeping its refinements; if `.omit` drops a `superRefine`, build both from one base shape), and the three new functions as above.
- [ ] **Step 4: Run** the same command. Expected: PASS, all tests.
- [ ] **Step 5: Commit** `refactor(web): targeted profile saves and a contacts-only save`.

### Task 2: Forms report dirty state; AboutForm without the name

**Files:**

- Create: `apps/web/src/components/setup/use-dirty.ts`
- Modify: `apps/web/src/components/setup/about-form.tsx`, `job-form.tsx`, `terms-form.tsx`
- Test: `apps/web/src/components/setup/use-dirty.spec.ts`, `about-form.spec.tsx`, `job-form.spec.tsx`, `terms-form.spec.tsx`

**Interfaces:**

- Produces: `useDirty(values: unknown): { dirty: boolean; markClean: () => void }`. It compares `JSON.stringify(values)` with a baseline taken on first render. `markClean()` re-baselines to the current values.
- Produces: an optional `onDirtyChange?: (dirty: boolean) => void` prop on `AboutForm`, `JobForm`, `TermsForm`, called from an effect when `dirty` changes. Each form calls `markClean()` after a `saved` result, before `onSaved()`. Like `onStatusChange`, callers must pass a stable callback.
- Produces: `AboutForm` prop `withName?: boolean` (default `true`). When `false`: no Name field rendered, client-side parse uses `contactsSchema`, and `onSave` receives no `name` key.

- [ ] **Step 1: Write failing tests:**
  - `use-dirty.spec.ts`: not dirty on mount; dirty after the values change; dirty → clean when values return to the baseline; `markClean` makes the current values the baseline.
  - `about-form.spec.tsx`: `withName={false}` renders no "Name" textbox, still shows the read-only email, and `onSave` is called with an object without `name`. Editing the phone fires `onDirtyChange(true)`; a `saved` result fires `onDirtyChange(false)`.
  - `job-form.spec.tsx` / `terms-form.spec.tsx`: changing years (job) or notice period (terms) fires `onDirtyChange(true)`; a saved result fires `onDirtyChange(false)`.
- [ ] **Step 2: Run** `npx nx test web -- src/components/setup`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Each form passes all of its editable state as one object to `useDirty`.
- [ ] **Step 4: Run** the same command. Expected: PASS, including the existing step specs.
- [ ] **Step 5: Commit** `feat(web): step forms report unsaved changes; about form without name`.

### Task 3: Frame-free resume field

**Files:**

- Create: `apps/web/src/components/setup/resume-field.tsx`
- Modify: `apps/web/src/components/setup/resume-step.tsx`
- Test: `apps/web/src/components/setup/resume-field.spec.tsx` (move the upload, replace, reject and message cases out of `resume-step.spec.tsx`); `resume-step.spec.tsx` keeps the frame cases (Continue disabled until a resume exists, goes to review).

**Interfaces:**

- Produces: `ResumeField({ profileId, userId, current, onChange }: { profileId: string; userId: string; current: Resume | null; onChange?: (state: { resume: Resume | null; uploading: boolean }) => void })`, with `type Resume = { filename: string; sizeBytes: number }` exported. It holds everything in today's `ResumeStep` inside the `<form>`: zone, upload, Replace, "Keep the current resume", reject and invalid messages.
- `ResumeStep` keeps its props and renders `StepFrame` + `ResumeField`, tracking `onChange` for `submitDisabled`.

- [ ] **Step 1:** Move the field cases into `resume-field.spec.tsx`, targeting `ResumeField`. Add `onChange reports the new resume after a saved upload`.
- [ ] **Step 2: Run** `npx nx test web -- src/components/setup/resume`. Expected: FAIL (no `resume-field`).
- [ ] **Step 3: Implement** the split. No behaviour change.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(web): split the resume field out of the setup step`.

### Task 4: `VerticalNav` library component

**Files:**

- Create: `apps/web/src/components/ui/vertical-nav.tsx`, `apps/web/src/components/ui/vertical-nav.spec.tsx`
- Modify: `apps/web/src/app/design/_sections/components.tsx` (an example), `apps/web/DESIGN.md` ("Components": one entry; "Layouts": "settings pages use `VerticalNav`")

**Interfaces:**

- Produces:
  ```ts
  type VerticalNavItem = { href: string; label: string; current?: boolean; badge?: string; children?: VerticalNavItem[] };
  type VerticalNavGroup = { label: string; items: VerticalNavItem[]; action?: React.ReactNode };
  function VerticalNav(props: { groups: VerticalNavGroup[]; label: string; onNavigate?: (href: string, event: React.MouseEvent) => void }): JSX.Element;
  ```

  - `md` and up: a `<nav aria-label={label}>` with group headings and links. The current link has `aria-current="page"`. `children` render indented under their parent. `badge` renders a `Badge`. `action` renders under the group (used for "+ New profile").
  - Below `md`: a `Select` listing every item (children prefixed with their parent's label) and navigating on change, plus the group actions under it.
  - `onNavigate` lets a caller cancel a link click (the unsaved-changes guard in Task 5).
- Styling: links use the clickable focus recipe from `DESIGN.md`, and the current item uses tokens only.

- [ ] **Step 1: Write failing tests:** renders group headings and links; the current item has `aria-current="page"`; children render after their parent; a badge's text shows; `onNavigate` receives the href and can `preventDefault`. The existing `a11y-recipes.spec.ts` must pass with the new file.
- [ ] **Step 2: Run** `npx nx test web -- src/components/ui`. Expected: the new spec FAILS.
- [ ] **Step 3: Implement**, plus the `/design` example and the `DESIGN.md` entries.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): vertical nav component for settings pages`.

### Task 5: Unsaved-changes guard

**Files:**

- Create: `apps/web/src/components/layout/unsaved-changes.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx` (wrap in the provider), `apps/web/src/components/layout/app-nav.tsx` (ask before navigating)
- Test: `apps/web/src/components/layout/unsaved-changes.spec.tsx`

**Interfaces:**

- Produces:
  - `UnsavedChangesProvider({ children })`.
  - `useUnsavedChanges(): { setDirty: (dirty: boolean) => void; confirmLeave: (go: () => void) => void }`. `confirmLeave` runs `go` at once when clean. When dirty, it opens an `AlertDialog` titled "Discard changes?" with the description "Your changes on this page haven't been saved.", the actions "Keep editing" and "Discard" (destructive). Discard clears the dirty flag and runs `go`.
  - While dirty, a `beforeunload` listener is attached; it's removed when clean or on unmount.
- `AppNav` links call `confirmLeave(() => router.push(href))` after `preventDefault`. Use `AlertDialog` directly: `ConfirmDialog` needs a trigger element and has no controlled `open`.

- [ ] **Step 1: Write failing tests:** clean → `go` runs at once with no dialog; dirty → the dialog shows and `go` hasn't run; "Keep editing" closes it without running `go`; "Discard" runs `go`; a `beforeunload` event while dirty has `defaultPrevented` set, and while clean it doesn't.
- [ ] **Step 2: Run** `npx nx test web -- src/components/layout`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): ask before leaving unsaved changes`.

### Task 6: Profile list and labels

**Files:**

- Create: `apps/web/src/lib/preferences/profiles.ts`, `apps/web/src/lib/setup/place-label.ts`
- Modify: `apps/web/src/components/setup/review.tsx` (use `placeLabeler`)
- Test: `apps/web/src/lib/preferences/profiles.spec.ts`, `apps/web/src/lib/setup/place-label.spec.ts`

**Interfaces:**

- Produces in `place-label.ts`: `placeLabeler(lists: { regions: PickerOption[]; countries: PickerOption[]; cities: PickerOption[] }): (place: Place) => string`, moved from `review.tsx` with its output unchanged ("Worldwide", region, country, "city, country").
- Produces in `profiles.ts`:
  - `type ProfileListItem = { id: string; position: string; firstPlace: Place | null; hasResume: boolean }`
  - `loadProfileList(supabase): Promise<ProfileListItem[]>`: `profiles` rows `id, position, locations, resumeKey`, ordered by `createdAt`, then `id`. `firstPlace` is the first place of `remote`, then `hybrid`, then `onsite`. Read errors throw `loadError` from `lib/setup/load.ts`.
  - `profileLabels(items: ProfileListItem[], positionLabel: (code: string) => string, placeLabel: (p: Place) => string): Map<string, string>`: the position label, plus `" · " + placeLabel(firstPlace)` only when another item has the same position. With no place, it adds " · 2", " · 3" in list order.
  - `MAX_PROFILES = 5`.

- [ ] **Step 1: Write failing tests:**
  - `profileLabels`: unique positions → plain labels; two `backend_engineer` with Berlin and Remote-worldwide → "Backend engineer · Berlin" and "Backend engineer · Worldwide"; a clash with no places → "· 2" on the second.
  - `loadProfileList`: maps the row fields and picks `firstPlace` from remote before hybrid before onsite.
  - `place-label.spec.ts`: one case per place kind. `review.spec.tsx` stays green.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/preferences src/lib/setup/place-label.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/components/setup/review.spec.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): profile list and labels for preferences`.

### Task 7: Preferences pages

**Files:**

- Create under `apps/web/src/app/(app)/preferences/`:
  - `layout.tsx`: loads `loadProfileList` and the value lists, then renders `PreferencesNav` and the children in a two-column grid (`md:grid-cols-[14rem_1fr]`).
  - `page.tsx`: `redirect('/preferences/contacts')`.
  - `contacts/page.tsx`, `eligibility/page.tsx`
  - `profiles/[profileId]/layout.tsx`: `requireOwnProfile`, a heading with the profile label.
  - `profiles/[profileId]/page.tsx`: redirect to `…/job`.
  - `profiles/[profileId]/job/page.tsx`, `terms/page.tsx`, `resume/page.tsx`
  - `actions.ts`, `guard.ts`
- Create: `apps/web/src/components/preferences/preferences-nav.tsx` (client), `section.tsx` (client)
- Modify: `apps/web/src/components/layout/app-nav.tsx` (`NAV_ITEMS` += `{ href: '/preferences', label: 'Preferences', icon: SlidersHorizontal }`), `docs/roadmap/phase-1-accounts-and-preferences/08-edit-preferences-ui.md`
- Test: `apps/web/src/app/(app)/preferences/guard.spec.ts`, `apps/web/src/components/preferences/section.spec.tsx`, `preferences-nav.spec.tsx`

**Interfaces:**

- Consumes: Tasks 1–6.
- Produces:
  - `requireOwnProfile(profileId: string): Promise<{ supabase; userId: string; profileId: string }>` in `guard.ts`: no claims → `redirect('/sign-in')`; a non-uuid id, or a profile RLS doesn't return → `notFound()`.
  - Server actions in `actions.ts`, run as the signed-in user like `(flow)/setup/actions.ts`: `saveContactsAction(input)`, `saveEligibilityPrefsAction(input)` (→ `saveEligibility`), `saveProfileJobAction(profileId: string, input: unknown)`, `saveProfileTermsAction(profileId: string, input: unknown)`. Pages pass the profile ones bound: `saveProfileJobAction.bind(null, profileId)`.
  - `Section({ title, lead?, formId, children })`: a frame for one form outside setup. It shows the title, the `_form` error as `role="alert"`, and a "Save changes" submit button targeting `formId` with `loading` from the form's status. It owns the `onStatusChange` and `onDirtyChange` callbacks (stable, via `useCallback`), wires `onDirtyChange` into `useUnsavedChanges().setDirty`, and on saved shows `toast.success('Saved')` and calls `router.refresh()` (so a changed position relabels the nav). It passes the callbacks to its child through a render prop: `children: (props: { formId; onStatusChange; onDirtyChange; onSaved }) => ReactNode`.
  - `PreferencesNav({ items, labels, current })` builds `VerticalNav` groups: **You** (Contacts `/preferences/contacts`, Where you can work `/preferences/eligibility`) and **Profiles** (one item per profile, `/preferences/profiles/<id>`, badge "Needs a resume" when `!hasResume`, and then the item links to `…/resume` instead; the selected profile has children: The job you want `…/job`, Location and terms `…/terms`, Resume `…/resume`). `onNavigate` goes through `confirmLeave`. PR 1 has no group action; Task 12 adds "+ New profile".
- Page contents:
  - Contacts: `loadAbout` → `AboutForm withName={false}`, `onSave={saveContactsAction}`.
  - Eligibility: `loadEligibility` → `EligibilityForm`.
  - Job / Terms: `loadSetupProfile(supabase, profileId)` → `JobForm` / `TermsForm` (`hasProfile` true) with the value lists, lead text as in setup ("We only show you jobs that match every answer here." on Job).
  - Resume: `loadResume` → `ResumeField` (it saves on upload, so no Save button; use a plain heading, not `Section`).
  - Page titles: "<section label> · Preferences · 10xjobs".

- [ ] **Step 1: Write failing tests:**
  - `guard.spec.ts` (Review Focus 2): a non-uuid id → `notFound`; a uuid RLS doesn't return → `notFound`; your own → returns ids. Mock `next/navigation` and the server client as `(flow)/setup/guard.spec.ts` does.
  - `section.spec.tsx`: a saved result shows the "Saved" toast and calls `router.refresh`; `_form` shows as an alert; a dirty child sets the guard dirty; saved sets it clean.
  - `preferences-nav.spec.tsx`: both group headings; "Needs a resume" on a profile without a resume; children only under the current profile; a click while dirty opens the discard dialog.
- [ ] **Step 2: Run** `npx nx test web -- src/app/(app)/preferences src/components/preferences`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes, actions, components and nav item. Update the roadmap brief: settle "For the slice spec" (one page with side tabs, save per section, no visible history), add "several profiles: in scope (spec 2026-11-09)", and "admin invite page: stays a script".
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check** on the local stack (`npx nx dev web`, a finished setup user from `pnpm users link <email>`): edit and save each section, and reload to see the value stored; change the position and the nav label updates; leave a dirty section and get the dialog; check at 360px wide. Record it in the PR description.
- [ ] **Step 6: Commit** `feat(web): preferences page to edit setup answers`.

---

## PR 2: Many profiles

Branch `feat/many-profiles` from `main` after PR 1 merges. Tasks 8–14.

### Task 8: Draft payload version 2

**Files:**

- Modify: `apps/web/src/lib/setup/answers.ts`
- Test: `apps/web/src/lib/setup/answers.spec.ts`

**Interfaces:**

- Produces: `export const jobShape`, `export const termsShape` (now exported), and

  ```ts
  type NewProfileDraft = { version: 2; newProfileId: string; copyFrom: string | null; job?: JobAnswers; terms?: TermsAnswers };
  function parseNewProfileDraft(json: unknown): NewProfileDraft | null;
  ```

  `newProfileId` and `copyFrom` are uuids. `parseDraft` stays version 1 only, so setup ignores a version-2 draft and the new-profile flow ignores a version-1 draft.

- [ ] **Step 1: Write failing tests:** a valid v2 parses; a v1 → `parseNewProfileDraft` null; a v2 → `parseDraft` null; a bad uuid → null.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/setup/answers.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): new-profile draft payload`.

### Task 9: `create_profile_from_draft` function

**Files:**

- Create: `libs/database/src/migrations/app/<UTC yyyymmddThhmm>_create_profile_from_draft/` with `migration.ts`, `ops.json`, `migration.json`, modelled on `20261108T1324_create_profile_from_setup_idempotent` (same start and end contract hash, the current one in `refs/db.json`; one `rawSql` op, `operationClass: 'data'`, `invariantId: 'create-profile-from-draft'`)
- Modify: `libs/database/src/migrations/app/refs/db.json` (append `"create-profile-from-draft"` to `invariants`), `libs/database/src/supabase/database.types.ts` (regenerated with `pnpm db:types`)
- Test: `apps/db-tests/src/new-profile.db.spec.ts`

**Interfaces:**

- Produces: `public.create_profile_from_draft(p_profile_id uuid, p_profile jsonb, p_skills jsonb) RETURNS uuid`, `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`, `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`. In order:
  1. `SELECT … FROM profile_setup_drafts WHERE "userId" = auth.uid() FOR UPDATE` (a second call waits here).
  2. If a profile `p_profile_id` owned by `auth.uid()` exists: delete the draft if one was found, then `RETURN p_profile_id` (idempotent).
  3. No draft, or `draft.answers->>'newProfileId'` ≠ `p_profile_id::text` → `RAISE … ERRCODE 'P0002', MESSAGE 'no new-profile draft to create a profile from'`.
  4. `count(*)` of the user's profiles ≥ 5 → `RAISE … ERRCODE 'P0001', MESSAGE 'You can have at most 5 profiles'`.
  5. Insert the profile with `id = p_profile_id` (same column list and `COALESCE`s as `create_profile_from_setup`), insert the skills, delete the draft, `RETURN p_profile_id`.
- `create_profile_from_setup` is not changed.

- [ ] **Step 1: Write failing db-tests** with `seedProfile`, `seedSetupDraft` (extend it to accept v2 answers if needed) and `createTestUser`:
  - `creates a second profile when the user already has one`: one seeded profile + a v2 draft → returns `p_profile_id`; 2 profiles; skills inserted; draft gone.
  - `a repeated call returns the same profile and inserts nothing` (Review Focus 1): call twice → same id, still 2 profiles.
  - `refuses an id that isn't the draft's`: P0002, nothing written.
  - `refuses a sixth profile`: 5 seeded → P0001, draft kept.
  - `can't use another user's draft`: user B calling with A's `newProfileId` → P0002.
  - The existing `setup-draft.db.spec.ts` stays green.
- [ ] **Step 2: Run** `pnpm db:reset && pnpm db:test`. Expected: the new spec FAILS (function missing).
- [ ] **Step 3: Write the migration**, update `refs/db.json`, run `pnpm db:reset`, then `pnpm db:types`.
- [ ] **Step 4: Run** `pnpm db:test`. Expected: PASS, all specs.
- [ ] **Step 5: Commit** `feat(db): create_profile_from_draft for additional profiles`.

### Task 10: New-profile saves and resume copy

**Files:**

- Create: `apps/web/src/lib/preferences/new-profile.ts`, `apps/web/src/lib/resume/copy.ts`
- Test: `apps/web/src/lib/preferences/new-profile.spec.ts`, `apps/web/src/lib/resume/copy.spec.ts`, and a case in `apps/db-tests/src/resume-storage.db.spec.ts`

**Interfaces:**

- Consumes: `parseNewProfileDraft` (Task 8), `create_profile_from_draft` (Task 9), `saveProfileJob`'s helpers (Task 1), `loadSetupProfile`, `toProfileWrite`, `confirmResume`, `newResumeKey`, `MAX_PROFILES`.
- Produces in `new-profile.ts`:
  - `type NewProfileSource = { kind: 'blank' } | { kind: 'copy'; profileId: string }`
  - `startNewProfile(supabase, userId, source, deps?): Promise<'started' | 'limit' | 'failed'>`: profiles count ≥ `MAX_PROFILES` → `'limit'`. Otherwise it upserts the user's draft row (`onConflict: 'userId'`, replacing any v1 or v2 draft) with `{ version: 2, newProfileId: crypto.randomUUID(), copyFrom, job?, terms? }`. For a copy, `job` and `terms` come from `loadSetupProfile(source.profileId)` and `copyFrom` is that id. A source RLS doesn't return → `'failed'`.
  - `loadNewProfileDraft(supabase): Promise<NewProfileDraft | null>`
  - `saveNewProfileJob(supabase, userId, input, isSearchable, deps?): Promise<SaveResult>`: validates; no v2 draft → `{ status: 'invalid', errors: { _form: 'Start the new profile again' } }`; otherwise updates the draft's `job`, keeping the rest.
  - `type CreateResult = SaveResult | { status: 'created'; profileId: string }`
  - `saveNewProfileTerms(supabase, userId, input, deps?): Promise<CreateResult>`: validates; writes `terms` into the v2 draft (an `update`, not an upsert, as `saveTerms` does). If the draft has a valid `job`, it calls `create_profile_from_draft` with `newProfileId` and `toProfileWrite(job, terms)`, then, when `copyFrom` is set, `copyResume(…, copyFrom, newProfileId)` (its failure is logged, not returned), and returns `created`. If the draft row is already gone (the update matched nothing, a double submit) but a profile `newProfileId` exists → `created` with that id. P0001 → `invalid` with the message under `_form`.
  - `discardNewProfile(supabase, userId): Promise<'discarded' | 'failed'>`: deletes the user's draft row.
- Produces in `copy.ts`: `copyResume(supabase, userId, fromProfileId, toProfileId, deps?): Promise<ConfirmResult | { status: 'none' }>`. It reads the source's `resumeKey` and `resumeFilename` (none → `'none'`) and makes `key = newResumeKey(userId, toProfileId)`. It tries `bucket.copy(sourceKey, key)`; on error it falls back to `download` + `upload` (`contentType: 'application/pdf'`, `upsert: false`). Then it returns `confirmResume(supabase, userId, { profileId: toProfileId, key, filename })`.

- [ ] **Step 1: Write failing tests:**
  - `startNewProfile`: 5 profiles → `limit`; blank → draft `{version:2, copyFrom:null}` with no job or terms; copy → the job and terms equal `loadSetupProfile`'s output and `copyFrom` is the source; an existing v1 draft is replaced.
  - `saveNewProfileJob`: no draft → `_form` "Start the new profile again"; keeps existing `terms`.
  - `saveNewProfileTerms`: with job → rpc called with `p_profile_id = newProfileId` → `created`; `copyFrom` set → `copyResume` called with (source, newProfileId); `copyResume` returning `failed` or `none` still gives `created` (Review Focus 4); a second call after the draft is gone with the profile present → `created` with the same id (Review Focus 1); P0001 → `invalid` `_form` "You can have at most 5 profiles"; no job yet → `saved`.
  - `copyResume`: no source resume → `none`; copy ok → `confirmResume` called with the new key under `<userId>/<toProfileId>/`; copy error → download + upload path; logs carry no key or filename.
  - db-test in `resume-storage.db.spec.ts`: a user can `copy` their own resume into their own other profile's folder; copying into another user's profile folder is refused.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/preferences src/lib/resume/copy.spec.ts`, then `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): new-profile saves and resume copy`.

### Task 11: `StepFrame` for flows other than setup

**Files:**

- Modify: `apps/web/src/components/setup/step-frame.tsx`
- Test: `apps/web/src/components/setup/step-frame.spec.tsx`

**Interfaces:**

- Produces: an optional `flow?: { steps: readonly { id: string; label: string }[]; pathFor: (id: string) => string }` prop on `StepFrame`, plus `step: string` when `flow` is given. It defaults to today's setup steps (with Review) and `/setup/<id>`. `Steps` progress and the default Back use the flow.
- Produces: `NEW_PROFILE_STEPS = [{ id: 'job', label: 'The job you want' }, { id: 'terms', label: 'Location and terms' }, { id: 'resume', label: 'Resume' }]` in `apps/web/src/lib/preferences/new-profile-steps.ts`.

- [ ] **Step 1: Write failing test:** with a three-step flow, step `terms` shows "Step 2 of 3" (or the `Steps` equivalent) and Back goes to `pathFor('job')`. Existing setup cases stay green.
- [ ] **Step 2: Run** `npx nx test web -- src/components/setup/step-frame.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command plus `src/components/setup`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(web): step frame takes a flow`.

### Task 12: New-profile pages

**Files:**

- Create under `apps/web/src/app/(app)/preferences/new/`: `page.tsx` (chooser), `job/page.tsx`, `terms/page.tsx`, `[profileId]/resume/page.tsx`, `actions.ts`
- Create: `apps/web/src/components/preferences/start-chooser.tsx`, `new-profile-action.tsx`
- Modify: `apps/web/src/components/preferences/preferences-nav.tsx` (Profiles group `action`)
- Test: `start-chooser.spec.tsx`, `new-profile-action.spec.tsx`

**Interfaces:**

- Consumes: Tasks 8, 10, 11; `ResumeField` (Task 3); `MAX_PROFILES`.
- Produces:
  - Actions: `startNewProfileAction(source: NewProfileSource)` → on `started`, `redirect('/preferences/new/job')`; `saveNewProfileJobAction(input)`; `saveNewProfileTermsAction(input)`; `discardNewProfileAction()`.
  - `StartChooser({ profiles: { id: string; label: string }[] })`: a `RadioGroup` "Start from" with "Blank" and "Copy from an existing profile", nothing preselected. Choosing copy shows a `Select` of profiles. "Continue" is disabled until the choice is complete.
  - `NewProfileAction({ count: number; draftInProgress: boolean })` in the nav's Profiles group: `count >= MAX_PROFILES` → a disabled "+ New profile" button with the hint "You can have up to 5 profiles". When `draftInProgress`, it opens a dialog "You have a new profile in progress" with "Continue it" (→ `/preferences/new/job`) and "Start over" (→ `discardNewProfileAction`, then `/preferences/new`). Otherwise it links to `/preferences/new`.
- Pages:
  - `/preferences/new`: `StartChooser`.
  - `/preferences/new/job` and `/terms`: no v2 draft → redirect to `/preferences/new`. Otherwise `StepFrame` (`flow` = new-profile steps), and `JobForm` or `TermsForm` (`hasProfile={false}`) with the draft's answers as `initial`. Terms `onSaved` receives the `created` id and goes to `/preferences/new/<id>/resume`. Map `created` to `saved` for the form's `SaveResult` contract and carry the id through the action's return value (builder's choice of how).
  - `/preferences/new/[profileId]/resume`: `requireOwnProfile`, `StepFrame` step `resume`, submit label "Finish", `ResumeField` with `loadResume` (a copied resume shows with Replace). Continue is disabled until a resume exists. Finish → `/preferences/profiles/<id>`.
  - Titles: "New profile · Preferences · 10xjobs".

- [ ] **Step 1: Write failing tests:** the chooser has nothing preselected and Continue is disabled; copy needs a profile picked; blank and copy call the action with the right source. `NewProfileAction`: at 5 → disabled with the hint; with a draft → the dialog, and its two actions call the right things.
- [ ] **Step 2: Run** `npx nx test web -- src/components/preferences`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add a profile, blank or copied`.

### Task 13: Delete a profile

**Files:**

- Create: `apps/web/src/lib/preferences/delete-profile.ts`, `apps/web/src/components/preferences/delete-profile-button.tsx`
- Modify: `apps/web/src/app/(app)/preferences/profiles/[profileId]/layout.tsx`, `apps/web/src/app/(app)/preferences/actions.ts`
- Test: `apps/web/src/lib/preferences/delete-profile.spec.ts`, `apps/web/src/components/preferences/delete-profile-button.spec.tsx`

**Interfaces:**

- Produces: `deleteProfile(supabase, userId, profileId, deps?): Promise<'deleted' | 'last' | 'not-draft' | 'failed'>`. It counts the user's profiles; 1 or fewer → `'last'` without calling anything else. Otherwise it returns `deleteDraftProfile(supabase, userId, profileId)`.
- Produces: `deleteProfileAction(profileId)`. On `deleted` it redirects to the first remaining profile (`loadProfileList`), else to `/preferences/contacts`.
- `DeleteProfileButton({ profileId, label, isLast })`: `ConfirmDialog`, destructive, title "Delete <label>?", description "This removes the profile and its resume. It can't be undone.", confirm label "Delete profile". When `isLast` it's disabled, with the hint "You need at least one profile". On `not-draft` or `failed` it shows the `notifySaveFailed` toast.

- [ ] **Step 1: Write failing tests:** one profile → `last` and `deleteDraftProfile` not called; two → delegates and returns its result. Button: disabled when last; confirming calls the action; a failure toasts.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/preferences/delete-profile.spec.ts src/components/preferences`. Expected: FAIL.
- [ ] **Step 3: Implement**, with the button in the profile layout's heading row.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): delete a draft profile from preferences`.

### Task 14: Setup stays done with several profiles

**Files:**

- Modify: `apps/web/src/lib/setup/load.ts` (`loadSetupSnapshot`)
- Test: `apps/web/src/lib/setup/load.spec.ts`, `apps/web/src/lib/setup/next-step.spec.ts`

**Interfaces:**

- `loadSetupSnapshot` reads every profile (`id, resumeKey`, by `createdAt`, `id`). `profile` is the first one with a resume, else the oldest, else null. `nextSetupStep` is unchanged. A v2 draft is never returned as `draft` (it already isn't when a profile exists; also `parseDraft` rejects v2).

- [ ] **Step 1: Write failing tests:** the oldest profile without a resume plus a newer one with a resume → snapshot `profile.hasResume === true`, and `nextSetupStep` → `done` (Review Focus 5); one profile without a resume → `resume` as today; a v2 draft with no profile → `draft` null → `job`.
- [ ] **Step 2: Run** `npx nx test web -- src/lib/setup/load.spec.ts src/lib/setup/next-step.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check** on the local stack: add a blank profile, then a copied one (replace its resume, and check the source's resume is unchanged); double-click Continue on terms (one profile appears); delete a profile; try deleting the last one; reach 5 and see "+ New profile" disabled. Record it in the PR description.
- [ ] **Step 6: Commit** `fix(web): setup stays done once any profile has a resume`.

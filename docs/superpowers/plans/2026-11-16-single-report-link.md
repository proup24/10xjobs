# One "Report a mismatch" link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven per-fact "Report a mismatch" links on the job detail page with one link that opens the same dialog, where the user picks the field.

**Architecture:** `ReportDialog` gets an optional `field`. Without one, the dialog shows a required field select. With one (the review box), the select starts on that field. `MatchDetail` renders one dialog under the facts list instead of one per fact. No server changes.

**Tech Stack:** Next.js (`apps/web`), React, Base UI select via `components/ui/select`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-single-report-link-design.md`

## Global Constraints

- Server contract unchanged: `onReport({ jobId, field, proposedValue, note? })` with `field: ReportField`. Don't touch `lib/matches/report.ts`, `actions.ts` or the schema.
- Build only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).
- Trigger look unchanged: `<Button variant="link" size="xs" />`, visible text `Report a mismatch`.
- Dialog title is `Report a mismatch` in every case.
- Field select label `Field`, empty-field error `Choose a field.`, placeholder `Choose a field`.
- Picker options, in this order: Role, Seniority, Arrangement, Places, Contract type, Engagement, Salary, Years required, Tech stack, Required languages, Work authorization (`role`, `seniority`, `arrangement`, `places`, `contractType`, `engagement`, `salary`, `yearsRequired`, `techStack`, `requiredLanguages`, `workAuthorization`).

## Review Focus

1. A user changes the pre-picked field in the review box and sends: `onReport` gets the field they chose, and after the send the select goes back to the pre-picked field. (Task 1 test.)
2. The server answers `invalid` with `errors.field`: the message shows on the select, not as a toast. (Task 1 test.)
3. Both errors at once (no field and no value): both messages show, and nothing is sent. (Task 1 test.)
4. Phone width: the select trigger uses `text-base md:text-sm` like the input, so iOS doesn't zoom, and it spans the dialog (`w-full`).
5. Review row with `onReport`: the page has exactly two triggers. The facts one is named "Report a mismatch" and the review one "Report a mismatch on <label>". (Task 2 test.)

---

### Task 1: `ReportDialog` with a field picker

**Files:**

- Modify: `apps/web/src/components/matches/report-dialog.tsx`
- Test: `apps/web/src/components/matches/report-dialog.spec.tsx`

**Interfaces:**

- Produces:

  ```ts
  export function ReportDialog(props: {
    jobId: string;
    /** Pre-picks the select; omitted on the facts-list link. */
    field?: ReportField;
    /** Fact name for the trigger's aria-label ("Report a mismatch on <label>"); used only with `field`. */
    label?: string;
    onReport: Report;
  }): JSX.Element;
  ```

  `Report` is unchanged.

- [ ] **Step 1: Write the failing tests**

  Add a `choose(option)` helper to the spec, using the Base UI pattern from `setup/timezone-fields.spec.tsx`: click `combobox` named `Field`, `findByRole('option', { name })`, `pointerDown` with `pointerType: 'mouse'`, then `click`. Change `open()` to take optional props (`{ field?, label?, onReport? }`). Keep the four existing tests and pass them `field="seniority" label="Seniority"`.

  New tests:
  - `'without a field, asks which field and sends nothing until one is chosen'`: open with no field, fill "What it should say" with `Mid-level`, send. Expect `findByText('Choose a field.')`, `onReport` not called, and the `Field` combobox has `aria-invalid="true"`.
  - `'shows both errors when field and value are missing'`: open with no field, send. Expect `Choose a field.` and `Enter what it should say.`, and `onReport` not called.
  - `'sends the chosen field'`: open with no field, `choose('Tech stack')`, fill the value with `Go`, send. Expect `onReport` called with `{ jobId: 'J', field: 'techStack', proposedValue: 'Go' }`.
  - `'offers the eleven fields in order'`: open, click the combobox. Expect the `option` names to equal the list in Global Constraints.
  - `'starts on the given field and sends a changed one'`: open with `field="seniority" label="Seniority"`. Expect the combobox `textContent` to contain `Seniority`. `choose('Salary')`, fill the value, send, and expect `field: 'salary'`.
  - `'resets after a send'`: with no field, choose `Role`, fill, send, wait for the toast, reopen. Expect the combobox to show the placeholder `Choose a field` and the value input to be `''`. With `field="seniority"`: choose `Salary`, send, reopen, and expect `Seniority`.
  - `'names the trigger after the field only when one is given'`: with no field, a button named exactly `Report a mismatch`. With `field`+`label="Seniority"`, a button named `Report a mismatch on Seniority`.
  - `'shows a server field error on the select'`: `onReport` resolves `{ status: 'invalid', errors: { field: 'Bad field' } }`. Choose `Role`, fill, send. Expect `findByText('Bad field')` and `toast.error` not called.
  - `'the title is "Report a mismatch"'`: open with `field="seniority"`. Expect `getByRole('heading', { name: 'Report a mismatch' })`.

- [ ] **Step 2: Run them and confirm the new ones fail**

  Run: `npx nx test web -- report-dialog`
  Expected: the new tests FAIL (there's no `Field` combobox yet). The four existing ones pass.

- [ ] **Step 3: Implement**
  - `const REPORT_FIELD_OPTIONS: { value: ReportField; label: string }[]` in `report-dialog.tsx`, in the Global Constraints order. Keep it client-side, so `report.ts` and its zod/Supabase imports stay out of the client bundle.
  - State `chosen: ReportField | null`, initialised to `field ?? null`. Use separate errors `fieldError` and `valueError` in place of the single `error`.
  - `submit` validates both before sending. On `invalid`, route `errors.field` to `fieldError`, and `errors.proposedValue ?? errors._form ?? FAILED_TEXT` to `valueError`. On `saved`, reset `chosen` to `field ?? null` and clear the value and note.
  - Field ids come from `useId()` (`${id}-field`, `${id}-value`, `${id}-note`).
  - Select markup follows `preferences/start-chooser.tsx`: `<Field invalid={fieldError !== null} required>`, `FieldLabel` `Field`, `Select items={REPORT_FIELD_OPTIONS} value={chosen} onValueChange`. Give the `SelectTrigger` `id`, `aria-label="Field"` and `className="w-full text-base md:text-sm"`, then `SelectValue placeholder="Choose a field"` and a `FieldError`. It comes first in the `FieldGroup`.
  - Trigger: pass `aria-label={`Report a mismatch on ${label}`}` only when both `field` and `label` are set.
  - `DialogTitle` reads `Report a mismatch`. Keep the description as it is.
  - Update the doc comment to say the facts list uses it without a field and the review box with one.

- [ ] **Step 4: Run the tests**

  Run: `npx nx test web -- report-dialog`
  Expected: all PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/components/matches/report-dialog.tsx apps/web/src/components/matches/report-dialog.spec.tsx
  git commit -m "feat(web): field picker in the report-a-mismatch dialog"
  ```

### Task 2: One link under the facts list

**Files:**

- Modify: `apps/web/src/components/matches/match-detail.tsx` (`factRows` near line 335; facts `<dl>` near lines 396–418)
- Test: `apps/web/src/components/matches/match-detail.spec.tsx` (test near line 100)

**Interfaces:**

- Consumes: `ReportDialog({ jobId, field?, label?, onReport })` from Task 1.
- The review box call (`ReviewReason`, near line 152) is unchanged: it already passes `field` and `label`.

- [ ] **Step 1: Write the failing tests**
  - Replace `'offers "Report a mismatch" on each fact only with a report handler'` with `'offers one "Report a mismatch" under the facts only with a report handler'`. With no handler, expect no button matching `/report a mismatch/i`. With `onReport`, `getAllByRole('button', { name: /report a mismatch/i })` has length `1`, and its accessible name is exactly `Report a mismatch`.
  - Add `'reports a fact from the single link'`: render with `onReport` resolving `saved`. Click `Report a mismatch`, choose `Salary` (copy the `choose` helper from Task 1), fill `What it should say` with `€80k`, and send. Expect `onReport` called with `{ jobId: matchRow().jobId, field: 'salary', proposedValue: '€80k' }`.
  - Add `'a review row has the facts link and the review link'`: `renderReview({ ...reviewRow(), reviewRule: 'rule', reviewField: 'seniority' })`. Expect two buttons matching `/report a mismatch/i`: one named `Report a mismatch` and one named `Report a mismatch on Seniority`.
  - The existing review `it.each` tests stay. They now also pass through the pre-picked select, which confirms the pre-pick sends the right field.

- [ ] **Step 2: Run them and confirm they fail**

  Run: `npx nx test web -- match-detail`
  Expected: the new and replaced tests FAIL (7 links found, not 1).

- [ ] **Step 3: Implement**
  - Drop the `ReportField` column from the `factRows` tuples, and remove the `ReportField` import if nothing else uses it (`REVIEW_REPORT_FIELDS` does, so it stays).
  - Remove the per-fact `ReportDialog` inside the `factRows.map`.
  - After the facts `</dl>`, render `{onReport && <ReportDialog jobId={first.jobId} onReport={onReport} />}`. Wrap it in a `div` only if it needs spacing to sit flush left under the list. Use theme spacing only.

- [ ] **Step 4: Run the web tests**

  Run: `npx nx test web`
  Expected: all PASS, `matches-view.spec.tsx` included (it only mocks the action).

- [ ] **Step 5: Run CI checks for the web app**

  Run: `npx nx run-many -t lint test build typecheck -p web`
  Expected: all targets succeed.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/web/src/components/matches/match-detail.tsx apps/web/src/components/matches/match-detail.spec.tsx
  git commit -m "feat(web): one report-a-mismatch link under the job facts"
  ```

- [ ] **Step 7: Check at 360px**

  Run the web app, open a match and a review job at 360px width, and confirm: one link under the facts, the dialog fits with no horizontal scroll, the select opens and lists all eleven fields, and choosing one doesn't zoom the page.

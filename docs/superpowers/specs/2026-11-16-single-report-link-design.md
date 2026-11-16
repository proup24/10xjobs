# One "Report a mismatch" link

Date: 2026-11-16
Status: draft
Builds on: [listing facts](2026-11-12-listing-facts-design.md)

## Problem

On the job detail page (`apps/web/src/components/matches/match-detail.tsx`), every fact in the facts list (Role, Seniority, Arrangement, Places, Contract type, Engagement, Salary) has its own "Report a mismatch" link. That's seven identical links stacked through the list, which clutters the page.

## Goal

The facts list ends with a single "Report a mismatch" link. It opens the same dialog as today, and the dialog asks which field the report is about _(user)_.

## Non-goals

- Server-side changes. `reportMismatchAction`, `saveReport`, the `FactReport` schema and the `fact_reports` table stay as they are, and the client still sends one `field` per report.
- Changing what a report records or how it's reviewed.
- Reporting several fields in one report.

## Design

### The link

- Remove the per-fact `ReportDialog` from the facts list.
- Add one trigger below the facts list (after the `</dl>`, before the separator). It keeps today's look: `Button variant="link" size="xs"`, text "Report a mismatch" _(user)_.
- It shows only when `onReport` is passed, like today.
- The trigger no longer needs a per-fact `aria-label`, because only one link carries this text in the facts area. The review box's link keeps its own label (below).

### The dialog

`ReportDialog` takes an optional `field` instead of a required one:

- **No field passed** (the facts-list link): the dialog title is "Report a mismatch". A required "Field" select comes first, then "What it should say" and "Note (optional)" as today.
- **Field passed** (the review box): the select starts on that field and can still be changed. The title is "Report a mismatch" in both cases, since the select now shows the field.

The select is built from `components/ui/select` inside a `Field` with a `FieldLabel`, following `apps/web/DESIGN.md`. It lists all 11 `REPORT_FIELDS` in this order and with these labels:

| Field               | Label              |
| ------------------- | ------------------ |
| `role`              | Role               |
| `seniority`         | Seniority          |
| `arrangement`       | Arrangement        |
| `places`            | Places             |
| `contractType`      | Contract type      |
| `engagement`        | Engagement         |
| `salary`            | Salary             |
| `yearsRequired`     | Years required     |
| `techStack`         | Tech stack         |
| `requiredLanguages` | Required languages |
| `workAuthorization` | Work authorization |

The first seven match the facts-list terms. The last four have no line in the facts list, but the server accepts them and someone may spot one in the post, so the picker offers them too _(my call)_.

Validation:

- Submitting with no field picked shows "Choose a field." on the select, and nothing is sent.
- The "What it should say" check stays as it is.
- After a successful send, the dialog closes and resets: the field goes back to empty, or back to the pre-picked field in the review box.

Input ids (`report-${field}-value` and so on) can't depend on the field any more. Use `useId()` instead.

### The review box

Jobs in review keep the report link inside "why it's in review" _(user approved the default)_. It opens the same dialog with the field the review rests on already picked (`REVIEW_REPORT_FIELDS`). Its `aria-label` stays "Report a mismatch on <field>", because the page now has two links with the same visible text.

## Approaches

1. **Optional `field` on the existing `ReportDialog` (picked).** One component covers both uses, and the server contract doesn't change.
2. **A new standalone dialog for the facts list, with the old one kept for review.** Two near-identical forms that would drift apart. Rejected.
3. **Drop the review box link and use only the picker.** Simpler, but it loses the one-click report on the exact fact being reviewed. You chose to keep it.

## Tests

- `report-dialog.spec.tsx`:
  - With no field: the select is required and the "Choose a field." error shows when it's empty.
  - The chosen field is what `onReport` receives.
  - With a field passed: the select starts on it.
  - After a successful send, the dialog resets.
- `match-detail.spec.tsx`:
  - The facts list renders exactly one "Report a mismatch" link.
  - A review row also shows the review box link with its field pre-picked.
  - No link shows without `onReport`.
- Update any existing assertions that look for the per-fact links (`matches-view.spec.tsx`, `match-detail.spec.tsx`).

## Left to the builder

- The select's placeholder text (e.g. "Choose a field").
- Exact spacing of the single link under the list.

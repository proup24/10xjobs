# Expired Decision and Quieter Match List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the Unverified badge from the Matches list, and add a third per-user job decision, "Expired", with its own button on a match and its own tab on Applications.

**Architecture:** `job_decisions.status` gains `'expired'`, stored bare like `'applied'` (no reason, note or snapshot). The web save path, URL state, Matches detail and Applications page learn the third status. The engine's merge of decisions ranks applied > dismissed > expired.

**Tech Stack:** Next.js (apps/web), Supabase, Prisma contract + migrations (libs/database), NestJS ingest (apps/xjobs), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-17-expired-decision-and-quieter-list-design.md`

## Global Constraints

- One branch `feat/expired-decision` from an up-to-date `origin/main` (it must contain PR #79, merge `c237338`); one PR to `main`, pushed only with `git push -u origin feat/expired-decision`.
- The Prisma contract is the only schema source; the migration is generated, and `libs/database/src/migrations/app/refs/db.json` `"hash"` must be advanced to the new migration's `to` (keep `invariants` unchanged).
- Status values exactly: `'applied' | 'dismissed' | 'expired'`. URL value for the new tab: `?status=expired`.
- Copy, exactly: button **Expired**; tab **Expired**; empty text **Jobs you mark expired show here**; list/detail line **Marked expired {ago}** (e.g. "Marked expired 2 days ago"); Applications buttons on an expired job **Mark applied**, **Move to Not for me**, **Move back to Matches**.
- An expired decision never carries reason, note or matchSnapshot.
- UI built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).
- Keep the `unverified` field on `MatchedJob` and its computation in `apps/web/src/lib/matches/group.ts`.

## Review Focus

1. **Not for me → Expired on an existing row**: the update must null reason, note and matchSnapshot, or the `job_decisions_applied_bare` check refuses it. Pinned in Task 3.
2. **A Matches link to an expired job** (`/?job=<id>`) must redirect to `/applications?status=expired&job=<id>`, not to the Applied tab. Pinned in Task 3.
3. **A link naming the wrong tab** (`/applications?status=applied&job=<expired id>`) opens the Expired tab. Pinned in Task 3.
4. **Three tabs with counts at 360px** must fit with no horizontal page scroll. Checked by hand in Task 5.
5. **Undo after Expired on Matches** clears the decision through the existing toast path. Pinned in Task 4.

---

### Task 0: Branch

- [ ] **Step 1:** `git fetch origin && git switch -c feat/expired-decision origin/main`. Leave the untracked residence-location spec/plan and `.claude/settings.json` alone; bring the expired spec and this plan onto the branch.
- [ ] **Step 2:** `git log --oneline -1` shows `c237338` or later. Commit the spec and plan: `docs(spec): expired decision and quieter match list`.

### Task 1: Hide the Unverified badge

**Files:**

- Modify: `apps/web/src/components/matches/match-row.tsx:63`
- Test: `apps/web/src/components/matches/match-row.spec.tsx:74-77`

- [ ] **Step 1: Replace the test** `shows "Unverified"` with:

```tsx
it('does not show "Unverified"', () => {
  const link = renderRow([matchRow({ unverified: true })]);
  expect(within(link).queryByText('Unverified')).toBeNull();
});
```

- [ ] **Step 2:** `npx nx test web -- match-row` → FAIL (badge still rendered).
- [ ] **Step 3:** Delete the `{job.unverified && <Badge variant="warning">Unverified</Badge>}` line.
- [ ] **Step 4:** `npx nx test web -- match-row` → PASS. Also `grep -rn "Unverified" apps/web/src` returns only the design page, if anything.
- [ ] **Step 5:** Commit `feat(web): drop the Unverified badge from the match list`.

### Task 2: Schema accepts `expired`; merges rank it lowest

**Files:**

- Modify: `libs/database/src/contract/contract.prisma:1095,1109` (comment + `job_decisions_status` check)
- Create: `libs/database/src/migrations/app/<timestamp>_job_decision_expired/` (generated)
- Modify: `libs/database/src/migrations/app/refs/db.json` (`hash`)
- Modify: `libs/database/src/supabase/database.types.ts` (regenerated; likely no diff since status is `string`)
- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts:239-269` (`moveDecisions`)
- Test: `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (the decisions-merge `describe`, near line 593)

**Interfaces:**

- Produces: `job_decisions.status IN ('applied','dismissed','expired')`.

- [ ] **Step 1:** In the contract, change the check to `status IN ('applied','dismissed','expired')` and update the model comment to name "expired (the listing could not be applied to)". Leave `job_decisions_applied_bare` as is.
- [ ] **Step 2:** `pnpm --filter @xjobs/database db:migration:plan` (name it `job_decision_expired` if prompted). The generated ops must drop and re-add only the `job_decisions_status_*` check. Set `refs/db.json` `"hash"` to the migration's `to`.
- [ ] **Step 3:** `pnpm db:reset`, then against the local DB check both:
  - `INSERT ... status 'expired'` with null reason/note/snapshot succeeds;
  - `status 'expired'` with `reason 'role'` fails on `job_decisions_applied_bare`.
    Run `pnpm db:types`. Apply the migration to `ingest_test` too (see memory recipe) so the ingest spec runs rather than skips.
- [ ] **Step 4: Write failing merge tests** in the decisions-merge `describe`, same helpers (`mergeSetup`, `decide`, `save`, `decisions`):

```ts
it('keeps dismissed when a dismissed and a newer expired job merge', async () => {
  const { old, moved } = await mergeSetup();
  await decide(moved.id, 'dismissed', t1, 'role');
  await decide(old.id, 'expired', t2, null);
  await save(liJob('4483941772'), t3);
  expect(await decisions()).toEqual([{ jobId: moved.id, status: 'dismissed', reason: 'role' }]);
});

it('replaces expired with a dismissal from the merged job', async () => {
  const { old, moved } = await mergeSetup();
  await decide(moved.id, 'expired', t2, null);
  await decide(old.id, 'dismissed', t1, 'stack');
  await save(liJob('4483941772'), t3);
  expect(await decisions()).toEqual([{ jobId: moved.id, status: 'dismissed', reason: 'stack' }]);
});

it('replaces expired with applied from the merged job', async () => {
  const { old, moved } = await mergeSetup();
  await decide(moved.id, 'expired', t2, null);
  await decide(old.id, 'applied', t1, null);
  await save(liJob('4483941772'), t3);
  expect(await decisions()).toEqual([{ jobId: moved.id, status: 'applied', reason: null }]);
});
```

- [ ] **Step 5:** `INGEST_TEST_DATABASE_URL=... npx nx test xjobs -- raw.postgres` → the two "replaces expired" tests FAIL; the existing ones pass. Confirm the suite did not skip.
- [ ] **Step 6:** In `moveDecisions`, replace the `WHERE` with a rank comparison: rank applied 3, dismissed 2, expired 1; update when `EXCLUDED` ranks higher, or ranks equal and `EXCLUDED."decidedAt"` is newer. Update the doc comment: "applied beats dismissed beats expired, otherwise the newer decision wins, and on a tie the target's stays."
- [ ] **Step 7:** Re-run → all PASS, including the existing merge tests.
- [ ] **Step 8:** `grep -n "job_decisions" apps/xjobs/src/scripts/analyze-matches.ts`: every query filters `status = 'dismissed'`; nothing to change. Commit `feat(db): job decisions accept expired; merges rank it below dismissed`.

### Task 3: Save path and URL state know `expired`

**Files:**

- Modify: `apps/web/src/lib/applications/decide.ts` (`Decision` union, `saveDecision` fields)
- Modify: `apps/web/src/lib/applications/view-state.ts` (`AppStatus`, `readAppView`, `viewForJob`)
- Modify: `apps/web/src/lib/matches/selected.ts:44-51` (`decidedJobHref`)
- Tests: `decide.spec.ts`, `view-state.spec.ts` (applications), `selected.spec.ts`

**Interfaces:**

- Produces: `Decision` accepts `{ jobId: uuid, status: 'expired' }`; `type AppStatus = 'applied' | 'dismissed' | 'expired'`; `export const APP_STATUSES: readonly AppStatus[] = ['applied', 'dismissed', 'expired']` and `isAppStatus(s: unknown): s is AppStatus` in `view-state.ts`.

- [ ] **Step 1: Write failing tests.**
  - `decide.spec.ts`: `'inserts an expired mark bare'`: insert called with `{ userId: 'user-1', jobId: JOB, status: 'expired', reason: null, note: null, matchSnapshot: null }`, and no `job_matches` read.
  - `decide.spec.ts`: `'moving a dismissal to expired clears reason, note and snapshot'`: with an existing dismissed row, update called with `status: 'expired', reason: null, note: null, matchSnapshot: null` and a new `decidedAt`.
  - `decide.spec.ts`: `'stores expired bare even when a reason is sent'`: `{ jobId: JOB, status: 'expired', reason: 'role' }` saves with `reason: null` (zod strips the extra key).
  - `view-state.spec.ts`: `readAppView(new URLSearchParams('status=expired'))` → `{ status: 'expired', job: null }`; `viewForJob({ status: 'applied', job: 'j1' }, [{ jobId: 'j1', status: 'expired' }])` → status `'expired'`; `appViewHref({ status: 'expired', job: 'j1' })` → `'/applications?status=expired&job=j1'`.
  - `selected.spec.ts`: `decidedJobHref` of a row with `decisionStatus: 'expired'` → `'/applications?status=expired&job=<id>'`.
- [ ] **Step 2:** `npx nx test web -- decide view-state selected` → new tests FAIL.
- [ ] **Step 3:** Add the `expired` branch to the `Decision` union and build its fields like `applied`. Add `APP_STATUSES`/`isAppStatus` and use `isAppStatus` in `readAppView` (default `'applied'`) and `viewForJob`. `decidedJobHref` uses `isAppStatus(row.decisionStatus) ? row.decisionStatus : 'applied'`. Update the doc comments that say "applied or dismissed".
- [ ] **Step 4:** Re-run → PASS. Commit `feat(web): save and route expired decisions`.

### Task 4: Expired button on a match

**Files:**

- Modify: `apps/web/src/components/matches/match-detail.tsx:251-290` (`DecideJob`, `JobDecision`)
- Test: `apps/web/src/components/matches/match-detail.spec.tsx`, `apps/web/src/components/matches/matches-view.spec.tsx`

**Interfaces:**

- Consumes: Task 3's `Decision` accepting `'expired'`.
- Produces: `type DecideJob = (status: 'applied' | 'dismissed' | 'expired', extra?: { reason?: DismissReason; note?: string }) => Promise<boolean>`. `matches-view.tsx` needs no logic change.

- [ ] **Step 1: Write failing tests.**
  - `match-detail.spec.tsx`: extend `'shows Applied and Not for me on a match'` to also expect a button named `Expired`, and the "no buttons" case to expect it absent. Add `'Expired decides at once'`: click `Expired` → `onDecideJob` called with `('expired')`, no dialog opens.
  - `matches-view.spec.tsx`: `'Expired moves the job to Applications with Undo'`: click `Expired`, assert `decideJobAction` called with `{ jobId, status: 'expired' }`, the success toast `Moved to Applications` has an `Undo` action, and invoking it calls `clearJobDecisionAction(jobId)`. Follow the existing Applied test's mocking.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Widen `DecideJob`. In `JobDecision`, add an outline `Expired` button after `Not for me`, sharing the `pending` state with Applied (both disabled while either saves; the clicked one shows `loading`). Update the component's doc comment.
- [ ] **Step 4:** Run → PASS. Commit `feat(web): mark a match expired from its detail`.

### Task 5: Expired tab on Applications

**Files:**

- Modify: `apps/web/src/components/applications/applications-view.tsx` (`STATUS_LABELS`, `EMPTY_TEXT`, `Save`, `DecisionActions`, `byStatus`, tabs)
- Modify: `apps/web/src/components/applications/decision-row.tsx` (`decisionLine`)
- Test: `apps/web/src/components/applications/applications-view.spec.tsx`

**Interfaces:**

- Consumes: Task 3's `AppStatus`, `APP_STATUSES`, `isAppStatus`.

- [ ] **Step 1: Write failing tests.**
  - Update `'lists applied jobs by default with counts on both switches'` to three tabs: `Applied (n)`, `Not for me (n)`, `Expired (n)`.
  - `'switches to Expired in the URL, closing the open job'`: pushes `/applications?status=expired`.
  - `'shows "Marked expired" on an expired row'`: row line `Marked expired 2 days ago` (fixture `decidedAt` 2 days before `now`).
  - `'shows the empty state for each status'`: add `Jobs you mark expired show here`.
  - `'an expired job offers Mark applied, Move to Not for me and Move back'`: detail heading `Marked expired 2 days ago`, no Reason block, the three buttons present, no `Edit reason`.
  - `'Mark applied on an expired job moves it to Applied'`: `decideJobAction` called with `{ jobId, status: 'applied' }`, router pushes `/applications?job=<id>`, toast `Moved to Applied`.
  - `'Move to Not for me on an expired job saves a dismissal'`: open dialog, confirm → `decideJobAction` with `status: 'dismissed'`, push `/applications?status=dismissed&job=<id>`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement:
  - `STATUS_LABELS.expired = 'Expired'`, `EMPTY_TEXT.expired = 'Jobs you mark expired show here'`; `byStatus` built from `APP_STATUSES`; tabs rendered from `APP_STATUSES`; `onValueChange` guarded by `isAppStatus`.
  - `Save` input widens to include `{ status: 'expired' }` (unused from this page today, keeps the type honest).
  - `DecisionActions` switches on `row.status`: applied → as today; dismissed → as today; expired → heading `Marked expired {ago}`, buttons `Mark applied` (secondary), `Move to Not for me` (outline, opens `DismissDialog` with no initial values), then `Move back to Matches`.
  - `decisionLine`: `expired` → `Marked expired ${ago}`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Manual check: `npx nx dev web` against the local stack with one decision of each status; at 360px wide the three tabs with counts fit with no horizontal page scroll (shrink tab padding via existing `TabsTrigger` props or drop to text-xs only if they don't). Mark a match Expired, see it under Expired, Mark applied, Move back.
- [ ] **Step 6:** Commit `feat(web): Expired tab on Applications`.

### Task 6: Verify and open the PR

- [ ] **Step 1:** `npx nx run-many -t lint test build typecheck` → all green (re-run once if `next build` dies on the advisory `SecurityFatalError` flake).
- [ ] **Step 2:** `pnpm db:test` → green (RLS registry unchanged; confirm).
- [ ] **Step 3:** `git push -u origin feat/expired-decision` and `gh pr create --base main` with a body listing: badge removed, new status + migration (applies on dev at deploy), merge precedence, the Expired tab.

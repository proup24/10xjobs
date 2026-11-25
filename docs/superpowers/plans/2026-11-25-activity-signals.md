# Activity Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a job's link and choosing on a review keep a user's searches running (PR 1). A webhook receiver keeps its user active only by calling a signed callback API, which can also report applied or dismissed and write the decision (PR 2).

**Architecture:** The pause rule stays in one SQL function, `pausedUsersCte`, and `userState.lastActiveAt` mirrors it. PR 1 adds two `NOT EXISTS` clauses. PR 2 adds a `webhook_callbacks` log (the new signal, and the replay guard) and `job_decisions.source`. It also adds an engine route `POST /api/webhooks/callback` behind the engine key, with its own HMAC guard and a per-webhook throttle. A pass-through route in `apps/web` forwards receivers' requests to it with the engine key.

**Tech Stack:** Prisma Next contract and migrations, Supabase Postgres, NestJS engine (Vitest, `*.postgres.spec.ts`), `apps/db-tests` (RLS), `@xjobs/engine-client`, Next.js App Router route handlers.

**Spec:** `docs/superpowers/specs/2026-11-24-activity-signals-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

## Global Constraints

- The signal window is `(at − hours, at]` with `hours = SEARCH_PAUSE_AFTER_HOURS` (default 24), the same as every existing signal.
- **PR 1 signals:** `job_views."viewedAt"` and `match_reviews."createdAt"`, both scoped by `"userId"`.
- **PR 2 signal:** `webhook_callbacks."receivedAt"` replaces the `webhook_deliveries … kind = 'match' AND status = 'delivered'` clause, in both `pausedUsersCte` and `userState`.
- **Callback headers:** `X-10xjobs-Webhook` (the webhook id), `X-10xjobs-Timestamp` (Unix seconds), `X-10xjobs-Signature` (`v1=` + hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by `webhooks.secret`). Reuse `signature()` from `apps/xjobs/src/modules/webhooks/sender/sign.ts`. Timestamps are accepted within 300 s either way, and the comparison is constant-time (`timingSafeEqual`).
- **Body v1:** `{version:1,type:'ping'}` or `{version:1,type:'feedback',jobId,status:'applied'|'dismissed',reason?,note?}`. `reason` must be in `DISMISS_REASONS` (`@xjobs/database/enums`). `note` is trimmed and at most 500 characters. Both are allowed only when `status` is `dismissed`.
- **Response 200:** `{version:1,result}`, where `result` is one of `ok | saved | already_decided | not_matched | invalid`.
  - `saved` and `already_decided` also carry `jobId`, the job actually decided (after any merge).
  - `already_decided` also carries `decision: 'applied' | 'dismissed' | 'expired'`.
  - `invalid` also carries `error`, a short string.
- **Errors:**
  - `401` with no detail: unsigned, bad signature, stale or future timestamp, unknown webhook, or a replay. These are never logged as callbacks.
  - `429`: past 60 authenticated requests in a minute for one webhook. These are not logged either.
  - `413`, from the web route only: a body over 16 384 bytes.
- **Every authenticated, unthrottled request is logged in `webhook_callbacks` before any feedback is applied.** The log write and the decision write share one transaction.
- **Feedback writes:** follow `mergedIntoId` to the root (at most 10 steps, as `loadPayloadInput` does). The user must have a `job_matches` row for the root job. An existing decision is never changed. A new decision gets `source = 'webhook'`, and a dismissal gets `matchSnapshot` with the same shape as `saveDecision` (`{profileId,outcome,matcherVersion,checks}[]`).
- **`webhook_callbacks` columns:**
  - `id`, `userId`, `webhookId`
  - `receivedAt`
  - `type`, one of `ping | feedback | invalid`
  - `jobId`, nullable, with no FK
  - `result`, a check on the five values above
  - `signature`, `+Timestamps`
  - **Constraints:** unique `(webhookId, signature)`; index `(userId, receivedAt)`; FK `(webhookId, userId) → webhooks(id, userId)` on delete cascade; RLS on with one owner `SELECT` policy and no write policies. Rows older than `WEBHOOK_CONFIG.retentionDays` (30) are deleted in `applyRetention`.
- **`job_decisions.source`:** `String @default("app")`, check `source IN ('app','webhook')`. `saveDecision`'s update sets `source: 'app'`.
- **Migrations:**
  1. Run `pnpm --filter @xjobs/database db:migration:plan`.
  2. Set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`. Keep every invariant.
  3. Run `pnpm db:reset`, then `pnpm db:types` (CI diffs `database.types.ts`).
- **Workflow:**
  - Work in the worktree `.worktrees/activity-signals`.
  - **PR 1 (Tasks 1–2):** branch `feat/activity-views`, which carries the spec, this plan and part 1.
  - **PR 2 (Tasks 3–7):** branch `feat/webhook-callbacks`, cut from `main` only after PR 1 has merged (the stacked-PR trap).
  - Push only with `git push -u origin <branch>`, and open with `gh pr create --base main`.
- Engine Postgres specs need `PROCESSOR_TEST_DATABASE_URL` (the disposable `processor_test` DB). RLS specs run with `pnpm db:test`. CI runs `npx nx run-many -t lint test build typecheck`.
- Log lines carry ids, results and counts only. Never log the secret, the signature or the body.

## Review Focus

1. **A receiver re-sends the identical signed request**, for example on a retry after a timeout. Expected: the first gets its result and the second gets `401` and writes nothing. Test in Task 4 (`refuses a replayed signature`).
2. **Feedback for a job merged into another.** Expected: the decision lands on the root job, and the response's `jobId` is the root. Test in Task 4 (`follows a merge to the root job`).
3. **The web route receiving a body the framework would re-serialize** (whitespace, key order, unicode). Expected: the engine sees the exact bytes and the signature verifies. Test in Task 6 (`forwards the raw bytes unchanged`).
4. **A request that's signed but has a malformed body** (not JSON, wrong version, `reason` on `applied`). Expected: `200 invalid`, logged, and it counts as activity. Test in Task 5 (`an invalid body still counts as activity`).
5. **Two feedback calls racing on the same job.** Expected: one `saved` and one `already_decided`, never a 500. Test in Task 4 (`a concurrent insert answers already_decided`): insert with `ON CONFLICT ("userId","jobId") DO NOTHING`, then read the row.

---

## PR 1: viewing and reviewing count

### Task 1: Two new signals in the pause rule and in lastActiveAt

**Files:**

- Modify: `apps/xjobs/src/modules/activity/activity.sql.ts` (`pausedUsersCte` and its doc comment)
- Modify: `apps/xjobs/src/modules/activity/activity.repository.ts` (`userState`'s `GREATEST`, and the `SearchesState` comment "four" becomes "every")
- Test: `apps/xjobs/src/modules/activity/activity.postgres.spec.ts`

**Interfaces:**

- Consumes: the existing spec helpers `waitingUser`, `seedJob`, `seedMatch`, `paused`, `hoursBefore`.
- Produces: the new helpers `seedView(userId, jobId, viewedAt: Date)` and `seedReview(userId, profileId, matchId, jobId, createdAt: Date)` in the spec. Add `job_views, match_reviews` to the `TRUNCATE` list.

- [ ] **Step 1: Write the failing tests** inside `describe('each signal keeps the user active')`:
  - `it('a job view')`: `waitingUser(25)` plus a view of another matched job at `hoursBefore(1)`. Expect `paused()` to be `[]`.
  - `it('a review choice')`: `waitingUser(25)` plus a `match_reviews` row (`choice: 'qualified'`, `rule: 'location'`, `field: 'arrangement'`) at `hoursBefore(1)`. Expect `[]`.
  - Extend `'not a signal exactly H hours before, nor one after the tick'` with a view at `hoursBefore(H)` and a review at `hoursBefore(-1)`. It still expects `[u.builderId]`.
  - `it('a view wakes a paused user on the next tick')`: paused at `at`; after a view at `at + 1 min`, `pausedUsersCte` read at `at + 2 min` gives `[]`. Use `repo.pausedBuilderIds(BOARD, t, H)` with the later `t`.
  - Extend `'userState: lastActiveAt is the latest signal'` so that a view newer than every other signal is the result, then a review newer still.
- [ ] **Step 2: Run them and see them fail.** Run `PROCESSOR_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/processor_test npx nx test xjobs -- activity.postgres`. Expected: the new cases fail, because the user is still paused or `lastActiveAt` is older.
- [ ] **Step 3: Implement.** Add two `AND NOT EXISTS` clauses to `pausedUsersCte`, each windowed like the decision clause: `public.job_views v` on `v."viewedAt"`, and `public.match_reviews r` on `r."createdAt"`. Add `max(v."viewedAt")` and `max(r."createdAt")` to `userState`'s `GREATEST`. The doc comment lists six signals.
- [ ] **Step 4: Run the spec file, which should pass in full.**
- [ ] **Step 5: Commit** with `feat(activity): job views and review choices count as activity`.

### Task 2: Docs and PR 1

**Files:**

- Modify: `docs/superpowers/specs/2026-11-23-paused-searches-design.md`. Append a section `## Amendment (2026-11-25)` saying that job views and review choices count (see the activity-signals spec). Task 7 adds the part 2 line.
- Modify: `docs/roadmap/phase-3-find-quality/12-activity-signals.md`. Under Scope, record the owner's answers to the open questions: the detail panel doesn't count, only the first view is kept, review choices count, a callback writes a decision, there's no notice outside the app, and webhook users get no longer window. Link the spec and this plan.

- [ ] **Step 1: Write both doc changes.**
- [ ] **Step 2: Run** `npx nx run-many -t lint test build typecheck`. Expected: green.
- [ ] **Step 3: Rename the branch and open the PR.** Run `git branch -m docs/activity-signals feat/activity-views`, then `git push -u origin feat/activity-views`, then `gh pr create --base main`. In the PR body, ask for a dev check after deploy: the next pause tick does not pause a user who viewed a job in the last 24 hours.

## PR 2: the callback API

Start only after PR 1 has merged. From the worktree, run `git fetch origin && git switch -c feat/webhook-callbacks origin/main`.

### Task 3: Schema: `webhook_callbacks` and `job_decisions.source`

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`. Add `model WebhookCallback` (`@@map("webhook_callbacks")`, `@@rls`) with the columns, checks, indexes and FK from Global Constraints, the back-relations on `User` and `Webhook`, and the policy `webhook_callbacks_owner_read` (`"userId" = auth.uid()`). Add `source` to `JobDecision`.
- Create: the migration under `libs/database/src/migrations/app/<stamp>_webhook_callbacks/`, from `db:migration:plan`.
- Modify: `libs/database/src/migrations/app/refs/db.json` (`"hash"`) and `libs/database/src/supabase/database.types.ts` (from `pnpm db:types`).
- Modify: `apps/web/src/lib/applications/decide.ts`. The update path sets `source: 'app'`.
- Test: `apps/db-tests/src/webhook-callbacks.db.spec.ts` (new), `apps/db-tests/src/job-decisions.db.spec.ts`, `apps/web/src/lib/applications/decide.spec.ts`.

**Interfaces:**

- Produces: the table `public.webhook_callbacks` and the column `job_decisions.source`, used by Tasks 4–7.

- [ ] **Step 1: Write the failing RLS and contract specs.**
  - `webhook-callbacks.db.spec.ts`:
    - `owner reads own callbacks, not another user's`
    - `authenticated cannot insert, update or delete`
    - `a duplicate (webhookId, signature) is refused` (23505)
    - `deleting the webhook deletes its callbacks`
    - `result outside the five values is refused` (23514)
  - `job-decisions.db.spec.ts`: `source defaults to app` and `source outside app/webhook is refused`.
  - `decide.spec.ts`: an update call includes `source: 'app'`.
- [ ] **Step 2: Run `pnpm db:test` and see the specs fail,** because the table and column don't exist.
- [ ] **Step 3: Edit the contract, plan the migration, set the hash, then run `pnpm db:reset` and `pnpm db:types`.** Then edit `decide.ts`.
- [ ] **Step 4: Run `pnpm db:test` and `npx nx test web`.** Expected: green.
- [ ] **Step 5: Commit** with `feat(database): webhook callbacks log and decision source`.

### Task 4: Callback repository: log, decide, signal

**Files:**

- Create: `apps/xjobs/src/modules/webhooks/callbacks/callbacks.repository.ts`, the abstract class plus `PrismaCallbacksRepository`.
- Create: `apps/xjobs/src/modules/webhooks/callbacks/testing/memory-callbacks.repository.ts`
- Modify: `apps/xjobs/src/modules/activity/activity.sql.ts` and `activity.repository.ts`. Swap the delivered clause and the `max(deliveredAt)` for `webhook_callbacks."receivedAt"`.
- Modify: `apps/xjobs/src/modules/webhooks/repositories/webhooks.repository.ts`. `applyRetention` also deletes `webhook_callbacks` older than the retention period and returns `callbacksDeleted` (update the memory repository and the abstract type).
- Test: `apps/xjobs/src/modules/webhooks/callbacks/callbacks.postgres.spec.ts` (new), `apps/xjobs/src/modules/activity/activity.postgres.spec.ts`, `apps/xjobs/src/modules/webhooks/repositories/webhooks.postgres.spec.ts`.

**Interfaces:**

- Produces:

```ts
export interface CallbackWebhook {
  id: string;
  userId: string;
  secret: string;
}
export type Feedback = { jobId: string; status: 'applied' } | { jobId: string; status: 'dismissed'; reason?: DismissReason; note?: string };
export type CallbackResult = { result: 'ok' } | { result: 'saved'; jobId: string } | { result: 'already_decided'; jobId: string; decision: 'applied' | 'dismissed' | 'expired' } | { result: 'not_matched' } | { result: 'invalid'; error: string };
export abstract class CallbacksRepository {
  /** null when no webhook has this id (any state). */
  abstract findWebhook(id: string): Promise<CallbackWebhook | null>;
  /**
   * One transaction: inserts the log row (type from `request`, `result` from the outcome),
   * then applies feedback. Returns 'replay' when (webhookId, signature) already exists; nothing is written then.
   */
  abstract record(webhook: CallbackWebhook, signature: string, request: { type: 'ping' } | { type: 'invalid'; error: string } | { type: 'feedback'; feedback: Feedback }, at: Date): Promise<CallbackResult | 'replay'>;
}
```

- [ ] **Step 1: Write the failing Postgres spec** `callbacks.postgres.spec.ts`. Each test checks the returned value and the rows it leaves behind:
  - `findWebhook returns an off webhook too`
  - `ping logs one row and returns ok`
  - `invalid logs type invalid with result invalid`
  - `applied on a matched job inserts a webhook-sourced decision`: `source = 'webhook'`, `matchSnapshot` null.
  - `dismissed stores reason, note and the match snapshot`: the snapshot equals the user's matches mapped to `{profileId,outcome,matcherVersion,checks}`.
  - `already decided keeps the app decision`: the status is unchanged, and the result is `already_decided` with the existing status.
  - `follows a merge to the root job`: job A merged into B, with a match on B. Feedback on A decides B, and the result's `jobId` is B.
  - `a job with no match answers not_matched and writes no decision`, though the log row still exists.
  - `refuses a replayed signature`: the second `record` with the same signature gives `'replay'`, and the row count stays 1.
  - `a concurrent insert answers already_decided`: two `record` calls run with `Promise.all` on the same job give one `saved` and one `already_decided`.
- [ ] **Step 2: Activity spec.** Replace `'a delivered match webhook'` with `'a webhook callback'` (insert a `webhook_callbacks` row at `hoursBefore(1)`). Add `it('a delivered match webhook no longer counts')`, which expects the builder paused. Update the edge case and the `lastActiveAt` case. In `webhooks.postgres.spec.ts`, add `applyRetention deletes callbacks older than 30 days and keeps newer ones`.
- [ ] **Step 3: Run the three Postgres specs and see them fail.**
- [ ] **Step 4: Implement.**
  - **`record`:** insert the log row inside `db.transaction`. A 23505 on `(webhookId, signature)` returns `'replay'` and rolls back. Resolve the root with the same `WITH RECURSIVE` chain as `loadPayloadInput` (10 steps). Check `job_matches` for `(userId, rootJobId)`, then `INSERT … ON CONFLICT ("userId","jobId") DO NOTHING RETURNING id`. With no row returned, read the existing status and return `already_decided`. Write the final `result` onto the log row before the commit.
  - **`activity.sql.ts`:** the doc comment's signal list now says "a webhook callback" in place of "a delivered match webhook".
- [ ] **Step 5: Run the specs, which should pass. Then run `npx nx test xjobs`.**
- [ ] **Step 6: Commit** with `feat(webhooks): callback log, feedback decisions, callbacks replace deliveries as a signal`.

### Task 5: Engine route, signature guard and throttle

**Files:**

- Create: `apps/xjobs/src/modules/webhooks/callbacks/verify.ts`, a pure function.
- Create: `apps/xjobs/src/modules/webhooks/callbacks/body.ts`, a zod parser for body v1.
- Create: `apps/xjobs/src/modules/webhooks/callbacks/throttle.ts`, an in-memory sliding window keyed by webhook id.
- Create: `apps/xjobs/src/modules/webhooks/callbacks/callbacks.controller.ts`
- Modify: `apps/xjobs/src/modules/webhooks/webhooks.module.ts` (provider and controller), `apps/xjobs/src/modules/webhooks/config/webhooks.config.ts` (`callbackToleranceSeconds: 300`, `callbackPerMinute: 60`), and `docs/webhooks.md` (a new section `## Calling back`).
- Test: `verify.spec.ts`, `body.spec.ts`, `throttle.spec.ts` and `callbacks.controller.spec.ts`, next to each file.

**Interfaces:**

- Consumes: `CallbacksRepository` (Task 4) and `signature()` (`sender/sign.ts`).
- Produces: `POST /api/webhooks/callback`, behind `engineKeyMiddleware` like every route, with no `UserGuard`. Its contract:
  - It reads `req.rawBody` (`RawBodyRequest<Request>`).
  - It answers the spec's JSON **without** the `ResponseInterceptor` envelope. Mark the handler so the interceptor skips it, or `@Res()` and write it directly; the builder picks.
  - Its `401` and `429` use the standard `ErrorResponseDto`.

```ts
export function verifyCallback(input: { secret: string; timestamp: string | undefined; received: string | undefined; rawBody: Buffer; nowSeconds: number }): boolean;
export function parseCallbackBody(raw: Buffer): { type: 'ping' } | { type: 'feedback'; feedback: Feedback } | { type: 'invalid'; error: string };
export class CallbackThrottle {
  constructor(perMinute: number);
  allow(webhookId: string, nowMs: number): boolean;
}
```

- [ ] **Step 1: Write the failing unit tests.**
  - `verify.spec.ts`:
    - `accepts a good signature`
    - `refuses a wrong secret`
    - `refuses a stale timestamp (301 s old)`
    - `refuses a future timestamp (301 s ahead)`
    - `refuses a missing or non-numeric timestamp`
    - `refuses a signature differing in length`
  - `body.spec.ts`:
    - `parses ping`
    - `parses applied`
    - `parses dismissed with reason and note`
    - each of `invalid: not JSON`, `invalid: version 2`, `invalid: reason on applied`, `invalid: unknown reason`, `invalid: note over 500` gives `type: 'invalid'`
  - `throttle.spec.ts`: `allows 60 in a minute, refuses the 61st, allows again after the window`, and `counts webhooks separately`.
  - `callbacks.controller.spec.ts` (Nest testing module with the memory repository):
    - an unknown webhook header gives 401
    - a bad signature gives 401 and is not logged
    - a replay gives 401
    - a throttled request gives 429 and is not logged
    - `an invalid body still counts as activity`: 200 `invalid` and one log row
    - `ping` gives `{version:1,result:'ok'}` with no envelope
- [ ] **Step 2: Run `npx nx test xjobs -- callbacks` and see the tests fail.**
- [ ] **Step 3: Implement the four files and wire up the module.**
  - **Controller order:** read the webhook header, then `findWebhook`, then `verifyCallback`, then `throttle.allow`, then `parseCallbackBody`, then `record`. `'replay'` gives 401.
  - **Log:** one line per request, `webhook callback webhook=<id> result=<result>`.
  - **`docs/webhooks.md`, section `## Calling back`:**
    - the URL `<web app address>/api/webhooks/callback`
    - the headers, with a signer sample next to the existing `verify`
    - the two body shapes and the response
    - the 401, 429 and 413 cases
    - the plain warning from the spec: a receiver that never calls back lets its user's searches pause after 24 hours
- [ ] **Step 4: Run the tests, which should pass. Then run `npx nx run-many -t lint test typecheck -p xjobs`.**
- [ ] **Step 5: Commit** with `feat(webhooks): signed callback route on the engine`.

### Task 6: Web forwarding route and engine-client call

**Files:**

- Modify: `libs/engine-client/src/client.ts` (and `index.ts` exports), adding `forwardWebhookCallback`.
- Create: `apps/web/src/app/api/webhooks/callback/route.ts`
- Modify: `apps/web/src/lib/auth/session-policy.ts`. Add `'/api/webhooks/callback'` to `PUBLIC_PATHS`.
- Test: `libs/engine-client/src/client.spec.ts`, `apps/web/src/app/api/webhooks/callback/route.spec.ts`, `apps/web/src/lib/auth/session-policy.spec.ts`

**Interfaces:**

- Produces:

```ts
// EngineClient, no access token used:
forwardWebhookCallback(input: { body: Uint8Array; headers: Record<'x-10xjobs-webhook' | 'x-10xjobs-timestamp' | 'x-10xjobs-signature', string | null> }): Promise<{ status: number; body: string } | { kind: 'unavailable' }>;
export async function POST(request: Request): Promise<Response>; // route.ts, runtime nodejs
```

- [ ] **Step 1: Write the failing tests.**
  - `client.spec.ts`: `forwardWebhookCallback`
    - sends `X-Engine-Key`, the three headers and `Content-Type: application/json`
    - never sends `Authorization`
    - passes the body bytes unchanged
    - returns the engine's status and text
    - returns `unavailable` when it has no url or key, or the fetch throws
  - `route.spec.ts`:
    - `forwards the raw bytes unchanged`: a body with odd whitespace and `"é"` reaches the fake engine client byte-equal.
    - `returns the engine's status and body`
    - `413 over 16 384 bytes without calling the engine`
    - `503 when the engine is unavailable`
  - `session-policy.spec.ts`: the callback path continues with no session.
- [ ] **Step 2: Run `npx nx test engine-client web` and see the tests fail.**
- [ ] **Step 3: Implement.**
  - **The route:** reads `await request.arrayBuffer()`, checks the size, builds the engine client with `accessToken: async () => null` (it isn't used), and returns `new Response(body, { status, headers: { 'content-type': 'application/json' } })`.
  - **`forwardWebhookCallback`:** uses `doFetch` with the same timeout as other calls.
  - **Logs:** status only.
- [ ] **Step 4: Run the tests, which should pass.**
- [ ] **Step 5: Commit** with `feat(web): forward webhook callbacks to the engine`.

### Task 7: Webhook page, e2e and PR 2

**Files:**

- Modify: `apps/web/src/lib/webhook/load.ts`. `WebhookView` gains `id` and `lastCallbackAt` (the max `receivedAt` from `webhook_callbacks` under RLS).
- Modify: `apps/web/src/app/(app)/preferences/webhook/page.tsx` and `apps/web/src/components/preferences/webhook-form.tsx`. Show the callback URL (`${WEB_APP_URL or the request origin}/api/webhooks/callback`; the builder uses whichever the web app already uses for absolute URLs), the webhook id with a copy button like the secret's, "Last callback: {date}" (or "Never"), and a link to `DOCS_URL#calling-back`. Only `components/ui` and tokens.
- Create: `apps/xjobs-e2e/src/xjobs/webhook-callback.spec.ts`
- Modify: `docs/superpowers/specs/2026-11-23-paused-searches-design.md`. Add a line to the amendment: callbacks replace delivered webhooks as the signal, reversing the last non-goal. Drop the partial index `webhook_deliveries_user_delivered` in Task 3's migration only if a grep shows nothing else reads it.
- Test: `apps/web/src/lib/webhook/load.spec.ts` and the webhook form's spec.

- [ ] **Step 1: Write the failing tests.**
  - `load.spec.ts`: `lastCallbackAt` is the newest row's `receivedAt`, and null with no rows.
  - Form spec: it shows the id, the callback URL and "Never".
  - **e2e** (create a user, a published profile, a match and a webhook through the existing `support/` helpers):
    - a signed `ping` to the engine with the engine key gives 200 `ok`
    - a signed `feedback` `applied` gives `saved`, and `job_decisions` has `source = 'webhook'`
    - the same call without the engine key gives 401 from the middleware
- [ ] **Step 2: Run them and see them fail.** The commands are `npx nx test web` and `npx nx e2e xjobs-e2e`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx nx run-many -t lint test build typecheck` and `npx nx e2e xjobs-e2e`.** Expected: green.
- [ ] **Step 5: Commit, push and open the PR.** Commit with `feat(web): callback details on the webhook page`. Then run `git push -u origin feat/webhook-callbacks` and `gh pr create --base main`. The PR body carries the dev rollout:
  - the migration applies on deploy
  - nobody on dev has a webhook, so nobody loses a signal
  - after deploy, create a test webhook, send one signed `ping` through the web app's URL, and confirm a `webhook_callbacks` row and a 200 `ok`

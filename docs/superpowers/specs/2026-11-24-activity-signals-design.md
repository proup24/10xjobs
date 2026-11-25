# Activity signals for paused searches

Date: 2026-11-24
Status: draft, awaiting approval (builder check done)
Roadmap: [phase 3 slice 12](../../roadmap/phase-3-find-quality/12-activity-signals.md)
Builds on: [paused searches](2026-11-23-paused-searches-design.md) (PRs 123, 124)

## Intent

Paused searches stop a user's search builders when a qualified match has waited in their Matches list for more than 24 hours and the user shows no activity in that time. The first pause on dev (2026-11-24, 19:00 UTC) was correct by the rule and wrong in fact: the user had opened 3 jobs' post or apply links in the 24 hours before it. The rule misses things users do.

Two changes, both decided by the owner on 2026-11-24:

1. **Viewing jobs counts as activity** _(owner)_. Merely opening the app does not _(owner)_.
2. **A webhook counts only when the receiver calls back** _(owner)_. A delivered webhook (a 2xx) stops counting. Instead, any correctly signed request from the receiver to a new 10xjobs callback API counts _(owner)_. A callback can optionally report what the user did with a job (applied, dismissed), and that updates their board _(owner)_.

## Goals

- A user who opens a job's post or apply link, or chooses on a review, is active for the next 24 hours.
- A receiver can keep its user active by calling the callback API, with or without feedback.
- Feedback from a receiver writes a real decision: the job leaves Matches and shows as applied or dismissed in the app, as if the user had marked it there.
- The pause rule stays defined in one place, `pausedUsersCte`, and waking still follows from it.

## Non-goals

- Counting opening the app, a token refresh, or opening a match's detail panel _(owner: opening the app does not count; detail panel is my call, see below)_.
- A longer window, or any other special case, for webhook users. A receiver that never calls back pauses its user after 24 hours like anyone else _(owner)_.
- Telling a paused user anywhere but the existing Matches notice: no `searches.paused` event, no email _(owner)_.
- Changing what the webhook sends, its retries, hold-back or auto-disable.
- Letting a receiver read the user's matches or jobs. The callback API writes; it answers only about the request it was sent.

## Anti-goals

- **Pausing an engaged user**: someone working their list, in the app or through their own tool, gets paused.
- **A fake signal**: anyone but the user's own receiver keeping them active, or a replayed request doing it.
- **An outside tool corrupting the board**: a callback overwriting a decision the user made in the app, or deciding a job the user isn't matched with.

## Constraints

- The prisma contract is the only schema source, RLS included. New tables carry `userId` and RLS; `webhook_callbacks` is engine-written only.
- Migrations advance `app/refs/db.json` and regenerate `database.types.ts` (CI diffs it).
- The webhook secret is stored in `webhooks.secret`; only the engine and the `webhook_*` RPCs touch it. The web app never reads it.
- No webhook exists on dev today, so dropping the delivered signal affects nobody now.

## Approaches

**Part 1** has one sensible way: more `NOT EXISTS` clauses in `pausedUsersCte`, where the rule already lives and from which waking follows.

**Part 2**, where the callback endpoint lives:

- **A. A route in the NestJS engine, authenticated by an HMAC of the webhook's secret.** Picked _(owner)_. The engine holds the delivery code, the signer (`webhooks/sender/sign.ts`) and the activity SQL, so signing, decisions and the pause rule stay in one place, and a log table gives both the signal and replay protection. Receivers reach it through the web app, which forwards the request (below).
- B. A Postgres function called through PostgREST without a session, checking the signature in pgcrypto. Rejected: signature and timestamp checks in SQL, a function the anonymous role can call, no real rate limit, hard to observe.
- C. A route handler in the Next.js app. Rejected: splits the webhook across two codebases and puts the secret in the web app.

## Design

### Part 1: viewing and reviewing count (one PR, ships first)

`pausedUsersCte` (`apps/xjobs/src/modules/activity/activity.sql.ts`) gains two signals in `(at − hours, at]`:

- `job_views."viewedAt"`: the user opened a job's post or apply link from the match detail _(owner: viewing counts)_.
- `match_reviews."createdAt"`: the user chose qualified or rejected on a review _(my call: deciding a review is working the list)_.

`job_views` is used as it is _(my call)_. It keeps only the first view of each job, so rereading jobs already opened writes nothing and does not count; opening a new job's link does. Opening the detail panel writes nothing and does not count. Clicking out is an action; scrolling the same list is close to idle, and it needs no new record from the web app.

Also: the function's doc comment lists the new signals; Postgres spec cases in `activity.postgres.spec.ts` for each signal inside, at the edge of, and outside the window (including the wake case: a paused user's view wakes their builders on the next tick); and a dated amendment note at the end of the paused-searches spec pointing here.

### Part 2: the callback API (one PR, after part 1)

**Endpoint and route in.** Receivers call `POST <web app address>/api/webhooks/callback`, a route in `apps/web` _(owner: the web app forwards)_. The engine keeps its rule that no route answers without the engine key (`engineKeyMiddleware`, `apps/xjobs/src/main.ts`); this was the builder check's finding, and the owner chose forwarding over exempting a path.

- **The web route is a dumb pass-through.** It reads the raw body as bytes, never parses or re-serializes it, and forwards it with the three `X-10xjobs-*` headers and `Content-Type` to the engine's `POST /api/webhooks/callback`, adding the engine key as every engine call from the web app does (`apps/web/src/lib/engine/server.ts`). It returns the engine's status and body unchanged. It needs no Supabase session and must be left out of any sign-in redirect. It never reads `webhooks.secret`; the engine checks everything.
- It refuses a body over 16 KB with `413` before forwarding _(my call)_.
- The web app's address is already public and stable (`WEB_APP_URL` on the engine is the same address), so the docs give the path and the Webhook page shows the full URL.
- JSON body, `Content-Type: application/json`.

**Authentication** mirrors outgoing deliveries:

| Header                | Value                                                                                |
| --------------------- | ------------------------------------------------------------------------------------ |
| `X-10xjobs-Webhook`   | The webhook's id (shown on the Webhook page next to the secret).                     |
| `X-10xjobs-Timestamp` | Unix seconds when the request was signed.                                            |
| `X-10xjobs-Signature` | `v1=` + hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by the webhook's secret. |

- Signed over the raw body (the engine already enables `rawBody`). Timestamp within 5 minutes either way. Constant-time compare.
- A request that is unsigned, wrongly signed, out of the time window, for an unknown webhook, or a replay gets `401` with no detail and counts for nothing.
- Replay: a signature is accepted once. `webhook_callbacks` has a unique index on `(webhookId, signature)`; a duplicate is a replay _(my call)_.
- The webhook must exist. Whether it is on or off does not matter: the secret proves the request is the user's own tool _(my call)_.

**Body (version 1).** One of:

```json
{ "version": 1, "type": "ping" }
```

```json
{ "version": 1, "type": "feedback", "jobId": "…", "status": "applied" }
```

```json
{ "version": 1, "type": "feedback", "jobId": "…", "status": "dismissed", "reason": "salary", "note": "…" }
```

- `ping` only keeps the user active, for receivers with nothing to report.
- `feedback.status` is `applied` or `dismissed` _(owner: applied, dismissed)_. `reason` takes the app's dismiss reasons (`DISMISS_REASONS`) and `note` up to 500 characters, both optional, dismissed only. `expired` is not offered _(my call: it is the app's own judgement of a listing; easy to add later)_.
- `jobId` is the `job.id` from a delivery's payload.

**What counts.** Every authenticated request is activity, whatever happens next _(owner: the signal is the API request, not its success)_. That includes a request whose body is invalid or whose feedback is refused (unknown job, already decided): it proves the user's tool is alive. The engine logs it in `webhook_callbacks` before acting on it.

**What feedback does.** In one transaction:

- **Merged jobs follow the merge** _(my call)_. If `jobId` is a job with `status = 'merged'`, the engine follows `mergedIntoId` to the surviving job and applies the feedback there, the way decisions already move on merges. The response carries `"jobId"` of the job actually decided.
- The user must have a current match for the (surviving) job (the same check as `job_decisions_owner_insert`). Otherwise: `not_matched`, nothing written.
- If the user already has a decision on the job, **the app's decision stays** _(my call: an outside tool never overwrites the user)_. Answer `already_decided` with the current status. A later decision in the app replaces a callback's one, as any decision does today.
- Otherwise insert a `job_decisions` row with `source = 'webhook'`. A dismissal stores `matchSnapshot` exactly as `saveDecision` in `apps/web/src/lib/applications/decide.ts` does (every current match's `profileId`, `outcome`, `matcherVersion`, `checks`). Answer `saved`.
- The decision itself is also activity through the existing decision signal; the callback log already covers it.

**Response.** `200` for any authenticated request, JSON:

```json
{ "version": 1, "result": "saved" }
```

- `result`: `ok` (ping), `saved`, `already_decided` (with `"decision": "applied" | "dismissed" | "expired"`), `not_matched`, or `invalid` (with a short `error`).
- `429` past 60 authenticated requests a minute per webhook _(my call)_; a throttled request is not logged and does not count.

**Schema.**

- New `webhook_callbacks`: `id`, `userId`, `webhookId` (FK to `(id, userId)`, cascade), `receivedAt`, `type` (`ping`, `feedback`, `invalid`), `jobId` (nullable, no FK so a deleted job keeps the log), `result`, `signature`, `+Timestamps`. Unique `(webhookId, signature)`; index `(userId, receivedAt)`. RLS on; owners may read their own rows; only the engine writes. The request body is not stored beyond these fields. Rows older than 30 days are deleted by the webhook worker's existing sweep _(my call: the signal needs 24 hours, a month helps debugging)_.
- `job_decisions.source`: `'app'` (default) or `'webhook'`, with a check. The web app's writes keep the default; an app update of a callback's decision sets it back to `'app'` _(my call: so a wrong decision can be traced to a receiver)_.

**Pause rule.** In `pausedUsersCte`, the `webhook_deliveries … status = 'delivered'` clause is replaced by `webhook_callbacks."receivedAt"` in `(at − hours, at]`. The partial index `webhook_deliveries_user_delivered` is kept: the webhook page and the hold-back logic may use it; the builder checks and drops it if nothing else reads it.

**Web app.** Besides the forwarding route, the Webhook page shows the callback URL, the webhook id (needed for the header), the time of the last callback, and a link to the callback section of `docs/webhooks.md`. The time is read from `webhook_callbacks` under RLS. A decision with `source = 'webhook'` looks like any other decision; no new badge _(my call)_.

**Docs.** `docs/webhooks.md` gains a "Calling back" section: headers, signing (with a sample signer next to the existing verifier), the two bodies, the response, the rate limit, and a plain warning that a receiver that never calls back lets its user's searches pause after 24 hours without a waiting job being acted on. The paused-searches spec gets a dated amendment note that its last non-goal was reversed here.

**Tests.**

- Unit: signature check (good, bad, stale, future, wrong webhook), body parsing, result mapping.
- Postgres: callback signal in the pause rule (inside, edge, outside, and the delivered signal no longer counting); feedback writes (saved, already decided, not matched, dismissal snapshot); replay rejected by the unique index; RLS (owner reads own callbacks, cannot write them).
- e2e: one signed `ping` and one `feedback` round trip against the running engine.
- Web: the forwarding route passes the raw bytes and headers unchanged, adds the engine key, and returns the engine's answer; a body over 16 KB gets `413`.
- Engine: a callback without the engine key still gets `401` from the middleware.

## Left to the builder

- The module layout for the engine's callback controller and its signature guard (inside `modules/webhooks` or next to it), and how the guard reaches the raw body.
- Where the web route sits in `apps/web` and how it is kept out of the session middleware.
- How the throttle is held (in memory per process is fine for one hosted engine). It keys on the webhook id, since every request arrives from the web app's address.
- The exact error strings for `invalid`.
- Whether the 30-day cleanup joins the existing delivery cleanup query or runs beside it.
- Whether `webhook_deliveries_user_delivered` is still needed once the pause rule stops reading it.

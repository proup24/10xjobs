# Match webhooks

Date: 2026-11-16
Status: approved 2026-11-16
Builds on: [matching](2026-11-08-matching-design.md), [matches view](2026-11-11-matches-view-design.md), [engine hosting](2026-11-10-engine-hosting-design.md)

## Intent

A user enters one URL, and the engine POSTs every newly matched job to it. The receiver can be anything: n8n, Zapier, a custom app, or Slack or Discord through one of those. Users act on these jobs in their own tools. What they do there is none of 10xjobs' business _(user)_.

So the webhook is a general pipe out. Each request must stand on its own: the job, its links, which profile matched it and why. The receiver should never need to call back into 10xjobs.

## Goals

- A user sets, changes, turns off or removes **one webhook URL** for their account _(user)_.
- Every job that newly qualifies for one of their published profiles is POSTed once to that URL. The payload names the profile _(user)_.
- A review the user approves (moves to Matches) is sent the same way.
- Requests are signed, so a receiver can verify they come from 10xjobs.
- A failed send is retried. A webhook that keeps failing turns itself off and says so.
- The user sees recent deliveries and their status, and can send a test request.

## Non-goals

- **Slack or Discord message formats.** We send one JSON payload. Slack and Discord users route it through Zapier or n8n _(user, option A)_.
- **Several webhooks, or routing by profile.** One URL per user. The payload's `profile` lets the receiver route _(user)_.
- **Events other than "new match".** No rejections, no jobs sitting in review, and no "no longer matches" when a qualified job later flips to rejected.
- **Backfill.** Jobs a newly published profile picks up from the last 30 days are not sent (see [What gets sent](#what-gets-sent)).
- **Batching or digests.** One request per (profile, job).
- **Replaying old matches** on demand.
- **Telling the user outside the app** (email or otherwise) when a webhook turns itself off. The Webhook page shows it. An email or notification comes with a general notifications feature later _(user)_.

## Anti-goals

- **Flooding a receiver.** Publishing a profile, a `db:rematch`, a reprocess or a `MATCHER_VERSION` bump must never resend jobs or fire hundreds of old ones.
- **Sending a job twice** for the same profile as a "new" match. Receivers act on these: a duplicate can mean a duplicate application.
- **Using the engine as a proxy into private networks.** The URL is user-entered and called from the hosted engine (SSRF).
- **Leaking another user's data.** Deliveries and the secret are the owner's alone (RLS).

## Approaches

1. **A deliveries table plus a queue** _(user picked)_. The match worker writes a `webhook_deliveries` row in the same transaction as the match. A `webhook` BullMQ step sends pending rows, and a sweeper re-enqueues stuck ones. Durable, it gives the history and auto-disable a home, and it follows the processor and matcher pattern. The cost is one table and one worker step.
2. **Queue only.** The match worker enqueues straight to BullMQ. Less code, but a Redis loss or a crash between the decision and the enqueue drops sends, and there's no per-user, RLS-scoped history for the UI.
3. **A Postgres trigger through `pg_net`.** No engine code, but signing, the SSRF guard, retries and the backfill rule would all live in SQL. It ties delivery to Supabase and can't be tested with Vitest. Ruled out.

## What gets sent

A **delivery** is created for a (profile, job) when all of these hold:

1. The user has a webhook that is enabled.
2. The match becomes `qualified` for the first time for that (profile, job), or the user approves a review (`match_reviews.choice = 'qualified'`).
3. The job is **new**: its `firstSeenAt` is at or after both the profile's `publishedAt` and the webhook's `enabledSince` (see [Data](#data)). This blocks backfill, and it blocks old jobs that only qualify after a profile edit or a rule change. A job that first appeared before the user turned the webhook on is never sent _(my call: "arrive" means arrive after you subscribed)_.
4. No delivery of kind `match` exists yet for that (profile, job). This is enforced by a unique index, so re-decisions, rematch, reprocess and a qualified → rejected → qualified flip never send again. It also follows merges: when ingest merges job A into B (`A.mergedIntoId = B`), B is not sent for a profile that already got A or any other job merged into B _(my call: a merge is the same posting, and a duplicate can mean a duplicate application)_.

Unverified qualified matches (`unverified = true`) are sent, and the payload carries the flag _(my call: the matches view shows them too)_.

How each trigger creates its row:

- **Engine decision.** In `upsertMatches`, in the same transaction, insert into `webhook_deliveries ... SELECT` from the webhook and job where the rules above hold, `ON CONFLICT DO NOTHING`. The new row's id is then enqueued on the `webhook` queue.
- **Approved review.** A user inserts `match_reviews` through PostgREST. An `AFTER INSERT` trigger (`SECURITY DEFINER`) applies the same rules and inserts the delivery. The webhook sweeper finds it, since the web app can't reach BullMQ.

## Data

All in the Prisma contract, RLS on. Owners can read their rows. Writes go through RPCs or the engine, as described below.

**`webhooks`**: one per user (`@@unique([userId])`).

| Column                           | Notes                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`, `userId`                   | standard                                                                                           |
| `url`                            | `https` only, at most 2048 chars. Checked on save (see [Safety](#safety))                          |
| `secret`                         | 32 random bytes, base64url, generated by the database on create. The user can see it and rotate it |
| `enabled`                        | user toggle                                                                                        |
| `enabledSince`                   | set to `now()` whenever it goes from off to on, and on create                                      |
| `disabledReason`                 | null, `'user'` or `'failing'`                                                                      |
| `consecutiveFailures`            | reset on any 2xx. Reaching the limit sets `enabled = false`, `disabledReason = 'failing'`          |
| `lastSuccessAt`, `lastFailureAt` | for the screen                                                                                     |

The user writes through RPCs only: `webhook_save(url)`, `webhook_set_enabled(bool)`, `webhook_rotate_secret()`, `webhook_delete()` and `webhook_send_test()`. That keeps `enabledSince`, the secret and the failure counters out of the user's hands. Changing the URL resets `consecutiveFailures`. It doesn't touch `enabledSince` _(my call)_.

**`webhook_deliveries`**

| Column                              | Notes                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id` (uuid7), `userId`, `webhookId` | cascades with the webhook                                                                                            |
| `kind`                              | `'match'` or `'test'`                                                                                                |
| `profileId`, `jobId`, `matchId`     | null for `test`                                                                                                      |
| `trigger`                           | `'decision'` or `'review'`, null for `test`                                                                          |
| `status`                            | `'pending'`, `'sending'`, `'delivered'`, `'failed'` (gave up) or `'skipped'` (webhook off or deleted before sending) |
| `attempts`, `nextAttemptAt`         | retry schedule                                                                                                       |
| `lastStatusCode`, `lastError`       | `lastError` is a short, truncated reason. The response body is never stored                                          |
| `deliveredAt`                       |                                                                                                                      |
| `payload`                           | null until the engine builds it on the first send attempt, then kept, so retries send exactly the same body                                                       |

There's a unique partial index on `(profileId, jobId) WHERE kind = 'match'`. Match rows are never deleted: they are the permanent "already sent" record, since a job stays matchable while LinkedIn keeps showing it (`lastSeenAt` within 30 days), however old its first sighting. After 30 days the sweeper clears their `payload` and `lastError` to keep them small. `test` rows are deleted after 30 days _(my call)_.

## Delivery

- **The `webhook` queue and worker step** live in `src/infrastructure/jobs/steps/webhook/`, like `match/`, and run in `worker-all`. `worker-webhook` is added for running it alone.
- **One send:** load the row and the webhook. If the webhook is off or gone, mark the row `skipped`. If `payload` is null, build it from the current job facts and match and store it. Then POST the stored `payload` and record the outcome.
- **Payload building lives in the engine only.** The SQL paths (the review trigger, `webhook_send_test()`) create rows with a null payload. The check summaries the matches view shows (`apps/web/src/lib/matches/checks.ts`) move to a shared lib that both web and engine import _(my call: one source for the wording, testable with Vitest; likely its own small PR)_.
- **Request:** a 10 s timeout, redirects not followed (a 3xx counts as a failure), and `User-Agent: 10xjobs-webhooks/1`.
- **Success** is any 2xx. Then `delivered`, and the webhook's `consecutiveFailures` resets to 0.
- **Failure** is a non-2xx, a timeout, a connection error or a blocked address. Retries follow backoff: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h (7 attempts over about 21 h). After the last one the row is `failed`. A 4xx other than 408 and 429 is also retried _(my call: receivers are often misconfigured briefly)_.
- **Hold back while failing:** while a webhook's `consecutiveFailures` is above 0, only its oldest pending delivery is attempted (on its own backoff). The others wait, keep their attempt count and are not counted as failures. The first 2xx releases them, oldest first. So a burst of matches during a short outage doesn't add up to the auto-disable limit in minutes. If the head delivery gives up (`failed`), the next one becomes the head _(user)_.
- **Auto-disable:** every failed attempt bumps `consecutiveFailures`. At 10 _(user)_ the webhook turns off with `disabledReason = 'failing'`, and pending rows become `skipped` on their next attempt. Turning it back on sets a new `enabledSince`, so nothing missed while it was off is sent.
- **Sweeper** (every 60 s): enqueues `pending` rows whose `nextAttemptAt` has passed, which covers review-trigger rows, Redis loss and crashes. It returns rows stuck in `sending` for more than 5 min to `pending`, and applies retention.
- **Concurrency:** a few sends in parallel overall, and one at a time per webhook, so one slow receiver can't block the others _(builder's call on the exact numbers)_.
- **At-least-once:** a crash after the POST but before the status write can resend. The `id` header lets the receiver deduplicate, and the docs say so.

## Payload

`POST`, `Content-Type: application/json`.

Headers:

- `X-10xjobs-Delivery`: the delivery id. It is stable across retries, so the receiver can use it as an idempotency key.
- `X-10xjobs-Event`: `match.qualified` or `test`.
- `X-10xjobs-Timestamp`: unix seconds at send time.
- `X-10xjobs-Signature`: `v1=` followed by hex HMAC-SHA256 over `${timestamp}.${rawBody}`, keyed by the secret. This is the same scheme Stripe uses. Receivers should reject timestamps more than 5 min old.

Body (`version: 1`, snapshot taken at the first send attempt):

```json
{
  "version": 1,
  "event": "match.qualified",
  "deliveryId": "…",
  "createdAt": "2026-11-16T10:00:00Z",
  "profile": { "id": "…", "position": "backend_engineer", "label": "Backend engineer" },
  "trigger": "decision",
  "match": {
    "id": "…",
    "unverified": false,
    "stackScore": 0.72,
    "reasons": [{ "check": "location", "outcome": "pass", "summary": "Remote in Europe fits your remote places" }]
  },
  "job": {
    "id": "…",
    "title": "Senior Backend Engineer",
    "company": { "name": "…", "url": "…" },
    "postingUrl": "https://www.linkedin.com/jobs/view/…",
    "applyUrl": "…",
    "postedAt": "…",
    "firstSeenAt": "…",
    "locations": [{ "arrangement": "remote", "places": ["Europe"] }],
    "seniority": "senior",
    "contractType": "full_time",
    "salary": { "min": 80000, "max": 100000, "currency": "EUR", "period": "year" },
    "techStack": ["node", "postgres"],
    "languages": ["en"],
    "description": "…"
  },
  "links": { "match": "https://<app>/matches/…" }
}
```

The fields come from the same job facts and checks the matches view reads. The builder maps them and keeps the matches view's human summaries for `reasons`. Unknown facts are `null`, never left out. The `description` is the listing text, capped at 20 000 chars _(my call)_. The payload is documented in `docs/webhooks.md` with a signature-verification snippet. Adding fields is fine within version 1. Removing or renaming one bumps the version.

A **test** delivery has `event: "test"`, a sample `job` from the user's latest qualified match (or a fixed example when there isn't one), and the same headers. It's created by `webhook_send_test()`, it's rate limited to one per 10 s, and it goes through the same queue and retries.

## Safety

- **On save:** `https://` only. No credentials in the URL, no IP-literal hosts in private ranges, and no `localhost` or `.local`/`.internal` names.
- **On every send:** resolve DNS in the engine and refuse any address that is private, loopback, link-local (including `169.254.169.254`), CGNAT, multicast or reserved, for both IPv4 and IPv6. Then connect to that resolved IP (pinned, so DNS can't rebind between check and connect) with SNI and `Host` set to the hostname. A blocked address counts as a failure, with `lastError = 'blocked address'`.
- **Responses:** the response body is read to at most 1 KB and then dropped. Never log the full URL, since query strings may carry tokens. Log the host only.
- **Secrets:** the secret is visible only to its owner (RLS). It never appears in a payload or log.

## Web app

There's a new **Webhook** page under Preferences (`/preferences/webhook`), built from `components/ui` per `apps/web/DESIGN.md`:

```
Webhook
Send each new matched job to a URL as a signed POST.   [docs]

URL      [ https://hooks.zapier.com/…            ]  [Save]
Status   ● On                                    [Turn off]
         (or: ● Off: turned off after 10 failed sends. [Turn on])
Secret   ••••••••••••  [Show] [Copy] [Rotate]
         [Send test]

Recent deliveries
 10:02  Senior Backend Engineer · Acme   Backend   ✓ 200
 09:41  Platform Engineer · Foo          Platform  ⟳ retry 2 of 7 · 503
 09:15  Test                                        ✗ blocked address
```

The list shows the last 50 deliveries, read through RLS. Saving runs the same URL check client-side for the message, and the RPC enforces it.

## Testing

- Unit tests for the delivery rules (first qualify, new job, enabledSince, unique, merges: A sent then merged into B does not send B) against the processor_test Postgres recipe. Cover rematch, reprocess, a qualified → rejected → qualified flip, a backfill on publish and an edit-driven requalify, and check that none of these sends twice or sends old jobs.
- The review trigger, both approving and rejecting.
- The sender against a local HTTP server: signature, headers, 2xx, 5xx retry schedule, timeout, 3xx, auto-disable at 10, hold-back (a burst of 10 pending during an outage disables only after 10 head attempts), and skipped when off.
- The SSRF guard: a table of addresses, including IPv6 and IPv4-mapped IPv6, plus a DNS-rebinding case (resolve once, connect to the pinned IP).
- RLS: one user can't read another's webhook, secret or deliveries, and can't call the RPCs on them.
- Web: page states (none, on, off by user, off from failing), and save validation.

## Left to the builder

- Queue concurrency numbers and the HTTP client (`undici` with a custom `lookup`/`connect` fits the pinning).
- The exact `reasons` summaries and the field mapping from facts.
- Which roadmap slice this lands under, and splitting it into PRs (likely schema plus RPCs, then engine delivery, then the web page and docs).

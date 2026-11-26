# 12: Activity signals for paused searches

Found 2026-11-24 during the [slice 11](11-monday-checks.md) weekday checks on `10xjobs-dev`. The owner asked for this slice.

**Built (2026-11-26).** Part 1 is PR 133 and part 2 is PR 141. See the [spec](../../superpowers/specs/2026-11-24-activity-signals-design.md) and the [plan](../../superpowers/plans/2026-11-25-activity-signals.md).

## Built

- **Part 1 (PR 133).** Opening a job's post or apply link (`job_views."viewedAt"`, first view only) and choosing on a review (`match_reviews."createdAt"`) now count as activity in `pausedUsersCte` and `lastActiveAt`.
- **Part 2 (PR 141).** A delivered webhook no longer counts. A receiver keeps its user active only by calling the signed callback API, `POST <web app>/api/webhooks/callback`, which the web app forwards to the engine.
  - Requests are signed with the webhook secret, an HMAC of `${timestamp}.${rawBody}`, and accepted within 300 s.
  - Every authenticated request is logged in `webhook_callbacks`. That log is the new signal, the replay guard, and the source of "Last callback" on the Webhook page.
  - Feedback (`applied` or `dismissed`) writes a decision with `job_decisions.source = 'webhook'`. It follows merges and never changes an existing decision.
  - The receiver docs are in [`docs/webhooks.md`](../../webhooks.md#calling-back), under "Calling back".
- **Verified on dev (2026-11-26).**
  - Migration `20261126T1549_webhook_callbacks` is applied.
  - A signed ping through `https://10xjobs.vercel.app/api/webhooks/callback` got `200 ok` and logged one row.
  - A replay of the same request and a wrong signature both got `401` and wrote nothing.
- **Left open for the owner:**
  - Undoing a review deletes its row, so the undo is not a signal.
  - `job_decisions.source` can be set by the user on their own decisions. Nothing reads it for trust today. If it ever drives behaviour, add `WITH CHECK (source = 'app')` to the owner policies.

## Background

Paused searches (PRs 123 and 124, spec `docs/superpowers/specs/2026-11-23-paused-searches-design.md`) stop a user's search builders when a qualified match has waited in their Matches list for more than 24 hours and the user shows no activity in that time. Activity is any one of four signals (before this slice), all read by `pausedUsersCte` in `apps/xjobs/src/modules/activity/activity.sql.ts`:

- a decision on a job (`job_decisions."decidedAt"`, any status);
- a delivered match webhook (`webhook_deliveries`, `kind = 'match'`, `status = 'delivered'`, meaning the receiver answered with a 2xx);
- Resume (`users."searchesResumedAt"`);
- publishing or editing a profile (`profiles."publishedAt"`, and edits through `searchesResumedAt`).

## What dev shows (2026-11-24)

- The first pause happened at the 19:00 UTC tick: one user, 36 job-board builders, and a drop from 19 runs to 9 per tick. By the spec's rule the pause was correct: no decision, no webhook, no resume, and 41 qualified matches waiting since 2026-11-21.
- **That user was using the app.** They opened 8 jobs' post or apply links (`job_views`), 3 of them in the 24 hours before the pause, the last at 12:28 UTC. Their session also renewed its token through the day, the last time at 14:56 UTC. The owner's call: **viewing jobs counts as activity**, merely opening the app does not.
- **The webhook signal has never been exercised.** No webhook has ever existed on dev: `webhooks` and `webhook_deliveries` show 0 inserts, updates and deletes since 2026-11-03. The rule's delivery path is tested only in unit and Postgres specs.

## Scope

1. **Count viewing jobs as activity.** Add `job_views."viewedAt"` in `(t − 24h, t]` as a fifth signal (review choices, below, are a sixth) in `pausedUsersCte`. `job_views` is written by `markViewed` in the web app when the user opens a job's post or apply link from the match detail. It keeps the first view only (`ignoreDuplicates`), so a repeat view of the same job writes nothing; viewing a new job does.
2. **Count a webhook only with feedback from the receiver.** A delivered webhook (2xx) would no longer count by itself. Activity would come from the receiver reporting back what the user did with the job (applied, dismissed). This reverses a non-goal in the paused-searches spec ("A receiver calling back into 10xjobs to report applications", with delivery success chosen as the middle ground) _(owner, 2026-11-24)_. It needs a callback endpoint authenticated with the webhook's secret, a payload format in `docs/webhooks.md`, and a mapping from the callback to `job_decisions` or a new signal.

### Owner's answers (2026-11-25)

The open questions are answered _(see the [spec](../../superpowers/specs/2026-11-24-activity-signals-design.md) and the [plan](../../superpowers/plans/2026-11-25-activity-signals.md))_:

- The detail panel does not count. Only clicking out to the post or apply link writes `job_views`.
- Only the first view of each job is kept.
- Review choices count (`match_reviews."createdAt"`).
- A callback writes a decision (`job_decisions`, `source = 'webhook'`) when it reports what the user did with a job.
- There is no notice outside the app: no event, no email.
- Webhook users get no longer window: a receiver that never calls back pauses its user after 24 hours.

## Open questions

None. The owner answered them in Scope, under Owner's answers.

## Suggested path

Part 1 is small: two more `NOT EXISTS` (views and reviews) in `pausedUsersCte`, a Postgres spec case, and a line in the paused-searches spec. It can ship on its own. Part 2 is a feature with its own spec: an API, its authentication, receiver docs and the web app's webhook page.

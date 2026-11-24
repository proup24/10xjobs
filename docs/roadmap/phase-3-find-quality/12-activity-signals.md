# 12: Activity signals for paused searches

Found 2026-11-24 during the [slice 11](11-monday-checks.md) weekday checks on `10xjobs-dev`. The owner asked for this slice. Its brainstorm comes first.

## Background

Paused searches (PRs 123 and 124, spec `docs/superpowers/specs/2026-11-23-paused-searches-design.md`) stop a user's search builders when a qualified match has waited in their Matches list for more than 24 hours and the user shows no activity in that time. Activity is any one of four signals, all read by `pausedUsersCte` in `apps/xjobs/src/modules/activity/activity.sql.ts`:

- a decision on a job (`job_decisions."decidedAt"`, any status);
- a delivered match webhook (`webhook_deliveries`, `kind = 'match'`, `status = 'delivered'`, meaning the receiver answered with a 2xx);
- Resume (`users."searchesResumedAt"`);
- publishing or editing a profile (`profiles."publishedAt"`, and edits through `searchesResumedAt`).

## What dev shows (2026-11-24)

- The first pause happened at the 19:00 UTC tick: one user, 36 job-board builders, and a drop from 19 runs to 9 per tick. By the spec's rule the pause was correct: no decision, no webhook, no resume, and 41 qualified matches waiting since 2026-11-21.
- **That user was using the app.** They opened 8 jobs' post or apply links (`job_views`), 3 of them in the 24 hours before the pause, the last at 12:28 UTC. Their session also renewed its token through the day, the last time at 14:56 UTC. The owner's call: **viewing jobs counts as activity**, merely opening the app does not.
- **The webhook signal has never been exercised.** No webhook has ever existed on dev: `webhooks` and `webhook_deliveries` show 0 inserts, updates and deletes since 2026-11-03. The rule's delivery path is tested only in unit and Postgres specs.

## Scope

1. **Count viewing jobs as activity.** Add `job_views."viewedAt"` in `(t − 24h, t]` as a fifth signal in `pausedUsersCte`. `job_views` is written by `markViewed` in the web app when the user opens a job's post or apply link from the match detail. It keeps the first view only (`ignoreDuplicates`), so a repeat view of the same job writes nothing; viewing a new job does.
2. **Count a webhook only with feedback from the receiver.** A delivered webhook (2xx) would no longer count by itself. Activity would come from the receiver reporting back what the user did with the job (applied, dismissed). This reverses a non-goal in the paused-searches spec ("A receiver calling back into 10xjobs to report applications", with delivery success chosen as the middle ground) _(owner, 2026-11-24)_. It needs a callback endpoint authenticated with the webhook's secret, a payload format in `docs/webhooks.md`, and a mapping from the callback to `job_decisions` or a new signal.

## Open questions

- Should opening a match's detail panel also count? Today it writes nothing; only clicking out to the post or apply link writes `job_views`. Counting it needs a new record from the web app.
- Should the first view be the only one kept? A user rereading the same jobs every day writes no new rows, and would pause.
- For the webhook callback: does a callback write a `job_decisions` row (and so show in the app as applied or dismissed), or only count as activity? What does a receiver with no callback get: paused after 24 hours, or a longer window?
- A user whose webhook keeps failing gets no deliveries, so today they pause unless they act in the app. Should they be told why, given the webhook turns itself off after 10 failures?
- Should a match review (`match_reviews`) count as activity? Review is its own list, but deciding a review is working the list.

## Suggested path

Part 1 is small: one more `NOT EXISTS` in `pausedUsersCte`, a Postgres spec case, and a line in the paused-searches spec. It can ship on its own. Part 2 is a feature with its own spec: an API, its authentication, receiver docs and the web app's webhook page.

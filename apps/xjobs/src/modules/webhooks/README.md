# Webhooks

The webhooks module sends each new qualified match to the user's URL as a signed `POST`, and the test deliveries the user asks for. Every send is a row of `webhook_deliveries`; the row holds the retry schedule, so a lost queue message or a crash only delays a send.

Design: `docs/superpowers/specs/2026-11-16-match-webhooks-design.md`. Receiver docs: `docs/webhooks.md`.

## Flow

1. **Rows.** `webhook_enqueue_match` (SQL) creates a pending `match` row when the matcher stores a new qualified match, or when the review trigger qualifies one; `webhook_send_test()` creates a pending `test` row. Both leave `payload` null. The match step enqueues the ids it got back on the `webhook` queue; the review trigger's rows wait for the sweep.
2. **One send.** The worker calls `DeliveryService.deliver(deliveryId)`:

   | Step | Does                                                                                                                                                                                                                                                                                                                                                                                                |
   | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `claim`: one transaction with the webhook row locked `FOR NO KEY UPDATE` (new delivery rows' foreign key checks take `KEY SHARE`, which it doesn't block). Webhook off or gone: the row becomes `skipped`. Another row of the webhook `sending`: `busy`. The webhook failing and this row not its oldest pending one: `held`. Not pending or not due: nothing. Otherwise `sending`, `attempts + 1`. |
   | 2    | On the first attempt (`payload` null): build the body (`buildMatchPayload` from the match as it is now, or `buildTestPayload` from the user's latest qualified match) and store it with `savePayload`. A match deleted before then makes the row `skipped`.                                                                                                                                         |
   | 3    | `send`: the stored body, as Postgres returns it, so every attempt sends the same bytes and signature input.                                                                                                                                                                                                                                                                                         |
   | 4    | `recordSuccess` on a 2xx, `recordFailure` otherwise. On a row that vanished meanwhile (webhook deleted, rows cascade) both write nothing and resolve.                                                                                                                                                                                                                                               |

   `deliver` returns `{ result, webhookId }`, with `result` one of `delivered`, `retry`, `failed`, `skipped`, `busy`, `held` or `gone`. Nothing is sent for the last four. An error inside the engine after the claim (building the body, a database write) never escapes: `release` gives the attempt back and makes the row due after 1 min, and the result is `retry`.

   **Chain.** After a send (`delivered`, `retry`, `failed`) or a skip, `webhookId` is set and `processWebhookJob` queues that webhook's next due row (`nextDue`). So a webhook's rows drain one after another without waiting for the sweep, and a `busy` row is picked up when the row ahead of it finishes.

3. **Sweep** (every 60 s, `WEBHOOK_CONFIG.sweep`): `recoverStuck`, `applyRetention`, then `listDue` and enqueue each id (at most 200 per sweep). `listDue` returns at most one row per webhook, its head, oldest first across webhooks, so one backlogged webhook can't fill the sweep; the chain drains the rest.

## Rules

- **Success** is any 2xx: the row is `delivered`, the webhook's `consecutiveFailures` goes to 0 with `lastSuccessAt`, and its other pending rows are made due now; the chain then sends them oldest first.
- **Failure** is anything else (non-2xx, 3xx included; timeout; connection error; blocked address). The row goes back to `pending` after 1 min, 5 min, 30 min, 2 h, 6 h, then 12 h; the 7th failed attempt makes it `failed`. `lastStatusCode` and a `lastError` of at most 200 characters are kept, never the body.
- **Head.** A webhook's head is its oldest due pending row (by `createdAt`, then `id`); while it is failing (and on), its oldest pending row, which goes only once due. `listDue` and `nextDue` both use it.
- **Hold-back.** While `consecutiveFailures` is above 0, only the webhook's oldest pending row (by `createdAt`, then `id`) is attempted, on its own backoff. The others wait with their attempt count untouched, and count no failures. When the head gives up, the next row is the head. A URL change (`webhook_save`) resets `consecutiveFailures`, which releases them too.
- **Auto-disable.** Every failed attempt bumps `consecutiveFailures` and `lastFailureAt`; the 10th turns the webhook off with `disabledReason = 'failing'`. Its pending rows are then listed by the sweep regardless of hold-back and become `skipped` on their claim.
- **One at a time per webhook.** `claim` refuses a row while another of the same webhook is `sending`; the webhook row lock makes two claims at once pick exactly one.
- **Stuck rows.** A row `sending` for over 5 min (`stuckSendingMs`; the engine crashed between claim and outcome) goes back to `pending`, due now. Its attempt still counts. That send may have reached the receiver, so a delivery can arrive twice: receivers deduplicate on `X-10xjobs-Delivery`.
- **Retention** (30 days by `createdAt`): finished `match` rows keep the row (the "already sent" record) but lose `payload` and `lastError`; `test` rows are deleted.
- **Logs** name the URL's host only, never its path, query or the secret.

## Code map

- `services/delivery.service.ts`: `DeliveryService.deliver`, the one send. The sender and clock are injectable for tests (`WEBHOOK_SENDER`, `WEBHOOK_CLOCK`); `WEBHOOK_SETTINGS` carries `WEB_APP_URL` for the payload's links (null when unset).
- `repositories/webhooks.repository.ts`: every read and write, the claim and outcome rules in SQL. `testing/memory-webhooks.repository.ts` is the in-memory fake, with the same rules.
- `payload/build.ts`: the version 1 body for `match.qualified` and `test`.
- `sender/`: `send` (DNS check and pinning, 10 s timeout, no redirects, 1 KB read), `address.ts` (blocked ranges), `sign.ts` (the `v1=` HMAC).
- `config/webhooks.config.ts`: `WEBHOOK_CONFIG`, every limit above.
- The queue (`WEBHOOK_QUEUE = 'webhook'`, jobs `send` and `sweep`), its BullMQ job id (the delivery id, one BullMQ attempt) and `processWebhookJob` live in `src/infrastructure/jobs/steps/webhook/`.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/webhooks src/infrastructure/jobs/steps/webhook
```

The PostgreSQL tests (`repositories/webhooks.postgres.spec.ts`) need `PROCESSOR_TEST_DATABASE_URL`, with the same disposable `processor_test` database the processor README describes. They skip when it is absent.

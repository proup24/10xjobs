# Match Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user sets one HTTPS URL, and the engine POSTs each newly qualified job (or approved review) for their published profiles to it, signed, retried and visible on a Webhook page.

**Architecture:**

- **One SQL function creates deliveries.** `webhook_enqueue_match(matchId, trigger)` holds every send rule: enabled webhook, new job, no earlier delivery for this profile and job or a job merged with it. The matcher calls it in the `upsertMatches` transaction for qualified rows. An `AFTER INSERT` trigger on `match_reviews` calls it for approvals.
- **A new `webhook` BullMQ step sends rows.** It claims one row at a time per webhook, builds and stores the payload on the first attempt, and POSTs it over `node:https` pinned to a checked public IP. It records the outcome, applies backoff, hold-back and auto-disable.
- **A sweeper** re-enqueues due rows, which covers review rows, test rows and lost messages. It also recovers stuck `sending` rows and applies retention.
- **The web page** writes only through RPCs, and reads the webhook and its last 50 deliveries through RLS.

**Tech Stack:** NestJS 11, BullMQ, TypeScript strict (nodenext), Vitest, the Prisma contract in `libs/database` on Supabase Postgres, Next.js App Router in `apps/web` with `components/ui`.

**Spec:** `docs/superpowers/specs/2026-11-16-match-webhooks-design.md`

## Global Constraints

- **One webhook per user:** `webhooks` is `@@unique([userId])`. The URL is `https` only, at most 2048 chars.
- **Retries:** at most 7 attempts. The delays after attempts 1–6 are `[60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000]` ms. After attempt 7 fails the row becomes `failed`. Every non-2xx is retried, including 3xx and 4xx.
- **Auto-disable:** at `consecutiveFailures >= 10`, set `enabled = false` and `disabledReason = 'failing'`. Any 2xx resets the count to 0.
- **Hold-back:** while `consecutiveFailures > 0`, only the webhook's oldest pending delivery (by `createdAt`, then `id`) is attempted. The others aren't attempted and aren't counted. The first 2xx sets `nextAttemptAt = now()` on the rest.
- **Request:** POST `Content-Type: application/json`, a 10 000 ms timeout, no redirects followed, `User-Agent: 10xjobs-webhooks/1`.
- **Headers:** `X-10xjobs-Delivery` (delivery id), `X-10xjobs-Event` (`match.qualified` | `test`), `X-10xjobs-Timestamp` (unix seconds), `X-10xjobs-Signature: v1=<hex HMAC-SHA256 of "${timestamp}.${body}" keyed by the secret>`.
- **Response:** read at most 1024 bytes, never stored. `lastError` is at most 200 chars. Log the host only, never the full URL or the secret.
- **Payload:** `version: 1`. `job.description` is at most 20 000 chars. Unknown facts are `null`, never left out. Built on the first attempt, then stored and resent unchanged.
- **Sweeper:** every 60 000 ms. A row in `sending` for more than 5 min goes back to `pending`. Match rows older than 30 days get `payload` and `lastError` cleared. Test rows older than 30 days are deleted.
- **Test sends:** at most one per user per 10 s, and only while the webhook is enabled.
- **Migrations:** after `pnpm --filter @xjobs/database db:migration:plan`, set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`, or it silently never applies. Apply it to the local stack and to the `processor_test` DB too.
- **PRs:** four PRs (A–D), each branched from `main` after the one before has merged. Don't stack them: a stacked PR merged into the first branch, not `main`, before. Push as `git push -u origin <branch>` and open with `gh pr create`. The human merges.
- **Guardrails:** never read `.env*` or `private/`.

## Review Focus

1. **A user who turns the webhook off and back on** must not get the jobs that arrived while it was off. The new `enabledSince` blocks them. Test: Task 2, "re-enabling skips jobs seen while off".
2. **A hostname that resolves to both a public and a private address** must be refused, not sent to whichever address answers first. Test: Task 5, "refuses a host when any resolved address is private".
3. **A webhook deleted while a delivery is mid-send** must not make the worker crash or retry forever. The row cascades away, and the status write updates 0 rows and returns. Test: Task 7, "a delivery whose webhook was deleted mid-send ends quietly".
4. **A payload with emoji and non-ASCII text** must have its signature computed over the exact UTF-8 bytes sent. Test: Task 5, "signs the exact UTF-8 body bytes".
5. **The user changes the URL while deliveries are failing.** Pending rows go to the new URL on their next attempt, and the failure count restarts at 0, so hold-back ends. Test: Task 7, "a URL change releases hold-back".

---

## PR A: shared check wording

### Task 1: Move the check wording to `@xjobs/database/matches`

**Files:**

- Create: `libs/database/src/matches/checks.ts` (moved from `apps/web/src/lib/matches/checks.ts`), `libs/database/src/matches/index.ts`
- Move: `apps/web/src/lib/matches/checks.spec.ts` → `libs/database/src/matches/checks.spec.ts`
- Modify: `libs/database/package.json` (a `./matches` export like `./enums`)
- Modify: `apps/web/src/lib/matches/checks.ts`, which becomes a re-export so the web imports don't change

**Interfaces:**

- Produces: `checkLines(checks: unknown, labels: Labels): CheckLine[]`, `ruleLabel`, `fieldLabel`, `NOT_CHECKED` and `notCheckedText`, with unchanged behavior. In the lib, `Labels` is `Record<'positions' | 'seniorities' | 'techs' | 'countries' | 'regions' | 'cities' | 'languages' | 'currencies' | 'contractTypes', { value: string; label: string }[]>`. The web's `ValueLists` is assignable to it.

- [ ] **Step 1:** Move the file and its spec. Replace the `@/lib/setup/value-lists` import with the lib's own `Labels` type.
- [ ] **Step 2:** Run `npx nx test database` and `npx nx test web`. Expected: PASS, with the moved spec running in `database`.
- [ ] **Step 3:** Run `npx nx run-many -t lint typecheck build -p database web xjobs`. Expected: PASS.
- [ ] **Step 4:** Commit `refactor(matches): share check wording through @xjobs/database/matches`. Then push and open PR A.

## PR B: schema, RPCs and send rules

### Task 2: Tables, RLS and `webhook_enqueue_match`

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (models `Webhook` and `WebhookDelivery`, their relations on `User`, `Profile`, `NormalizedJob` and `JobMatch`, and policies)
- Create: the migration from `db:migration:plan`, plus a hand-added `rawSql` operation for the functions and trigger, like `20261112T1603_rematch_triggers`
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)
- Test: `apps/xjobs/src/modules/webhooks/repositories/enqueue.postgres.spec.ts` (uses `PROCESSOR_TEST_DATABASE_URL`, like `matcher.postgres.spec.ts`)

**Interfaces:**

- Produces, in the database:
  - `webhooks`: columns as in the spec's Data table. `secret` has the default `translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_')`. `enabledSince` defaults to `now()`. There are checks for `disabledReason IN ('user', 'failing')` and `length(url) <= 2048`.
  - `webhook_deliveries`: columns as in the spec. `id` has the default `gen_random_uuid()`. FKs cascade on webhook, profile, job and match delete. There are checks on `kind`, `trigger` and `status`, and match rows must have `profileId`, `jobId`, `matchId` and `trigger` set. There's a unique partial index `(profileId, jobId) WHERE kind = 'match'` and an index `(webhookId, status, createdAt)`.
  - RLS: owners `SELECT` both tables (`"userId" = auth.uid()`). No insert, update or delete policies.
  - `public.webhook_enqueue_match(p_match_id uuid, p_trigger text) RETURNS uuid` (null when nothing was created). It's `SECURITY DEFINER` with `SET search_path = public`. `EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated`.
  - The trigger `match_reviews_webhook` is `AFTER INSERT ... FOR EACH ROW WHEN (NEW.choice = 'qualified')`. It calls the function with `'review'`.

`webhook_enqueue_match` (the rules from the spec's "What gets sent"):

```sql
INSERT INTO webhook_deliveries ("userId", "webhookId", kind, "profileId", "jobId", "matchId", trigger, status, attempts, "nextAttemptAt")
SELECT m."userId", w.id, 'match', m."profileId", m."jobId", m.id, p_trigger, 'pending', 0, now()
FROM job_matches m
JOIN webhooks w ON w."userId" = m."userId" AND w.enabled
JOIN profiles p ON p.id = m."profileId" AND p.state = 'published'
JOIN normalized_jobs j ON j.id = m."jobId"
WHERE m.id = p_match_id
  AND j."firstSeenAt" >= p."publishedAt" AND j."firstSeenAt" >= w."enabledSince"
  AND NOT EXISTS (
    SELECT 1 FROM webhook_deliveries d JOIN normalized_jobs dj ON dj.id = d."jobId"
    WHERE d.kind = 'match' AND d."profileId" = m."profileId"
      AND (d."jobId" = j.id OR dj."mergedIntoId" = j.id OR d."jobId" = j."mergedIntoId"))
ON CONFLICT DO NOTHING
RETURNING id;
```

- [ ] **Step 1: Write the failing tests.** Seed a user, a published profile, a webhook, a job and a qualified match through SQL. Then cover:
  - "creates one pending delivery for a new qualified job": one row, `status = 'pending'`, `trigger = 'decision'`.
  - "a second call creates nothing": returns null, still one row.
  - "skips a job first seen before the profile was published", and the same for "before enabledSince".
  - "re-enabling skips jobs seen while off": `enabledSince` is set after the job's `firstSeenAt`, so the call returns null.
  - "skips when the webhook is off or missing".
  - "skips B when A was sent and A merged into B", and the reverse case.
  - "an approved review creates a delivery with trigger review", and "a rejected review creates nothing". These insert into `match_reviews` with the match in `review`.
  - "an authenticated user cannot call webhook_enqueue_match": a permission error under `SET ROLE authenticated`.
  - RLS: user B can't read user A's webhook or deliveries.
- [ ] **Step 2:** Run `PROCESSOR_TEST_DATABASE_URL=... npx nx test xjobs -- enqueue.postgres`. Expected: FAIL, relation `webhooks` does not exist.
- [ ] **Step 3:** Add the models and policies, run `db:migration:plan`, add the `rawSql`, and advance `refs/db.json`. Then apply locally and to `processor_test`, and regenerate `database.types.ts`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): webhooks, deliveries and the send rules`.

### Task 3: User RPCs

**Files:**

- Modify: the Task 2 migration's `rawSql` (same PR, not yet applied anywhere shared)
- Test: `apps/xjobs/src/modules/webhooks/repositories/rpcs.postgres.spec.ts`

**Interfaces:**

- Produces, all `SECURITY DEFINER` and acting on `auth.uid()`, `EXECUTE` granted to `authenticated` only:
  - `public.webhook_url_ok(p_url text) RETURNS boolean`. It's `IMMUTABLE` and false when:
    - the URL isn't `https://`, has userinfo or is longer than 2048 chars;
    - the host is `localhost`, ends in `.local`, `.internal` or `.localhost`;
    - the host is an IPv4 or IPv6 literal (any).
  - `public.webhook_save(p_url text) RETURNS void`. It raises `22023` `'invalid webhook url'` when `NOT webhook_url_ok`. On insert it sets `enabled = true` and `enabledSince = now()`. On a URL change it sets `consecutiveFailures = 0`.
  - `public.webhook_set_enabled(p_enabled boolean) RETURNS void`. Off → on sets `enabledSince = now()`, `consecutiveFailures = 0` and `disabledReason = null`. On → off sets `disabledReason = 'user'`. Setting the state it already has is a no-op.
  - `public.webhook_rotate_secret() RETURNS void`, `public.webhook_delete() RETURNS void`.
  - `public.webhook_send_test() RETURNS uuid`. It raises `P0001` `'webhook off'` unless the webhook exists and is enabled, and `P0001` `'too soon'` if a test row was created within the last 10 s. Otherwise it inserts `kind = 'test'`, `status = 'pending'` and `nextAttemptAt = now()`.

Rejecting all IP literals is my call: it's simpler than range checks in SQL, and the engine guard covers DNS anyway.

- [ ] **Step 1: Write the failing tests** (`SET ROLE authenticated` with `request.jwt.claims` set). Cover:
  - "save creates an enabled webhook with a 43-char secret".
  - "save rejects http, userinfo, localhost, x.internal, 10.0.0.1, [::1]".
  - "a URL change resets consecutiveFailures and keeps enabledSince".
  - "turning on moves enabledSince and clears disabledReason".
  - "turning off records user".
  - "rotate changes the secret".
  - "send_test twice within 10 s raises too soon".
  - "send_test when off raises webhook off".
  - "user A's RPCs never touch user B's row".
- [ ] **Step 2:** Run `npx nx test xjobs -- rpcs.postgres`. Expected: FAIL.
- [ ] **Step 3:** Add the functions, re-plan and apply, and regenerate types.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npx nx run-many -t lint typecheck test -p database xjobs web`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): webhook RPCs`. Then push and open PR B.

## PR C: engine delivery

### Task 4: The matcher creates deliveries

**Files:**

- Modify: `apps/xjobs/src/modules/matcher/repositories/matcher.repository.ts` (`upsertMatches`), `apps/xjobs/src/modules/matcher/testing/memory-matcher.repository.ts`, `apps/xjobs/src/modules/matcher/services/matcher.service.ts`, `apps/xjobs/src/infrastructure/jobs/steps/match/processor.ts`
- Test: `matcher.postgres.spec.ts`, `matcher.service.spec.ts`, `steps/match/processor.spec.ts`

**Interfaces:**

- Consumes: `webhook_enqueue_match` (Task 2), `WebhookQueue.enqueue(deliveryId: string): Promise<void>` (Task 7, injected as `Pick<WebhookQueue, 'enqueue'>`).
- Produces:
  - `upsertMatches(rows): Promise<{ deliveryIds: string[] }>`. For each row with `outcome = 'qualified'`, after its upsert and in the same transaction, it runs `SELECT webhook_enqueue_match(<row id>, 'decision')` and collects the non-null ids. Read the id with `RETURNING id` on the upsert.
  - `MatchOutcome`'s `matched` variant gains `deliveryIds: string[]`.
  - `MatchJobDeps` gains `webhooks: Pick<WebhookQueue, 'enqueue'>`. `processMatchJob` enqueues each id after `matchJob` returns. An enqueue failure is logged and swallowed, since the sweeper covers it.

- [ ] **Step 1: Write the failing tests.**
  - postgres: "a qualified upsert creates a delivery and returns its id"; "a rejected upsert creates none"; "re-upserting the same qualified row returns no ids"; "rejected → qualified after a sent delivery returns no ids".
  - processor: "enqueues each delivery id"; "a failed enqueue doesn't fail the match job".
- [ ] **Step 2:** Run `npx nx test xjobs -- matcher match/processor`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(matcher): create webhook deliveries for new qualified matches`.

### Task 5: Signed, pinned sender

**Files:**

- Create: `apps/xjobs/src/modules/webhooks/sender/address.ts`, `apps/xjobs/src/modules/webhooks/sender/sign.ts`, `apps/xjobs/src/modules/webhooks/sender/send.ts`, `apps/xjobs/src/modules/webhooks/config/webhooks.config.ts`
- Test: `address.spec.ts`, `sign.spec.ts`, `send.spec.ts` (against a local `https.createServer` with a self-signed cert, using a test-only `ca` option)

**Interfaces:**

- Produces:
  - `WEBHOOK_CONFIG` in `webhooks.config.ts`, holding the Global Constraints values: `retryDelaysMs`, `maxAttempts: 7`, `autoDisableAfter: 10`, `timeoutMs: 10_000`, `maxResponseBytes: 1024`, `maxErrorChars: 200`, `maxDescriptionChars: 20_000`, `sweep: { everyMs: 60_000, limit: 200 }`, `stuckSendingMs: 300_000` and `retentionDays: 30`.
  - `isBlockedAddress(ip: string): boolean`. It uses `node:net` `BlockList` and blocks:
    - IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4` and `240/4`;
    - IPv6: `::/128`, `::1/128`, `fc00::/7`, `fe80::/10` and `ff00::/8`;
    - an IPv4-mapped `::ffff:x` address, checked as its IPv4 address.
  - `resolvePublic(host: string, lookup?: typeof dns.lookup): Promise<{ address: string; family: 4 | 6 }>`. It resolves with `{ all: true }` and throws `BlockedAddressError` when there are no results or any address is blocked.
  - `signature(secret: string, timestamp: number, body: Buffer): string`, which returns `v1=<hex>`.
  - `send(input: { url: string; body: string; secret: string; deliveryId: string; event: 'match.qualified' | 'test'; now: Date }, deps?: { lookup?; ca? }): Promise<SendResult>`, where `SendResult = { ok: true; status: number } | { ok: false; status: number | null; error: string }`. It uses `https.request` with `lookup` returning the pinned address, `servername` and `Host` set to the hostname, the headers from Global Constraints and the timeout. It reads the response up to the byte cap, and treats 2xx as `ok`. It never throws. `error` values are `'blocked address'`, `'timeout'`, `'http <status>'`, or the error's `code`, truncated.

- [ ] **Step 1: Write the failing tests.**
  - address: a table covering each blocked range plus `8.8.8.8` and `2606:4700::1` allowed, and `::ffff:127.0.0.1` blocked. Plus "refuses a host when any resolved address is private".
  - sign: a fixed secret, timestamp and body give a known hex value, computed once with `crypto` in the test. Plus "signs the exact UTF-8 body bytes" (the body `"🚀 Zürich"`).
  - send: "a 200 is ok and sends all four headers with a valid signature"; "a 503 is http 503"; "a 302 is not followed"; "a server that never answers times out at timeoutMs" (with a fake timer or a 200 ms override in deps); "connects to the pinned IP even if a second lookup would differ" (a lookup stub counting calls must be called once).
- [ ] **Step 2:** Run `npx nx test xjobs -- webhooks/sender`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(webhooks): signed sender pinned to a public address`.

### Task 6: Payload builder

**Files:**

- Create: `apps/xjobs/src/modules/webhooks/payload/build.ts`, `apps/xjobs/src/modules/webhooks/repositories/webhooks.repository.ts` (with `testing/memory-webhooks.repository.ts`)
- Test: `build.spec.ts`, plus a case in `webhooks.postgres.spec.ts`

**Interfaces:**

- Consumes: `checkLines` and `Labels` from `@xjobs/database/matches` (Task 1).
- Produces:
  - `WebhooksRepository.loadPayloadInput(deliveryId: string): Promise<PayloadInput | null>`. It reads the delivery, its match (`checks`, `unverified`, `stackScore`, `trigger`), the profile (`id`, `position`), `normalized_jobs` (`title`, `postingUrl`, `applyUrl`, `postedAt`, `firstSeenAt`, description), the company (`name`, `url`), and `job_facts` (locations, seniority, contract type, salary, tech stack, languages).
  - `WebhooksRepository.loadLabels(): Promise<Labels>`. It reads the same tables and label columns as `loadValueLists` in `apps/web/src/lib/setup/value-lists.ts`, cached for 10 minutes like the matcher's place hierarchy.
  - `buildMatchPayload(input: PayloadInput, labels: Labels, ctx: { deliveryId: string; createdAt: Date; webAppUrl: string | null }): WebhookPayloadV1`. The shape is exactly the spec's Payload body:
    - `profile.label` is the position's label;
    - `match.reasons` is `checkLines(...).map(({ rule, mark, text }) => ({ check: rule, outcome: mark, summary: text }))`;
    - `links.match` is `${webAppUrl}/?job=<jobId>`, or `null` when `WEB_APP_URL` is unset;
    - the description is cut to `maxDescriptionChars`.
  - `buildTestPayload(sample: PayloadInput | null, labels, ctx): WebhookPayloadV1`, with `event: 'test'` and a fixed example job when `sample` is null. The sample comes from `WebhooksRepository.latestQualifiedForUser(userId)`.
  - A new optional env `WEB_APP_URL` (a URL) in `environment.validation.ts`, added to `.env.example`.

- [ ] **Step 1: Write the failing tests.**
  - "maps a full input to the spec's shape". Snapshot the keys, and assert `version: 1` and `event: 'match.qualified'`.
  - "unknown facts are null, not missing": every key is present, and `salary` is `null`.
  - "cuts the description at 20 000 chars".
  - "links.match is null without WEB_APP_URL".
  - "a test payload without a sample uses the fixed job".
- [ ] **Step 2:** Run `npx nx test xjobs -- webhooks/payload`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(webhooks): payload v1 builder`.

### Task 7: Queue, delivery step and sweeper

**Files:**

- Create: `apps/xjobs/src/infrastructure/jobs/steps/webhook/{index.ts,queue.service.ts,processor.ts}`, `apps/xjobs/src/modules/webhooks/services/delivery.service.ts`, `apps/xjobs/src/modules/webhooks/webhooks.module.ts`, `apps/xjobs/src/modules/webhooks/index.ts`, `apps/xjobs/src/modules/webhooks/README.md`
- Modify: `webhooks.repository.ts` (Task 6)
- Test: `delivery.service.spec.ts` (memory repo, fake sender, fixed clock), `webhooks.postgres.spec.ts`, `steps/webhook/processor.spec.ts`

**Interfaces:**

- Consumes: `send` (Task 5), `buildMatchPayload` and `buildTestPayload` (Task 6), `WEBHOOK_CONFIG`.
- Produces:
  - `WEBHOOK_QUEUE = 'webhook'`, `WEBHOOK_SEND_JOB = 'send'`, `WEBHOOK_SWEEP_JOB = 'sweep'`.
  - `WebhookQueue.enqueue(deliveryId)`, shaped like `MatchQueue`, with the BullMQ job id equal to the delivery id. BullMQ `attempts: 1`: the retries are ours and live in the row.
  - `WebhooksRepository`:
    - `claim(deliveryId, now)` returns `{ delivery, webhook } | 'skip' | 'busy' | 'held' | null`. In one transaction it locks the webhook row `FOR UPDATE`. It marks the row `skipped` if the webhook is off or missing. It returns `busy` if another row of that webhook is `sending`, `held` if `consecutiveFailures > 0` and this isn't the oldest pending row, and `null` if the row isn't due or not `pending`. Otherwise it sets `status = 'sending'` and `attempts = attempts + 1`.
    - `savePayload(id, payload)`.
    - `recordSuccess(id, statusCode, now)`: sets `delivered`, resets the webhook's failures, sets `lastSuccessAt`, and sets `nextAttemptAt = now` on that webhook's other pending rows.
    - `recordFailure(id, result, now)`: sets `pending` with the next delay, or `failed` at `maxAttempts`. It bumps failures and `lastFailureAt`, and disables the webhook at `autoDisableAfter`.
    - `listDue(now, limit)`: due pending rows, oldest first. For a webhook with failures, only its head.
    - `recoverStuck(now)`.
    - `applyRetention(now)`.
  - `DeliveryService.deliver(deliveryId): Promise<'delivered' | 'retry' | 'failed' | 'skipped' | 'busy' | 'held' | 'gone'>`. It claims the row, builds and saves the payload if it's null, sends, then records the outcome.
  - `processWebhookJob(job, deps)`: `send` → `deliver`. `sweep` → `recoverStuck`, `applyRetention`, then `listDue` and enqueue each.

- [ ] **Step 1: Write the failing tests.**
  - service:
    - "a 2xx marks delivered and resets failures".
    - "a 503 schedules the next attempt after 60 000 ms, then 300 000 ms".
    - "the 7th failure marks failed".
    - "the 10th consecutive failure disables the webhook with failing".
    - "a disabled webhook's row is skipped".
    - "hold-back: with failures > 0 only the oldest pending row is attempted; a burst of 10 pending during an outage disables only after 10 head attempts".
    - "a 2xx after failures releases the rest oldest first".
    - "a URL change releases hold-back".
    - "the payload is built once and retries send identical bytes".
    - "a test row uses buildTestPayload".
  - postgres:
    - "claim returns busy while another row of the webhook is sending" (two concurrent claims, exactly one wins).
    - "a delivery whose webhook was deleted mid-send ends quietly": `recordFailure` and `recordSuccess` update 0 rows and resolve.
    - "recoverStuck returns rows sending for over 5 min".
    - "retention clears payload of 31-day-old match rows and deletes 31-day-old test rows".
  - processor: "sweep enqueues listDue ids".
- [ ] **Step 2:** Run `npx nx test xjobs -- webhooks steps/webhook`. Expected: FAIL.
- [ ] **Step 3:** Implement. The README covers the flow, the rules and the code map, like `modules/matcher/README.md`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(webhooks): delivery step, retries, hold-back and sweeper`.

### Task 8: Worker wiring, docs

**Files:**

- Create: `apps/xjobs/src/infrastructure/worker/webhook.service.ts`, `apps/xjobs/src/infrastructure/worker/tests/webhook-worker.spec.ts`, `docs/webhooks.md`
- Modify:
  - `worker.module.ts` (register `WebhooksModule`, `WebhookQueue` and `WebhookWorkerService`);
  - `worker.service.ts` (role `'webhook'`, and start it in `'all'`);
  - `scheduler.ts` (`syncWebhookSweepScheduler(queue, runSchedules)`, like `syncMatchSweepScheduler`);
  - `match.service.ts` (pass `webhooks: this.webhookQueue` into `processMatchJob`);
  - `apps/xjobs/package.json` (the `worker-webhook` target and a `worker:webhook:dev` script, mirroring `worker-match`);
  - root `CLAUDE.md` (commands list: add `worker-webhook`, and mention webhook in `worker-all`).

**Interfaces:**

- Consumes: everything from Tasks 4–7.
- Produces: `WebhookWorkerService.start(connection)`. Worker concurrency is 4 (my call, the spec leaves it to the builder). The per-webhook limit of one comes from `claim`.

`docs/webhooks.md` covers:

- the events and when one is sent: new-job rules, once per profile and job, merges, unverified flag;
- the headers;
- the v1 body;
- a signature verification snippet in Node, checking the timestamp to 5 min;
- retries and hold-back;
- auto-disable at 10;
- at-least-once delivery, with `X-10xjobs-Delivery` as the dedupe key;
- HTTPS only;
- Slack or Discord through Zapier or n8n.

- [ ] **Step 1: Write the failing test:** "webhook role starts the webhook worker, registers the sweep only with XJOBS_RUN_SCHEDULES=1", and "all role starts it too". Mirror `match-worker.spec.ts`.
- [ ] **Step 2:** Run `npx nx test xjobs -- webhook-worker all-worker`. Expected: FAIL.
- [ ] **Step 3:** Implement and write the docs.
- [ ] **Step 4:** Run `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker): run webhook deliveries`. Then push and open PR C. The PR body lists the post-merge step: set `WEB_APP_URL` on the hosted engine.

## PR D: the Webhook page

### Task 9: `/preferences/webhook`

**Files:**

- Create: `apps/web/src/app/(app)/preferences/webhook/page.tsx`, `apps/web/src/lib/webhook/{load.ts,actions.ts,url.ts}` with specs, `apps/web/src/components/preferences/webhook-form.tsx`, `apps/web/src/components/preferences/webhook-deliveries.tsx`
- Modify: `apps/web/src/components/preferences/preferences-nav.tsx` (a "Webhook" item after Contacts)

**Interfaces:**

- Consumes: the Task 3 RPCs and RLS reads of `webhooks` and `webhook_deliveries`.
- Produces:
  - `loadWebhook(supabase): Promise<{ webhook: WebhookView | null; deliveries: DeliveryRow[] }>`. It returns the last 50 deliveries by `createdAt DESC`, joined to the job title and company name and the profile's position label for match rows.
  - Server actions `saveWebhookUrl(url)`, `setWebhookEnabled(on)`, `rotateWebhookSecret()`, `deleteWebhook()` and `sendWebhookTest()`. Each runs through the `run()` pattern in `preferences/actions.ts` and returns `SaveResult`. `22023` maps to `invalid url`, `too soon` to a "Wait a few seconds" message, and `webhook off` to "Turn the webhook on first".
  - `urlProblem(url: string): string | null`, the client-side mirror of `webhook_url_ok`, used only for the message.
- UI per `apps/web/DESIGN.md`, from `components/ui` only:
  - the layout in the spec's Web app sketch;
  - status text: "On"; "Off"; "Off: turned off after 10 failed sends.";
  - the secret masked, with Show, Copy and Rotate (Rotate confirms first);
  - a delivery row shows its time, "Title · Company" or "Test", the profile label, and the status with code or error. A pending row with attempts > 0 shows "retry n of 7".

- [ ] **Step 1: Write the failing tests:**
  - `url.spec.ts`: the same accept and reject table as Task 3.
  - `actions.spec.ts`: each action's RPC name, args and error mapping, with the RPC mocked like `report.spec.ts`.
  - `load.spec.ts`: "orders deliveries newest first, limit 50" and "returns null webhook when none".
  - Page states: none, on, off by user, off from failing.
- [ ] **Step 2:** Run `npx nx test web -- webhook`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx nx run-many -t lint test build typecheck`. Expected: PASS. Then check the page by hand on the local stack at 360 px and desktop: save, test send to `https://webhook.site/<id>` or a local tunnel, turn off and on, rotate.
- [ ] **Step 5:** Commit `feat(web): webhook page`. Then push and open PR D.

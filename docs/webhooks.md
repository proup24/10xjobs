# Webhooks

10xjobs can send each new qualified match to a URL you choose, as a signed `POST` with a JSON body. Use it to post to Slack or Discord, or to feed your own tools. Set it up on the Webhook page under Preferences.

## When one is sent

A delivery is created for a profile and a job when all of these hold:

- Your webhook is on.
- The match becomes `qualified` for the first time for that profile and job, or you approve a review as qualified.
- The job is new: it was first seen after the profile was published and after you turned the webhook on. Old jobs that only qualify after a profile edit or a rule change are not sent, and nothing is backfilled.
- That profile and job were not sent before. Re-decisions, rematches and a match that flips from qualified to rejected and back never send again. Merges count too: when two listings are merged into one job, the job is not sent again for a profile that already got any of them.

A role named in a LinkedIn post (a social post on the Social posts page) is sent like a listing, with these extra rules:

- A post whose role states a contact email is not sent while it shows Email pending. Its delivery is created once the email settles (sent, or apply by hand with the reason), which comes with automatic emails in a later release. Until then such posts send nothing.
- A post you rescued from Junk or Disqualified sends nothing.
- A post you already marked (Applied, Not for me, Expired), on it or on a linked copy of the same job, sends nothing.
- Only post roles first decided after social post webhooks shipped are sent: nothing older is backfilled.

Unverified matches are sent as well. Their payload has `match.unverified: true`, which means the match passed on at least one fact the processor was unsure of. Facts the posting does not state do not count.

The body is built at the first attempt, from the match as it is then:

- If the job was merged into another one before that (and its own match was removed), the delivery is sent with the job it was merged into and your match on that job, unless that profile already has another delivery, not skipped, for a job of the same merged job. Then this one is skipped and only the other is sent, so you never get the same job under two delivery ids.
- If the match is gone, or a `decision` delivery's match is no longer qualified (a rematch while the delivery waited), nothing is sent and the delivery shows as Skipped.

New qualified matches go out right after the engine decides them. Review approvals and test sends go out on the next sweep, within about 60 s, or sooner when a send to your webhook has just finished.

There are two events:

- `match.qualified`: a new qualified match.
- `test`: sent when you press "Send test". It carries a sample job from your latest qualified listing (never a social post), or a fixed example if you have none. The webhook must be on, and you can send one test every 10 seconds. A test is not held back by failing deliveries (see Hold-back) and doesn't count toward auto-disable: its success or failure doesn't change the failure count.

## Request

`POST` with `Content-Type: application/json` and `User-Agent: 10xjobs-webhooks/1`. The request times out after 10 s and redirects are not followed (a 3xx counts as a failure). Your URL must be `https`.

| Header                | Value                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `X-10xjobs-Delivery`  | The delivery id. The same on every retry of one delivery.                                 |
| `X-10xjobs-Event`     | `match.qualified` or `test`.                                                              |
| `X-10xjobs-Timestamp` | Unix seconds when this attempt was sent.                                                  |
| `X-10xjobs-Signature` | `v1=` followed by the hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by your secret. |

## Body (version 1)

```json
{
  "version": 1,
  "event": "match.qualified",
  "deliveryId": "0193f0e2-...",
  "createdAt": "2026-11-16T10:00:00.000Z",
  "profile": { "id": "...", "position": "backend_engineer", "label": "Backend engineer" },
  "trigger": "decision",
  "match": {
    "id": "...",
    "unverified": false,
    "stackScore": 0.72,
    "reasons": [{ "check": "location", "outcome": "pass", "summary": "Remote in Europe fits your remote places" }]
  },
  "job": {
    "id": "...",
    "source": "job_board",
    "title": "Senior Backend Engineer",
    "company": { "name": "Acme", "url": "https://acme.example" },
    "postingUrl": "https://www.linkedin.com/jobs/view/...",
    "applyUrl": "https://acme.example/jobs/1",
    "postedAt": "2026-11-15T08:00:00.000Z",
    "firstSeenAt": "2026-11-15T09:30:00.000Z",
    "locations": [{ "arrangement": "remote", "places": ["Europe"] }],
    "seniority": "senior",
    "contractType": "full_time",
    "salary": { "min": 80000, "max": 100000, "currency": "EUR", "period": "year" },
    "techStack": ["node", "postgres"],
    "languages": ["en"],
    "description": "..."
  },
  "post": null,
  "links": { "match": "https://<app>/?job=<job id>" }
}
```

For a role found in a social post, `job.source` is `social_post` and `post` describes the post:

```json
{
  "job": { "id": "...", "source": "social_post", "title": "Backend Engineer", "...": "..." },
  "post": {
    "url": "https://www.linkedin.com/posts/...",
    "author": { "name": "Olga Original", "url": "https://www.linkedin.com/in/olga" },
    "sharers": [{ "name": "Sam Sharer", "url": "https://www.linkedin.com/in/sam" }],
    "howToApply": { "kinds": ["external_link"], "email": null, "links": ["https://acme.example/apply"] },
    "rescued": false
  },
  "links": { "match": "https://<app>/posts?job=<job id>" }
}
```

- `trigger` is `decision` (the engine qualified it) or `review` (you approved it).
- `job.source` is `job_board` for a listing and `social_post` for a role named in a LinkedIn post. `post` is `null` for a listing.
- `post.author` is who wrote the post (for a share, the original's author), or `null` when unknown. `post.sharers` lists who shared it, oldest first, and is empty for a post seen only first-hand. `post.howToApply.kinds` holds what the post asks for (`email`, `external_link`, `linkedin_job`, `connect_dm_comment` or `unstated`); `email` is the stated contact address or `null`; `links` are the apply links it gives. `post.rescued` is always `false`: a rescued post is never sent.
- A post role's facts (`locations`, `seniority`, ...) come from the post and are `null` when it does not state them, which is common.
- A fact we don't know is `null`, never left out.
- `links.match` opens the job in the 10xjobs web app: `<web app address>/?job=<job.id>` for a listing, `<web app address>/posts?job=<job.id>` for a social post. It is `null` when the engine has no web app address configured (`WEB_APP_URL`).
- `description` is the listing text (for a social post, the post text the role was read from), cut at 20 000 characters.
- The body is built once, at the first attempt, and every retry sends the same bytes.
- New fields can appear within version 1. A removed or renamed field bumps `version`.

## Verify the signature

Sign over the raw body, not a re-serialized one, and reject old timestamps so a captured request can't be replayed.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

// rawBody: the request body as a Buffer or string, exactly as received.
export function verify(rawBody, headers, secret) {
  const timestamp = Number(headers['x-10xjobs-timestamp']);
  const received = String(headers['x-10xjobs-signature'] ?? '');
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Calling back

Your receiver can call back to 10xjobs. A callback proves the webhook is alive and, optionally, reports what you did with a job.

**Searches pause only when a match has waited 24 hours with no activity of any kind, and activity in the app counts too.** If you use only this receiver and it never calls back, your searches pause once a match has waited 24 hours. Send a `ping` now and then, or report feedback on jobs.

`POST <web app address>/api/webhooks/callback`, with these headers:

- `X-10xjobs-Webhook`: the webhook id, shown on the Webhook page (outgoing deliveries don't carry it).
- `X-10xjobs-Timestamp`: Unix seconds. Accepted within 300 seconds either way.
- `X-10xjobs-Signature`: `v1=` plus the hex HMAC-SHA256 of `${timestamp}.${rawBody}`, keyed by the webhook secret (the same scheme as above).

```js
import { createHmac } from 'node:crypto';

export async function callBack(url, webhookId, secret, body) {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-10xjobs-webhook': webhookId,
      'x-10xjobs-timestamp': String(timestamp),
      'x-10xjobs-signature': signature,
    },
    body: rawBody,
  });
}
```

Bodies (version 1):

A ping:

```json
{ "version": 1, "type": "ping" }
```

Feedback that you applied:

```json
{ "version": 1, "type": "feedback", "jobId": "<job id>", "status": "applied" }
```

Feedback that you dismissed, with an optional reason and note:

```json
{ "version": 1, "type": "feedback", "jobId": "<job id>", "status": "dismissed", "reason": "stack", "note": "optional, up to 500 characters" }
```

`reason` is one of `role`, `seniority`, `location`, `stack`, `salary`, `contract`, `languages`, `work_authorization`, `company`, `other`. `reason` and `note` are allowed only with `dismissed`.

Responses:

- `200` with `{ "version": 1, "result": ... }`. `result` is `ok` (ping), `saved` (feedback recorded), `already_decided`, `not_matched` (the job is not one of this user's matches) or `invalid` (the body was signed but malformed; `error` says why). `saved` and `already_decided` carry `jobId`, and `already_decided` also carries `decision`.
- Feedback on a merged job is applied to the job it was merged into; the response `jobId` is that job.
- An existing decision is never changed: you get `already_decided`.
- `401`: unsigned, bad signature, a timestamp more than 300 seconds off, an unknown webhook, or a replay (the same signature twice).
- `429`: more than 60 calls in a minute for one webhook.
- `413`: the body is too large; the body is `{"version":1,"error":"too_large"}`.
- `503`: the web app could not reach the engine; the body is `{"version":1,"error":"unavailable"}`. Retry it later.

Every `200` counts as activity for the user, including `invalid`.

## Delivery

- **Success** is any 2xx response. The response body is read up to 1 KB and dropped, never stored.
- **Failure** is anything else: a non-2xx (3xx included), a timeout, a connection error, or an address we refuse to connect to (private, loopback, link-local and similar ranges; the Webhook page shows "blocked address").
- **Retries.** A failed attempt is tried again after 1 min, 5 min, 30 min, 2 h, 6 h, then 12 h. After the 7th failed attempt (about 21 h in all) the delivery is marked `failed` and not tried again.
- **Hold-back.** While your webhook has failed match sends in a row, only its oldest waiting match delivery is attempted, on its backoff. The others wait without using their attempts. The first 2xx of a match delivery releases them, oldest first. If the oldest gives up, the next one takes its place. So a burst of matches during a short outage does not add up to the auto-disable limit. Test sends are not held back, and their result doesn't change the failure count or release anything.
- **Auto-disable.** After 10 failed match attempts in a row, the webhook turns itself off and its waiting deliveries are skipped. Turning it back on sends only jobs first seen after that moment; what was missed is not sent. Changing the URL or turning the webhook back on resets the failure count.
- **One at a time.** Deliveries to one URL are sent one after another, never in parallel.
- **At least once.** Delivery is at-least-once: if our engine crashes after your server answered but before we record it, the same delivery is sent again. Deduplicate on `X-10xjobs-Delivery`, which does not change between retries.
- **History.** Match delivery records are kept: after 30 days their payload and error are cleared, and the record that the job was sent stays, which is what stops a resend. Test delivery records are deleted after 30 days. Deleting the webhook deletes its whole history.

## Statuses on the Webhook page

The page lists your last 50 deliveries, newest first, with the job (or "Test"), the profile and the status:

- **Pending**: waiting for its first attempt.
- **attempt n of 7**: attempt n failed, with its HTTP status or error; it will be tried again.
- **Sending**: an attempt is in progress.
- **Delivered**: your URL answered 2xx, with the status code.
- **Failed**: all 7 attempts failed, with the last status or error.
- **Skipped**: not sent: the webhook was off when its turn came, or the match was gone or no longer qualified.

## Safety

- Only `https` URLs, without credentials in the URL and without private, loopback or internal hosts.
- Every send resolves the hostname and connects to the checked address, so DNS can't point a safe name at a private address afterwards.
- Your secret is shown only to you, and never appears in a payload or a log.

## Slack or Discord through Zapier or n8n

Slack and Discord incoming webhooks expect their own body format, so they can't take this request directly. Put a small automation between them:

1. In Zapier, create a Zap with the trigger "Webhooks by Zapier: Catch Hook". In n8n, add a Webhook node set to `POST`. Copy its `https` URL.
2. Paste that URL on the Webhook page and press "Send test". The test shows up in the trigger, so you can map its fields.
3. Add a "Send channel message" step (Slack) or a "Send message" step (Discord) and build the text from `job.title`, `job.company.name`, `job.postingUrl`, `job.applyUrl` and `links.match`.

These tools don't verify the signature unless you add a code step; for a private catch URL that is usually acceptable, since the URL itself is the secret. If you receive webhooks on your own server, verify the signature as above.

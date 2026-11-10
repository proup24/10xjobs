# Web app to engine auth: design

Roadmap slice: [Phase 2 / 02: Web app to engine auth](../../roadmap/phase-2-find/02-engine-auth.md). Depends on [Phase 2 / 01: Engine hosting](2026-11-10-engine-hosting-design.md).

## Intent

The hosted engine is moving toward production use, and nothing on it should be public. Only the web app's server may call it, and only on behalf of a signed-in user acting on their own profiles. Later slices (publish on create, edit published) need exactly this: a server action that asks the engine to do a side effect for the current user.

Two checks protect every request:

1. **An API key** shared between the web app's server and the engine. It proves the caller is our web app. Without it, nothing answers.
2. **The signed-in user's Supabase access token**, forwarded by the web app. It proves who the request is for. The engine takes the user id from the verified token, never from the URL or body, and checks that the user owns any profile the request names.

A leaked API key alone cannot act as any user. A stolen user token alone cannot reach the engine.

## Goals

- Every hosted engine route requires the API key, including health.
- Every route that acts for a user also requires a valid Supabase access token and checks ownership of the named profile.
- The engine rejects: no key, a wrong key, no token, an expired token, a token from another Supabase project, a malformed token, and a valid token for a user who doesn't own the profile.
- A small server-only client in the web app calls the engine with the key and the user's token. Slices 03 and 04 use it.
- The temporary CRUD endpoints (`users`, `contacts`, `profiles` CRUD) and Basic auth are gone.
- The operator endpoints (processor, matcher, query-search read) exist only on a locally run engine, never on the hosted one.

## Non-goals

- The publish, edit and delete flows in the UI (slices 03 and 04). This slice adds the client and the engine route; no screen calls it yet.
- Rate limiting, IP allowlists or a private network between Vercel and Hetzner. The key and the token are the boundary.
- Key rotation without downtime (see Decisions).
- A production engine or production Supabase project (still deferred).

## Anti-goals (failure even if it works)

- Any engine route answering without the API key on the hosted engine.
- The engine trusting a user id from the path, query or body.
- The API key or a user token reaching the browser, a log line, an error message or git.
- The web app gaining a service-role key, or an env name that trips `apps/web/src/no-service-role.spec.ts`.
- Error responses that reveal whether another user's profile exists.
- The operator endpoints (which spend OpenRouter money) reachable on the hosted engine.

## What exists today (on `main`, plus slice 01)

- `BasicAuthGuard` as the global `APP_GUARD` (`apps/xjobs/src/app/app.module.ts`), with `@Public()` opting out (only `GET /api/health`). `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` are required by `environmentSchema` (`apps/xjobs/src/config/environment.validation.ts`).
- Controllers, all under the global `api` prefix:
  - `users`, `users/:userId/contacts`, `users/:userId/profiles` (CRUD + `POST :profileId/publish`) in `apps/xjobs/src/modules/users/controllers/`.
  - `users/:userId/profiles/:profileId/query-search` (`GET`), in `modules/queries`.
  - `processor` (`POST preview`, `POST jobs/:jobId/run`, `GET jobs/:jobId`, `GET status`) and `matcher` (`POST jobs/:jobId/run`, `GET jobs/:jobId`).
  - `health` (`GET`, public).
- `ProfilesService.publish(userId, profileId)` (404 when the profile isn't the user's, 409 when already published) and `releaseAll`.
- Swagger is set up only when `NODE_ENV=development` (`apps/xjobs/src/main.ts`).
- `10xjobs-dev` signs access tokens with an asymmetric ES256 key and publishes it at `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` (checked 2026-11-10).
- The web app reads the session with `@supabase/ssr` (`apps/web/src/lib/supabase/server.ts`) and only knows `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `apps/xjobs-e2e/src/xjobs/users.spec.ts` exercises the CRUD endpoints with Basic auth. `apps/xjobs-e2e/src/support/auth-users.ts` creates real local auth users.
- Slice 01 (in progress, separate branch) adds `deploy/engine/` (compose, Caddyfile, `.env.example`, runbook) and `.github/workflows/deploy-engine.yml`. It keeps Basic auth on the hosted API and checks health over public HTTPS.

## Decisions

Marked **(owner)** where the owner decided, **(roadmap)** where the roadmap locked it, **(call)** where it was the designer's call and is open to correction.

### Trust model

- **(owner)** Nothing on the hosted engine is public. The web app and engine communicate through an API key.
- **(owner)** API key **plus** the user's token: the engine checks both. The key-only alternative was rejected because a leaked key would let anyone act as any user.
- **(roadmap)** The web app keeps reading and writing user data through `supabase-js` under RLS. The engine is only for side effects. The web app still has no service-role key.

### The API key

- **(call)** Env name `ENGINE_API_KEY`, the same name on both sides. At least 32 characters; generated with `openssl rand -base64 48` or similar. The name deliberately avoids `secret_key` / `service_role`, which `no-service-role.spec.ts` forbids in the web app.
- **(call)** Sent as the header `X-Engine-Key: <key>`. Kept separate from `Authorization`, which carries the user token.
- **(call)** Checked by global Express middleware registered before routing (replacing `BasicAuthGuard`), so it covers **every** path, health and unknown or unregistered paths included: a request without the right key gets 401 even where the route doesn't exist, and only a keyed request can learn that a route is missing (404). Guards alone can't do this, since Nest runs them only on matched routes. There is no `@Public()` escape on the hosted engine; the decorator and the Basic guard are deleted. Compared with the existing digest + `timingSafeEqual` technique from `basic.guard.ts`.
- **(call)** One key per engine. Rotating means setting the new key on the engine server and in Vercel, then redeploying both. Requests fail for the few minutes in between. That is acceptable while the only engine serves `10xjobs-dev`; zero-downtime rotation (accepting a previous key) can come with a production engine.

### The user token

- **(roadmap)** Verified against the Supabase project's JWKS. The user id comes from the token's `sub`, never from the path.
- **(call)** Sent as `Authorization: Bearer <access token>`.
- **(call)** Verified with `jose` (`createRemoteJWKSet` + `jwtVerify`). JWKS URL `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, using the engine's existing `SUPABASE_URL` (or its `SUPABASE_PUBLIC_URL` fallback). Required: signature by a key from that JWKS, `alg` in an allowlist of asymmetric algorithms (ES256, RS256), `iss` equal to `${SUPABASE_URL}/auth/v1`, `aud` equal to `authenticated`, `role` equal to `authenticated`, `exp` in the future (default small clock tolerance), and `sub` a UUID. A token from another project fails on signature and issuer. HS256 tokens are refused.
- **(call)** `jose`'s remote JWKS set caches keys and refetches on an unknown `kid`, so key rotation in Supabase needs nothing from us. If the JWKS can't be fetched, the request fails with 503, not 401, and the log says why.
- **(call)** Applied per route by a `UserGuard` (or equivalent decorator) on user routes, which puts the user id on the request. A `@CurrentUser()` param decorator reads it. Routes without it can't see a user id at all.
- **(call)** The engine does not call Supabase Auth per request (`getUser`). A signed-out user's token stays valid until it expires (one hour, `jwt_expiry = 3600`). That is the standard Supabase trade-off and acceptable for side-effect actions on one's own profiles.

### Ownership

- **(roadmap)** Every engine action that names a profile checks ownership.
- **(call)** Ownership is enforced by the service, as `ProfilesService.publish` already does: it looks up the profile by `(userId, profileId)`. Another user's profile and a missing profile both answer **404** with the same body, so existence never leaks.
- **(call)** Every user-scoped controller test includes the "user B's token on user A's profile is 404" case. New routes in later slices follow the same rule.

### Routes on the hosted engine

After this slice, the hosted engine serves only:

| Route                                   | Key | User token | Notes                                                                      |
| --------------------------------------- | --- | ---------- | -------------------------------------------------------------------------- |
| `GET /api/health`                       | yes | no         | Same body as today                                                         |
| `POST /api/profiles/:profileId/publish` | yes | yes        | Calls `ProfilesService.publish(user, profileId)`. 200, 404 or 409 as today |

- **(call)** The engine gives publish's two 409 cases distinct error codes (`PROFILE_PUBLISHED` and `ELIGIBILITY_REQUIRED`) instead of the shared `CONFLICT`, so the client can map them without reading message text.
- **(call)** Publish is the one user route this slice ships, because the service already exists and it lets the tests prove ownership end to end. Slices 03 and 04 add their routes (for example a release or delete) in the same shape: `/api/profiles/:profileId/<action>`, user from the token.
- **(roadmap)** Removed: the `users`, `contacts` and `profiles` CRUD controllers and their DTOs and e2e tests. Services and repositories stay where other code uses them (publish, regenerate, the `db:*` scripts, the resume service); the builder deletes what becomes dead.
- **(call)** Response shape and error format stay as today (`ResponseInterceptor`, `HttpExceptionFilter`). Auth failures are a plain 401 with no `WWW-Authenticate` challenge, and the body doesn't say which check failed.
- **(call)** No CORS on the hosted engine: only servers call it. CORS stays as today in development.

### Operator endpoints: local only

- **(owner)** The processor, matcher and query-search endpoints exist only when the engine runs locally, never on the hosted engine.
- **(call)** They are registered only when `XJOBS_OPERATOR_ENDPOINTS=1`. It defaults to off, `.env.example` sets it on for local work, and environment validation refuses it when `NODE_ENV=production` (which the hosted engine sets). With the flag off, their routes don't exist (404), not merely forbidden.
- **(call)** When they are on, they still require the API key, like every route. They don't take a user token; query-search keeps its `users/:userId/...` path because it is a local debugging read, not a user action.
- **(call)** With the operator endpoints off, the hosted API no longer needs `OPENROUTER_API_KEY`. Slice 01's server `.env` gives it to the API container; this slice removes it from the API service in `deploy/engine/compose.yaml` (the worker keeps it).

### Web app client

- **(roadmap)** A small server-only client in the web app.
- **(call)** `apps/web/src/lib/engine/` with `import 'server-only'`. It reads `ENGINE_URL` and `ENGINE_API_KEY` from `process.env` (server-only, never `NEXT_PUBLIC_`). It gets the access token from the request's Supabase session via `createSupabaseServerClient()` (first checking that a signed-in user exists with `getClaims()`/`getUser()`, so an anonymous call never reaches the network).
- **(call)** It sends `X-Engine-Key` and `Authorization: Bearer`, with a timeout (about 10 seconds) and no retries (side effects; slices 03 and 04 decide retry and idempotency per action).
- **(call)** It returns a typed result instead of throwing for expected outcomes: `ok` with the data, `not-found`, `conflict` with a `reason` (`already-published` or `incomplete`, the latter meaning the user hasn't set their country of residence or answered the visa sponsorship question), `invalid` with the engine's message (publish's 400 when no searchable technology has importance above 0), `unauthorized` (session missing or rejected), `unavailable` (engine down, timeout, 5xx, or `ENGINE_URL`/`ENGINE_API_KEY` unset). Callers turn `unavailable` into a "couldn't reach the server, try again" message. User data is never lost, because it was already saved through Supabase before any engine call.
- **(call)** It logs only the action, the profile id, the outcome and the HTTP status. It never logs the key, the token or response bodies.
- **(call)** This slice ships `publishProfile(profileId)` as its one method, with unit tests (mocked `fetch`) for each result. No UI calls it until slice 03.

### Engine URL and key per environment

- **(call)** Vercel env vars `ENGINE_URL` (for example `https://api.<ip-with-dashes>.sslip.io`, from slice 01) and `ENGINE_API_KEY`, marked sensitive. They're set for every Vercel environment that exists today, all pointing at the one hosted dev engine, since production is deferred.
- **(call)** Locally: `ENGINE_URL=http://localhost:3000` and a local `ENGINE_API_KEY` in `apps/web/.env.local`, matching the engine's local `.env`. Both `.env.example` files list the names with no real values.
- **(call)** The engine's `ENGINE_API_KEY` lives in the server's `/home/deploy/engine/.env` (slice 01's secrets rule). CI never sees it.

### Health without a public route

- **(owner)** Nothing public, so health requires the key too.
- **(call)** The `api` container's Docker healthcheck sends the key from its own environment (`wget --header "X-Engine-Key: $ENGINE_API_KEY" …`).
- **(call)** Slice 01's deploy job stops curling the public URL without credentials. Instead, over the SSH session it already has, it waits for the `api` container to report `healthy`. Then, as an end-to-end check, it requests `https://$ENGINE_HOSTNAME/api/health` from the server itself with the key read from the server's `.env`, so the key never enters CI. A request to the public URL without the key must return 401.

### Changes to slice 01's files

These touch files slice 01 creates, so **this slice's PR is branched from `main` after slice 01 has merged** (the engine guard, the client and the tests can be built earlier on a branch and rebased).

- `deploy/engine/.env.example`: remove `BASIC_AUTH_*`, add `ENGINE_API_KEY`.
- `deploy/engine/compose.yaml`: the healthcheck with the key; `OPENROUTER_API_KEY` off the `api` service.
- `.github/workflows/deploy-engine.yml`: the health check above.
- `deploy/engine/README.md` (runbook): generating the key, setting it on the server and in Vercel, rotating it, and the merge-day order below.
- Slice 01's spec "Done when" item 2 is superseded: after this slice, every route without the key returns 401.

**Merge-day order (runbook):** before merging this slice's PR, the owner adds `ENGINE_API_KEY` to the server's `.env` (removing `BASIC_AUTH_*` is optional, the engine ignores them) and sets `ENGINE_URL` / `ENGINE_API_KEY` in Vercel. Otherwise the deploy's health check fails and the old image keeps running, which is a safe failure.

### Local Supabase

- **(call)** The e2e tests verify real tokens from the local Supabase stack, which must serve asymmetric keys on its JWKS endpoint. If the local stack (the repo pins the `supabase` CLI at `3.0.0-next.27`; check its defaults) issues HS256 tokens by default, the builder enables asymmetric signing locally (`signing_keys_path` in `supabase/config.toml`, with the key file generated by a script and gitignored, since it's a credential). No HS256 fallback in the engine.

## Tests

- **Engine unit tests:** key guard (missing, wrong, right; timing-safe compare); user token verification against an in-memory JWKS (valid, expired, wrong issuer, wrong audience, wrong `role`, unknown `kid`/other project's key, HS256, malformed, missing `sub`); JWKS fetch failure gives 503; operator modules absent when the flag is off and validation refusing the flag in production; env validation requiring `ENGINE_API_KEY` (≥ 32 chars) and no longer requiring `BASIC_AUTH_*`.
- **Engine e2e (`apps/xjobs-e2e`), against the local stack, replacing `users.spec.ts`:** two real users A and B, signed in to get real access tokens. Health: no key → 401, key → 200. Publish: no key → 401; key but no token → 401; key plus a forged token signed by a local throwaway key → 401; B's token on A's profile → 404 and A's profile is unchanged; A's token on A's draft → 200 and the profile is published; again → 409. The removed CRUD routes → 404.
- **Web client against the live engine:** in the same CI job as the engine e2e, a test calls the web client's `publishProfile` with a real user's token (the client takes its token source and env as injectable dependencies, so the test needs no Next request context) against the running local engine, and gets `ok`, then `conflict`/`already-published`.
- **Web unit tests:** the client's result mapping (200, 401, 404, 409, 5xx, network error, timeout, missing env), headers sent, nothing secret logged. `no-service-role.spec.ts` still passes.

### End-to-end tests in CI

- **(owner)** The end-to-end auth tests run in CI on every PR, as part of this slice.
- **(call)** A new job in `.github/workflows/ci.yml` (alongside the existing `run-many` job, required for merge like it): starts the local Supabase stack with asymmetric signing (generating the gitignored signing-key file first), applies migrations, starts both Redis instances (service containers or the local `docker-compose.yaml`), builds and boots the engine with a throwaway CI-only `ENGINE_API_KEY` generated in the job (not a GitHub secret, since it protects nothing real), then runs `nx e2e xjobs-e2e` and the web client's live test. Env comes from the job, not from a repo-root `.env` file (`XJOBS_SKIP_ENV_FILES=1` or the e2e setup's equivalent).
- **(call)** The e2e setup's refusal of non-local `SUPABASE_URL` stays, so the job can never touch `10xjobs-dev`.
- Left to the builder: caching and other ways of keeping the job's run time reasonable, and whether it reuses the existing `database` job's Supabase setup.

## Done when

1. A web app server-side call to `publishProfile` reaches the engine as the signed-in user and publishes that user's draft (shown by the web client's live test in the CI e2e job).
2. The engine rejects missing and wrong keys, and missing, expired, wrong-project, malformed and other-user tokens (unit tests and the new CI e2e job, both green on the PR).
3. The `users`, `contacts` and `profiles` CRUD endpoints, `BasicAuthGuard`, `@Public()` and `BASIC_AUTH_*` are gone from the engine.
4. On the hosted engine, `curl https://<engine>/api/health` and `curl https://<engine>/api/processor/status`, both without the key, return 401; with the key, health returns 200 and the processor route returns 404.
5. A merge deploys with the key-based health check passing, with no secret in CI.

## Left to the builder

- Exact module and file layout of the guards, the decorator and the web client.
- How to get the access token in the web client (`getSession()` after a verified `getClaims()`, or equivalent) within `@supabase/ssr`'s current API.
- How the e2e support signs users in to get tokens (password sign-in on created users, for example).
- Which now-unused services, repositories and DTOs to delete after the controllers go.
- Exact timeout, clock tolerance and JWKS cache settings.

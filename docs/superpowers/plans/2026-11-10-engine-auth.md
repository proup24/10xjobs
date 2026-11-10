# Web app to engine auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the web app's server can call the engine. Each request carries a shared API key plus the signed-in user's Supabase token. The temporary CRUD endpoints and Basic auth are removed.

**Architecture:** An Express middleware checks `X-Engine-Key` on every path before routing. A Nest `UserGuard` verifies the `Authorization: Bearer` Supabase token against the project's JWKS with `jose` and puts the user id on the request. User routes take the user only from there. Processor, matcher and query-search routes move into an `OperatorModule` that is imported only when `XJOBS_OPERATOR_ENDPOINTS=1`. The web app gets a server-only engine client with injectable dependencies. A new CI job runs the engine e2e tests and the client's live test against a local stack.

**Tech Stack:** NestJS, Express, `jose` 6, zod env validation, Next.js 16 App Router, `@supabase/ssr`, Vitest, GitHub Actions, Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-10-engine-auth-design.md`

## Global Constraints

- Env name `ENGINE_API_KEY`, the same on the engine and the web app. At least 32 characters. Header `X-Engine-Key`.
- User token in `Authorization: Bearer <token>`. JWKS at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. `iss` = `${SUPABASE_URL}/auth/v1`, `aud` = `authenticated`, `role` = `authenticated`, `sub` a UUID. Algorithms allowed: `ES256` and `RS256` only.
- No route answers without the key: no `@Public()`, health included. Auth failures are a plain 401 in the existing error envelope, with no `WWW-Authenticate` header, and the body doesn't say which check failed.
- Another user's profile and a missing profile both get 404 with the same body.
- JWKS fetch failure → 503, not 401.
- Operator endpoints exist only with `XJOBS_OPERATOR_ENDPOINTS=1`, which defaults to off. Validation refuses it when `NODE_ENV=production`.
- The web app never gets a service-role key, and no web env name may match `/service_?role|supabase_secret|sb_secret_|secret_key/i` (`apps/web/src/no-service-role.spec.ts`). Web engine env is `ENGINE_URL`, `ENGINE_API_KEY`, never `NEXT_PUBLIC_`.
- Never log the key, a token or response bodies.
- No retries in the web client. Timeout about 10 s.
- No HS256 fallback in the engine.
- Branch `feat/engine-auth` from `main`. Tasks 1–8 can be built before slice 01 (engine hosting) merges. Task 9 edits slice 01's files, so rebase onto `main` after slice 01 merges and before Task 9. Open the PR only after Task 9.

## Review Focus

1. **Malformed auth headers** (`Bearer` with no token, lowercase `bearer`, extra spaces, a repeated `X-Engine-Key` header arriving as an array) → 401, never a 500. Tests are in Tasks 2 and 3.
2. **A valid token for a user whose `users` row is gone** → 404 on publish, not 500. Test is in Task 4.
3. **JWKS unreachable** (Supabase down, or at engine startup) → the engine still boots, and user routes answer 503. Health still answers with the key. Test is in Task 3.
4. **The engine answers something other than JSON** (Caddy's 502 HTML page, an empty body) → the web client returns `unavailable` and doesn't throw. Test is in Task 7.
5. **An `SUPABASE_URL` that differs from the token issuer only by host form** (`localhost` vs `127.0.0.1`) → 401. `.env.example` and the CI job use `http://127.0.0.1:54321` to match the local issuer. Test is in Task 3 (issuer mismatch case); setup is in Tasks 2 and 8.

---

### Task 1: Local Supabase issues asymmetric tokens

**Files:**

- Modify: `supabase/config.toml` (the `[auth]` `signing_keys_path` line), only if needed
- Create: `scripts/ensure-signing-key.sh`, only if needed
- Modify: `package.json` (`db:start`, `db:reset`), only if needed
- Modify: `.gitignore` (`supabase/signing_keys.json`), only if needed
- Modify: `scripts/supabase-env.sh`

**Interfaces:**

- Produces: `eval "$(scripts/supabase-env.sh)"` exports `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` **and** `SUPABASE_PUBLISHABLE_KEY` (the stack's publishable key, or `ANON_KEY` if the CLI prints no publishable key).
- Produces: after `pnpm db:start`, `curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json` lists at least one `ES256` key, and a password sign-in returns a token whose header `alg` is `ES256`.

- [ ] **Step 1: Check the CLI's default.** Run `pnpm db:start`. Run `curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`. Create a user with a password through the admin API and sign in with the publishable key. Decode the access token's header. If `alg` is `ES256` and the JWKS lists its `kid`, skip to Step 4.
- [ ] **Step 2: Enable asymmetric signing.** Write `scripts/ensure-signing-key.sh`. If `supabase/signing_keys.json` is missing, it creates it with `pnpm exec supabase gen signing-key --algorithm ES256` (check the exact flag in `supabase gen signing-key --help` for the pinned `3.0.0-next.27`). It is idempotent and prints nothing on success. Set `signing_keys_path = "./signing_keys.json"` in `[auth]`. Gitignore the file. Prefix `db:start` and the `supabase start` in `db:reset` with `scripts/ensure-signing-key.sh &&`.
- [ ] **Step 3: Run the existing CI `database` job steps locally to confirm nothing else depends on HS256.** Commands: `pnpm db:reset && pnpm db:test`. Expected: PASS. The `database` job in `.github/workflows/ci.yml` calls `supabase start` directly; add a `scripts/ensure-signing-key.sh` step before it.
- [ ] **Step 4: Extend `scripts/supabase-env.sh`** to also print `SUPABASE_PUBLISHABLE_KEY`. Run `eval "$(scripts/supabase-env.sh)" && echo ${SUPABASE_PUBLISHABLE_KEY:0:6}`. Expected: non-empty.
- [ ] **Step 5: Re-run Step 1's check.** Expected: `ES256`.
- [ ] **Step 6: Commit.** `git commit -m "chore(supabase): issue ES256 tokens locally and export the publishable key"`

### Task 2: API key on every path; Basic auth removed

**Files:**

- Create: `apps/xjobs/src/common/auth/engine-key.middleware.ts`, `apps/xjobs/src/common/auth/engine-key.middleware.spec.ts`, `apps/xjobs/src/common/auth/index.ts`
- Delete: `apps/xjobs/src/common/guards/basic.guard.ts`, `basic.guard.spec.ts`, `apps/xjobs/src/common/decorators/public.decorator.ts` (and their index exports; `common/guards/` goes away if empty)
- Modify: `apps/xjobs/src/config/environment.validation.ts`, `apps/xjobs/src/config/index.ts` (drop `getBasicAuthConfig`/`BasicAuthConfig`, add `getEngineApiKey`), `apps/xjobs/src/config/validation.spec.ts`
- Modify: `apps/xjobs/src/app/app.module.ts` (drop the `APP_GUARD` and `BASIC_AUTH_CREDENTIALS` providers), `apps/xjobs/src/app/controllers/health.controller.ts` (drop `@Public()`), `apps/xjobs/src/main.ts`
- Modify: `.env.example` (replace `BASIC_AUTH_*` with `ENGINE_API_KEY=` and a comment `# openssl rand -base64 48`; `SUPABASE_URL=http://127.0.0.1:54321` stays)

**Interfaces:**

- Produces: `export const ENGINE_KEY_HEADER = 'x-engine-key'`.
- Produces: `export function engineKeyMiddleware(expected: string): (req: TracedRequest, res: Response, next: NextFunction) => void`.
- Produces: `export function getEngineApiKey(config: AppConfigService): string`.
- Produces: `environmentSchema` has `ENGINE_API_KEY: z.string().min(32, 'ENGINE_API_KEY must be at least 32 characters')` and no `BASIC_AUTH_*`.

- [ ] **Step 1: Write the failing middleware tests** in `engine-key.middleware.spec.ts`, using a fake `res` with `status`/`json`/`setHeader` spies:
  - `calls next for the right key`
  - `401s with no header`, `401s a wrong key`, `401s a key differing only in length`, and `401s when the header arrives as an array` (the `['k','k']` value Node gives a repeated header). Each asserts that `next` was not called, that `status(401)` was set, that the body equals `ErrorResponseDto.of(ErrorCode.UNAUTHORIZED, 'Authentication required', <traceId>)`, and that `setHeader` was never called with `WWW-Authenticate`.
- [ ] **Step 2: Run** `npx nx test xjobs -- engine-key`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `engineKeyMiddleware`.** Accept the header only when it is a single string. Compare it with the sha256 digest + `timingSafeEqual` approach from the deleted `basic.guard.ts`. Respond directly, without throwing, because Nest filters don't wrap `app.use` middleware.
- [ ] **Step 4: Update env validation tests.** In `validation.spec.ts`, assert that the schema requires `ENGINE_API_KEY` and rejects a 31-character key. Remove the `BASIC_AUTH_*` cases and update fixtures. Run `npx nx test xjobs -- validation`. Expected: FAIL, then implement the schema change and getter. Expected: PASS.
- [ ] **Step 5: Wire it.** In `main.ts`'s `configure`, register `app.use(engineKeyMiddleware(getEngineApiKey(config)))` right after `traceIdMiddleware`, before anything else. Also enable CORS only when `nodeEnv === EnvironmentType.development` (the spec's no CORS on the hosted engine). Remove the Basic guard wiring and `@Public()`.
- [ ] **Step 6: Run** `npx nx run-many -t test typecheck lint -p xjobs`. Expected: PASS. Fix specs that imported the deleted guard or decorator.
- [ ] **Step 7: Commit.** `git commit -m "feat(engine): require X-Engine-Key on every path, drop Basic auth"`

### Task 3: User token verification

**Files:**

- Modify: `apps/xjobs/package.json` and root `package.json` (add `jose`, `^6.2.14`, which is already in the lockfile transitively)
- Create in `apps/xjobs/src/common/auth/`: `user-token.verifier.ts`, `user-token.verifier.spec.ts`, `user.guard.ts`, `user.guard.spec.ts`, `current-user.decorator.ts`, `auth.module.ts`
- Modify: `apps/xjobs/src/common/types/request.types.ts`

**Interfaces:**

- Produces: `export type AuthedRequest = TracedRequest & { userId?: string }`.
- Produces: `export const USER_TOKEN_KEYS = Symbol('USER_TOKEN_KEYS')` (a `JWTVerifyGetKey`) and `export const USER_TOKEN_ISSUER = Symbol('USER_TOKEN_ISSUER')` (string).
- Produces: `@Injectable() export class UserTokenVerifier { verify(token: string): Promise<string> }`. It resolves the `sub` (user id), throws `UnauthorizedException('Authentication required')` for any bad token, and throws `ServiceUnavailableException('Authentication is unavailable')` when the keys can't be fetched.
- Produces: `@Injectable() export class UserGuard implements CanActivate`. It reads `Authorization`, which must match `/^Bearer (\S+)$/i` exactly, else 401, then sets `request.userId`.
- Produces: `export const CurrentUser: () => ParameterDecorator`, which returns `request.userId` as a `string`.
- Produces: `@Global() @Module AuthModule`. It provides `USER_TOKEN_KEYS` = `createRemoteJWKSet(new URL(\`${supabaseUrl}/auth/v1/.well-known/jwks.json\`))` and `USER_TOKEN_ISSUER` = `\`${supabaseUrl}/auth/v1\``, with `supabaseUrl`from`getStorageConfig(config).supabaseUrl`, plus `UserTokenVerifier`and`UserGuard`. It exports the verifier and the guard. Imported once in `AppModule`. `createRemoteJWKSet` is lazy, so boot never fetches.

- [ ] **Step 1: Write the failing verifier tests.** Make a key pair with `generateKeyPair('ES256')` and use `createLocalJWKSet` for `USER_TOKEN_KEYS`. Sign with `SignJWT`. Base claims: `{ sub: <uuid>, role: 'authenticated' }`, `iss` = `http://127.0.0.1:54321/auth/v1`, `aud` = `authenticated`, `exp` = +1h, header `{ alg: 'ES256', kid }`. Cases:
  - `resolves the sub of a valid token`
  - 401 on each of: `expired`, `issuer differs (http://localhost:54321/auth/v1)`, `audience differs`, `role is anon`, `sub is not a UUID`, `sub missing`, `signed by another key pair (other project)`, `HS256 token signed with a shared secret`, `garbage string`
  - `503 when the key set throws a non-JOSE error` (a `USER_TOKEN_KEYS` function that throws `new TypeError('fetch failed')`) and `503 on errors.JWKSTimeout`.
- [ ] **Step 2: Run** `npx nx test xjobs -- user-token`. Expected: FAIL.
- [ ] **Step 3: Implement `verify`.** Call `jwtVerify(token, keys, { issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256'] })`, then check `role === 'authenticated'` and that `sub` is a UUID. Error mapping: `errors.JWKSTimeout`, `errors.JWKSInvalid` and any non-`JOSEError` → 503 (log the error class name only). Every other `JOSEError` → 401.
- [ ] **Step 4: Write the failing guard tests.** Use a fake verifier and a fake `ExecutionContext`. Cases: `sets userId from a valid bearer token`, `accepts lowercase bearer`, then 401 on `no header`, `Bearer with no token`, `Bearer  two-spaces`, `Basic credentials`, and `passes a 503 from the verifier through unchanged`.
- [ ] **Step 5: Implement the guard, the decorator and `AuthModule`. Run** `npx nx test xjobs -- user`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(engine): verify Supabase user tokens against the project JWKS"`

### Task 4: Publish route; CRUD controllers removed

**Files:**

- Modify: `apps/xjobs/src/modules/users/controllers/profiles.controller.ts` (rewritten: publish only)
- Create: `apps/xjobs/src/modules/users/controllers/profiles.controller.spec.ts`
- Delete: `users.controller.ts`, `users.controller.spec.ts`, `contacts.controller.ts`, and the DTOs, services and repositories that become unused (check with `npx nx lint xjobs` and a grep of each export). Keep `ProfilesService`, `UsersService.getOrThrow`/`eligibility`, `ProfilesRepository`, `regeneratePublished` and anything the `db:*` scripts, the worker or `JobsModule` import. `ResumeService` goes if only the deleted delete route used it.
- Modify: `apps/xjobs/src/modules/users/users.module.ts`
- Modify: `apps/xjobs/src/common/enums/error-code.enum.ts`, `apps/xjobs/src/common/filters/http-exception.filter.ts`, `http-exception.filter.spec.ts`
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts`, `profiles.service.spec.ts`

**Interfaces:**

- Consumes: `UserGuard`, `CurrentUser` (Task 3).
- Produces: `ErrorCode.PROFILE_PUBLISHED = 'PROFILE_PUBLISHED'` and `ErrorCode.ELIGIBILITY_REQUIRED = 'ELIGIBILITY_REQUIRED'`.
- Produces: the filter uses `body.code` when an exception's response object carries a `code` that is an `ErrorCode` value; otherwise it maps by status as today.
- Produces: `@Controller('profiles') @UseGuards(UserGuard) class ProfilesController { @Post(':profileId/publish') @HttpCode(200) publish(@CurrentUser() userId: string, @Param('profileId', ParseUUIDPipe) profileId: string): Promise<PublishedProfileView> }`. Route: `POST /api/profiles/:profileId/publish`.

- [ ] **Step 1: Write failing tests.**
  - Filter: `uses an ErrorCode carried in the exception body` (`new ConflictException({ message: 'x', code: ErrorCode.PROFILE_PUBLISHED })` → `code: 'PROFILE_PUBLISHED'`, `message: 'x'`), and `ignores an unknown code` (→ `CONFLICT`).
  - `ProfilesService`: the existing "already published" and "eligibility missing" specs now also assert the exception's response `code` (`PROFILE_PUBLISHED`, `ELIGIBILITY_REQUIRED`). New: `404s publish when the user row is gone`, where `users.getOrThrow` throws `NotFoundException` and the message equals the missing-profile message (`'Profile not found'`), so another user's profile and a deleted user look the same. If `UsersService.getOrThrow`'s message differs, make publish map it to `'Profile not found'`.
  - Controller: `publishes for the user from the token, not from anything else`, which asserts that the service received the `CurrentUser` id.
- [ ] **Step 2: Run** `npx nx test xjobs -- profiles http-exception`. Expected: FAIL.
- [ ] **Step 3: Implement.** Throw both 409s from `ProfilesService` with `{ message, code }` (every place `PROFILE_PUBLISHED` and `ELIGIBILITY_REQUIRED` are thrown, including `rejectWrite` and `getDraftOrThrow`). Rewrite the controller. Delete the CRUD controllers and the dead code.
- [ ] **Step 4: Run** `npx nx run-many -t test typecheck lint build -p xjobs`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(engine): POST /profiles/:id/publish as the token's user; remove temporary CRUD"`

### Task 5: Operator endpoints local only

**Files:**

- Create: `apps/xjobs/src/app/operator.module.ts`, `apps/xjobs/src/app/operator.spec.ts`
- Modify: `apps/xjobs/src/modules/processor/processor.module.ts`, `matcher/matcher.module.ts`, `queries/queries.module.ts` (remove `controllers`)
- Modify: `apps/xjobs/src/app/app.module.ts`, `apps/xjobs/src/config/environment.validation.ts`, `validation.spec.ts`, `.env.example` (`XJOBS_OPERATOR_ENDPOINTS=1` with a comment: local only; refused in production)

**Interfaces:**

- Produces: `@Module({ imports: [ProcessorModule, MatcherModule, QuerySearchModule], controllers: [ProcessorController, MatcherController, QuerySearchController] }) export class OperatorModule {}`. Routes keep their current paths and need only the key (no `UserGuard`).
- Produces: `export function operatorImports(env: NodeJS.ProcessEnv): Type[]`. It returns `[OperatorModule]` when `XJOBS_OPERATOR_ENDPOINTS` parses true with the same `booleanFlag` schema the env validation uses, else `[]`. `AppModule` spreads it into `imports`. `src/environment` has already loaded the env, and validation enforces the production rule.
- Produces: `environmentSchema` has `XJOBS_OPERATOR_ENDPOINTS: booleanFlag.default(false)` and a refine: `XJOBS_OPERATOR_ENDPOINTS is local only; unset it when NODE_ENV=production`.
- `AppModule` no longer imports `ProcessorModule` or `MatcherModule` directly. The worker module is unchanged.

- [ ] **Step 1: Write failing tests.** `operatorImports`: `[]` for unset, `'0'` and `'false'`; `[OperatorModule]` for `'1'` and `'true'`. Validation: `refuses XJOBS_OPERATOR_ENDPOINTS=1 with NODE_ENV=production`, `accepts it in development`. Keep or add a test that reads `OperatorModule`'s controller metadata (`Reflect.getMetadata('controllers', OperatorModule)`) and asserts that it holds exactly the three controllers.
- [ ] **Step 2: Run** `npx nx test xjobs -- operator validation`. Expected: FAIL. Then implement. Expected: PASS.
- [ ] **Step 3: Run** `npx nx run-many -t test typecheck lint build -p xjobs` and boot locally once with the flag off: `curl -s -o /dev/null -w '%{http_code}' -H "X-Engine-Key: $ENGINE_API_KEY" localhost:3000/api/processor/status`. Expected: `404`. With the flag on: `200`.
- [ ] **Step 4: Commit.** `git commit -m "feat(engine): operator endpoints only with XJOBS_OPERATOR_ENDPOINTS, never in production"`

### Task 6: Engine e2e suite for the new boundary

**Files:**

- Modify: `apps/xjobs-e2e/src/support/test-setup.ts` (drop Basic auth and the repo-root `.env` load when `XJOBS_SKIP_ENV_FILES=1`; set `axios.defaults.headers.common['X-Engine-Key']`)
- Modify: `apps/xjobs-e2e/src/support/auth-users.ts`
- Create: `apps/xjobs-e2e/src/support/profiles.ts`
- Delete: `apps/xjobs-e2e/src/xjobs/users.spec.ts`; keep `cities.ts` only if used
- Modify: `apps/xjobs-e2e/src/xjobs/xjobs.spec.ts` (health and auth)
- Create: `apps/xjobs-e2e/src/xjobs/publish.spec.ts`
- Modify: `apps/xjobs-e2e/package.json` (devDependency `jose`)

**Interfaces:**

- Produces: `createAuthUser(name?: string): Promise<{ id: string; accessToken: string }>`. It creates a confirmed user with a random password through the admin client, then signs in with `createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY).auth.signInWithPassword` and returns the session's `access_token`. Update its other callers.
- Produces: `setEligibility(userId: string): Promise<void>`, which sets `residenceCountry: 'MA'` and `acceptsSponsorship: false` on the `users` row through the admin client.
- Produces: `createDraftProfile(userId: string): Promise<string>`. It inserts through the admin client a draft profile that passes publish (the old spec's `profile` fixture: position `backend_engineer`, EMEA/NORTH_AFRICA remote, `nodejs`/`typescript` backend skills with importance > 0) and returns its id. Read the column names from `libs/database/src/supabase/database.types.ts`.
- Produces: `profileState(id: string): Promise<string>`.

- [ ] **Step 1: Write the specs** (they fail until the engine runs the new code, which it now does, so they should pass once support exists. Write the support first if the runner errors on imports). Use `fetch` to control headers exactly.
  - `xjobs.spec.ts`: `health: 401 without the key, no WWW-Authenticate`; `health: 200 with the key, all checks up` (the existing assertions); `401 on an unknown path without the key`; `404 on an unknown path with the key`; `404 on /api/users and /api/processor/status with the key (CRUD gone, operator flag off)`.
  - `publish.spec.ts` with users A and B, A's eligibility set, and a draft for A:
    - `401 without the key` (with A's token)
    - `401 with the key but no token`
    - `401 with a token forged by another ES256 key` (jose `SignJWT` with A's `sub`, the right `iss`/`aud`/`role`)
    - `404 for B's token on A's profile, and A's profile stays a draft` (the body's `code` is `NOT_FOUND` and the message equals the one from a random UUID profile id)
    - `200 for A's token; state is published`
    - `409 PROFILE_PUBLISHED on a second publish`
    - `409 ELIGIBILITY_REQUIRED for B's own draft before B's eligibility is set`
    - `400 for a non-UUID profile id with valid key and token`.
- [ ] **Step 2: Run locally.** Start the stack (`pnpm db:start`, `docker compose up -d redis redis-cache`). Set local `.env` with `ENGINE_API_KEY`, then run `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 3: Commit.** `git commit -m "test(e2e): key and user-token boundary, publish isolation"`

### Task 7: Web engine client

**Files:**

- Create: `apps/web/src/lib/engine/client.ts`, `client.spec.ts`, `server.ts`
- Modify: `apps/web/package.json` and root `package.json` (`server-only`)
- Modify: `apps/web/.env.example` (`ENGINE_URL=http://localhost:3000`, `ENGINE_API_KEY=` with the comment "same value as the engine's ENGINE_API_KEY; server-only")

**Interfaces:**

- Produces in `client.ts` (no `server-only`, no Next imports, so tests and the live test can import it):

```ts
export type PublishedProfile = { id: string; state: string };
export type EngineResult<T> = { kind: 'ok'; data: T } | { kind: 'not-found' } | { kind: 'conflict'; reason: 'already-published' | 'incomplete' } | { kind: 'invalid'; message: string } | { kind: 'unauthorized' } | { kind: 'unavailable' };
export interface EngineClientDeps {
  url: string | undefined;
  apiKey: string | undefined;
  accessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number; // default 10_000
  log?: (line: string) => void; // default console.warn
}
export interface EngineClient {
  publishProfile(profileId: string): Promise<EngineResult<PublishedProfile>>;
}
export function createEngineClient(deps: EngineClientDeps): EngineClient;
```

- Produces in `server.ts`: `import 'server-only'; export async function engineClient(): Promise<EngineClient>`. It uses `process.env.ENGINE_URL` and `process.env.ENGINE_API_KEY`. Its `accessToken` builds `createSupabaseServerClient()`, returns `null` unless `auth.getClaims()` yields claims, then returns `auth.getSession()`'s `access_token ?? null`.
- Mapping: 200 → `ok` with `body.data`; 401 → `unauthorized`; 404 → `not-found`; 409 with `code: 'PROFILE_PUBLISHED'` → `conflict/already-published`; 409 with `'ELIGIBILITY_REQUIRED'` → `conflict/incomplete`; 400 → `invalid` with `body.message`; anything else, a network error, a timeout (`AbortSignal.timeout`), unparseable JSON, or missing `url`/`apiKey` → `unavailable`. A `null` token → `unauthorized` without calling `fetch`.
- Log line: `engine publishProfile profile=<id> outcome=<kind> status=<n|none>`.

- [ ] **Step 1: Write the failing tests** in `client.spec.ts` (`// @vitest-environment node`, mocked `fetch`):
  - `sends POST {url}/api/profiles/{id}/publish with X-Engine-Key and Bearer token`
  - one test per mapping row above, including `409 with an unknown code → unavailable`
  - `502 with an HTML body → unavailable, no throw`
  - `empty 200 body → unavailable`
  - `aborts after timeoutMs → unavailable` (fake `fetch` that honours `signal`, `timeoutMs: 10`)
  - `missing ENGINE_URL or key → unavailable without fetching`
  - `no session → unauthorized without fetching`
  - `never logs the key or the token` (the `log` spy's calls contain neither string).
- [ ] **Step 2: Run** `npx nx test web -- engine`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3: Run** `npx nx run-many -t test typecheck lint build -p web`. Expected: PASS, with `no-service-role.spec.ts` included.
- [ ] **Step 4: Commit.** `git commit -m "feat(web): server-only engine client with typed results"`

### Task 8: Web client live test and the CI e2e job

**Files:**

- Create: `apps/web/src/lib/engine/client.live.spec.ts`, `apps/web/vitest.live.config.mts`
- Modify: `apps/web/vitest.config.mts` (add `exclude: ['**/*.live.spec.ts', ...configDefaults.exclude]`)
- Modify: `apps/web/package.json` (an nx target `test-live`: `vitest run -c vitest.live.config.mts`, not cached, not in `run-many -t test`)
- Modify: `.github/workflows/ci.yml` (new job `e2e`)

**Interfaces:**

- Consumes: `createEngineClient` (Task 7), `scripts/supabase-env.sh` (Task 1), e2e support patterns (Task 6).
- The live test reads `ENGINE_URL`, `ENGINE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_PUBLISHABLE_KEY` from the env. It refuses a non-local `SUPABASE_URL` like `auth-users.ts` does, and creates its own user, eligibility and draft through the admin client. That is a small local helper; web may not import from `apps/xjobs-e2e`.

- [ ] **Step 1: Write `client.live.spec.ts`:** `publishes the signed-in user's draft through the running engine` (→ `ok`, `state: 'published'`), then `a second publish is conflict/already-published`. It cleans up the user in `afterAll`.
- [ ] **Step 2: Run locally** with the engine up: `npx nx run web:test-live`. Expected: PASS.
- [ ] **Step 3: Add the `e2e` job** to `ci.yml`, modelled on the `database` job (same checkout, pnpm, node 24, install). Steps:
  1. `scripts/ensure-signing-key.sh` (if Task 1 created it).
  2. `pnpm exec supabase start -x studio,realtime,edge-runtime,imgproxy,logflare,vector`.
  3. `pnpm --filter @xjobs/database db:migrate`.
  4. Export `SUPABASE_*` from `scripts/supabase-env.sh` into `$GITHUB_ENV`.
  5. `pnpm --filter @xjobs/database db:seed`.
  6. `docker compose up -d redis redis-cache`.
  7. Generate the key: `key=$(openssl rand -hex 32); echo "::add-mask::$key"; echo "ENGINE_API_KEY=$key" >> "$GITHUB_ENV"`.
  8. `pnpm exec nx build xjobs`, then start `node apps/xjobs/dist/main.js` in the background with output to a log file. Poll `curl -sf -H "X-Engine-Key: $ENGINE_API_KEY" http://127.0.0.1:3000/api/health` for up to 60 s.
  9. `pnpm exec nx e2e xjobs-e2e --excludeTaskDependencies`.
  10. `ENGINE_URL=http://127.0.0.1:3000 pnpm exec nx run web:test-live`.
  11. On failure, print the engine log and the Supabase container logs, as `database` does.

  Job env: `XJOBS_SKIP_ENV_FILES: '1'`, `NODE_ENV: development`, `DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `REDIS_URL`/`REDIS_CACHE_URL` at the compose ports, `timeout-minutes: 25`. No GitHub secrets. If the engine's `main.js` path differs after build, use the path `nx build xjobs` prints.

- [ ] **Step 4: Commit.** `git commit -m "ci: e2e job runs the engine boundary tests and the web client live test"`
- [ ] **Step 5: Push the branch** (`git push -u origin feat/engine-auth`) and open a **draft** PR so CI runs. Expected: `main`, `database` and `e2e` jobs green. Note in the PR that the `e2e` job should be added to the required checks for `main` (the human does that in GitHub settings).

### Task 9: Hosted engine files (after slice 01 has merged)

**Files** (created by slice 01; rebase onto `main` first and read them):

- Modify: `deploy/engine/.env.example` (remove `BASIC_AUTH_*`, add `ENGINE_API_KEY`)
- Modify: `deploy/engine/compose.yaml`: the `api` healthcheck sends `--header "X-Engine-Key: $$ENGINE_API_KEY"`, and `OPENROUTER_API_KEY` is removed from `api` (kept on `worker`). Neither container sets `XJOBS_OPERATOR_ENDPOINTS`.
- Modify: `.github/workflows/deploy-engine.yml`: replace the public unauthenticated health curl. Over the existing SSH session, wait (up to a couple of minutes) for `docker inspect -f '{{.State.Health.Status}}'` of the `api` container to be `healthy`. Then, on the server, run `curl -sf -H "X-Engine-Key: $(grep ^ENGINE_API_KEY= ~/engine/.env | cut -d= -f2-)" https://$ENGINE_HOSTNAME/api/health`. Then check that `curl -s -o /dev/null -w '%{http_code}' https://$ENGINE_HOSTNAME/api/health` without the key is `401`. The key never leaves the server.
- Modify: `deploy/engine/README.md` (runbook): generating the key, setting it on the server and in Vercel (`ENGINE_URL`, `ENGINE_API_KEY` as sensitive, every existing Vercel environment), rotation (both sides, then redeploy; brief failures expected), and the merge-day order (server `.env` and Vercel first, then merge).
- Modify: `docs/superpowers/specs/2026-11-10-engine-hosting-design.md` Done-when item 2, pointing to this slice (every route without the key is 401).
- Modify: `docs/shared-dev-database.md` or `CLAUDE.md` only where they mention Basic auth (grep `BASIC_AUTH` across `docs/`, `CLAUDE.md`, `apps/`, `deploy/` and expect no hits after).

- [ ] **Step 1: Rebase** `feat/engine-auth` onto `main` and confirm `deploy/engine/` exists.
- [ ] **Step 2: Edit the files above.**
- [ ] **Step 3: Verify:** `docker compose -f deploy/engine/compose.yaml config -q` (with a dummy `.env` created from `.env.example` in a temp copy, never committed), `shellcheck` on changed scripts, and `actionlint` on the workflow if it's available. `grep -rn BASIC_AUTH --exclude-dir=node_modules .` → only historical specs and plans.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit, push, and mark the PR ready.** `git commit -m "feat(deploy): key-based health checks; API no longer gets OPENROUTER_API_KEY"`. Push with `git push -u origin feat/engine-auth`. The PR body lists the merge-day order and ends with the attribution line.

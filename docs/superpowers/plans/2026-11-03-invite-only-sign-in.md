# Invite-only Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn off public sign-up, let the admin invite, re-send, block and unblock users from a script, send every invite and sign-in as one email with both a link and a 6-digit code, and add the Next.js sign-in, confirm, sign-out, setup-placeholder and home pages, with a hard 7-day session limit for both pages and data.

**Architecture:**

- **Supabase Auth settings** live in `supabase/config.toml`, and both email templates live in `supabase/templates/`. The local mail catcher (Mailpit, port 54324) receives every email, so `apps/db-tests` can read the codes and links and prove Supabase behaves the way the spec relies on.
- **The admin script** is a small TypeScript CLI in the engine package that uses the service-role key.
- **Session cleanup:** an hourly pg_cron job, added in a hand-written Prisma migration, deletes Auth sessions that are more than 7 days old.
- **The web app** decides routes in one pure function that `proxy.ts` calls. Sign-in runs through server actions that return one neutral answer whatever Supabase says. The publishable key is the only key `apps/web` ever holds.

**Tech Stack:** Supabase CLI stack (GoTrue v2.197, Mailpit, pg_cron), Prisma 8 rc.21 migrations (`rawSql`), Next.js 16.4 App Router (`proxy.ts`, server actions, route handlers), `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.118, shadcn (base-nova), Vitest, `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-03-invite-only-sign-in-design.md`

**Branch:** `feat/invite-only-sign-in` (already created, spec committed). One PR to `main`.

## Global Constraints

- `[auth] enable_signup = false`. No code path in `apps/web` calls `signUp`, and every `signInWithOtp` call passes `shouldCreateUser: false`.
- OTP length is 6. `otp_expiry = 86400` (24 hours). `max_frequency = "60s"`.
- A session lasts `7 * 24 * 60 * 60` seconds from sign-in.
- `apps/web` never references the service-role key or any secret key. `apps/web/src/no-service-role.spec.ts` must stay green, so don't even write the words in comments.
- `signInWithOtp` and `verifyOtp` run only in server actions or route handlers, never in the browser client.
- The sign-in page's copy, verbatim from the spec:
  - `NEUTRAL_SENT = "If this email is invited, a code is on its way."`
  - `EXPIRED_INVITE_HINT = "Invited but your invite expired? Ask for a new invite."`
  - `CODE_FAILED = "That code didn't work. Check it or send a new one."`
  - `LINK_FAILED = "That link has expired or was already used."`
  - `SESSION_EXPIRED = "Please sign in again."`
- Email subjects: invite `You've been invited to 10xjobs`, magic link `Your 10xjobs sign-in code`. The sender name is `10xjobs`.
- Email links point at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<invite|email>`, never at `{{ .ConfirmationURL }}`.
- Schema changes go only through Prisma migrations. Create migrations with `pnpm --filter @xjobs/xjobs exec prisma migration new --name <slug>`, edit only the `operations` getter, then self-emit with `node <package>/migration.ts`. Never write a migration package from a blank file. Follow the `rawSql` shape of `20261103T1348_users_from_auth/migration.ts`.
- In `apps/db-tests`, the operation under test goes through a `supabase-js` client using the anon or publishable key. The service role and direct Postgres are used only to set up users and state, read it back, or run the cleanup function the way cron would.
- The Gmail credentials never go in git, in `config.toml`, or in any tracked file. Local development uses Mailpit only.
- CI must be green: `npx nx run-many -t lint test build typecheck` and the `database` job, including the `db:types` diff check.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude doesn't push.

## Review Focus

1. **The email address is typed differently from the one invited** (`Me@Example.com ` vs `me@example.com`). Expected: the same account. The CLI and the sign-in action both trim and lowercase before calling Supabase. Tests in Task 3 (`normalizeEmail`) and Task 5 (the action passes the normalized email).
2. **The same address is asked for twice within 60 seconds.** Supabase answers 429 only for known emails. Expected: the same `NEUTRAL_SENT` answer and the same minimum delay. Test in Task 5.
3. **A token whose `amr` has several entries, or none.** A session can carry an `otp` entry and, after a later password set, a `password` entry. Expected: the newest timestamp across all entries counts as the sign-in time. A token with no `amr` is treated as expired. Test in Task 4.
4. **An `/auth/confirm` link with a missing or unexpected `type`** (for example `type=recovery`, or no `token_hash`). Expected: redirect to `/sign-in?reason=link`, and `verifyOtp` is never called. Test in Task 6.
5. **The admin script pointed at the wrong project.** Expected: it prints the target host before doing anything, and refuses to run when either variable is missing. Test in Task 3.

---

### Task 1: Auth settings, email templates, and proof of Supabase's behaviour

**Files:**

- Modify: `supabase/config.toml`:
  - `[auth]`: `enable_signup = false`; `site_url` and `additional_redirect_urls` stay `http://localhost:3001`.
  - `[auth.email]`: `otp_length = 6`, `otp_expiry = 86400`, `max_frequency = "60s"`.
  - `[auth.rate_limit]`: `email_sent = 30`. If fresh-address db-tests hit `over_email_send_rate_limit` locally, raise the local value to 100 and note it.
  - `[local_smtp]`: `sender_name = "10xjobs"`.
  - Two template blocks, `[auth.email.template.invite]` and `[auth.email.template.magic_link]`, each with its subject and `content_path`.
- Create: `supabase/templates/invite.html`, `supabase/templates/magic-link.html`
- Create: `apps/db-tests/src/support/mailpit.ts`
- Create: `apps/db-tests/src/sign-in.db.spec.ts`

**Interfaces:**

- Produces (db-tests): `latestEmailTo(email: string, opts?: { after?: Date; timeoutMs?: number }): Promise<{ subject: string; code: string; tokenHash: string; type: 'invite' | 'email' }>`.
  - It polls Mailpit's HTTP API at `http://127.0.0.1:54324` (`GET /api/v1/search?query=to:"<email>"`, then `GET /api/v1/message/<ID>`), and checks the host with `assertLocal`.
  - It parses the 6-digit code and the `token_hash` and `type` query parameters from the HTML. Decode `&amp;` before parsing.
  - It throws if no email arrives within `timeoutMs` (default 10 000).
- Produces (db-tests): `expectNoEmailTo(email: string, opts?: { after?: Date; waitMs?: number }): Promise<void>`, which waits `waitMs` (default 3 000) and asserts Mailpit holds no email to that address received after `after` (default: any time).
- Produces (db-tests): `anon(): SupabaseClient` in `support/admin.ts`, a publishable-key client with `noSession` for operations under test.
- Produces (templates): the HTML the two emails use, with `{{ .Token }}` shown large and a button to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (invite) or `&type=email` (magic link). Each email also carries the copy listed in spec section 3.

- [ ] **Step 1: Write the failing tests** in `apps/db-tests/src/sign-in.db.spec.ts`. Use a fresh `db-test-<uuid>@xjobs.test` address per test, register created users for `cleanupTestUsers`, and use an anon client with `noSession` for the operation under test:

```ts
it('sign-up with the publishable key is refused', async () => {
  const { error } = await anon().auth.signUp({ email, password: randomUUID() });
  expect(error?.code).toBe('signup_disabled');
  // admin listUsers: no user with this email
});
it('a sign-in request for an unknown email creates no user and sends nothing', async () => {
  const { error } = await anon().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  expect(error).not.toBeNull();
  // admin listUsers: no user with this email
  await expectNoEmailTo(email);
});
it('an invite email carries a 6-digit code and an invite link', async () => {
  const { id } = await inviteTestUserAt(email); // see Step 3
  const mail = await latestEmailTo(email);
  expect(mail.subject).toBe("You've been invited to 10xjobs");
  expect(mail.code).toMatch(/^\d{6}$/);
  expect(mail.type).toBe('invite');
  expect(mail.tokenHash).not.toBe('');
});
it('the invite code verifies with type email and signs the invitee in', async () => {
  // invite → latestEmailTo → anon().auth.verifyOtp({ email, token: mail.code, type: 'email' })
  // expect data.session not null and data.user.id === invited id
});
it('the invite link token verifies with type invite', async () => {
  // invite → latestEmailTo → verifyOtp({ token_hash: mail.tokenHash, type: 'invite' }) → session not null
});
it('a sign-in request for an invited but unaccepted user sends nothing', async () => {
  // invite, await latestEmailTo(email), then const t = new Date()
  // signInWithOtp({ email, options: { shouldCreateUser: false } }) → error not null
  // await expectNoEmailTo(email, { after: t })
});
it('a sign-in email for an accepted user carries a code and an email-type link', async () => {
  // createTestUser() (confirmed) → signInWithOtp → latestEmailTo
  // subject 'Your 10xjobs sign-in code', code /^\d{6}$/, type 'email'
  // verifyOtp({ token_hash, type: 'email' }) → session not null
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm db:test -- sign-in`
Expected: the invite, magic-link and sign-up tests fail. The default templates have no `type=invite` link to our app, and `signUp` succeeds while sign-up is still on.

- [ ] **Step 3: Implement the config, the templates, `mailpit.ts`, and the `inviteTestUserAt(email: string): Promise<{ id: string }>` helper** in `support/test-users.ts`. Have the existing `inviteTestUser()` call it with a random address. Then restart the stack so the config applies: `pnpm db:stop && pnpm db:start`, then `db:migrate`.

- [ ] **Step 4: Run the whole database suite**

Run: `pnpm db:test`
Expected: everything passes, including slice 02's suites. They sign in with passwords, which still works for existing users.

If the invite email turns out not to fill `{{ .Token }}` (the one fact the review couldn't confirm), stop and report. The spec's fallback is a link-only invite, and that changes Task 5's copy.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/templates apps/db-tests/src
git commit -m "feat(auth): invite-only sign-up with link-and-code emails"
```

---

### Task 2: End sessions older than 7 days

**Files:**

- Create (rendered): `apps/xjobs/src/database/migrations/app/<ts>_end_expired_sessions/`. There's no contract change, so start and end are the same snapshot.
- Regenerate: `apps/web/src/lib/supabase/database.types.ts` (`pnpm db:types`). The new public function appears under `Functions`.
- Modify: `apps/db-tests/src/support/pg.ts` doc comment: it allows setup, read-back and running the cleanup function, not only catalog reads.
- Create: `apps/db-tests/src/session-limit.db.spec.ts`

**Interfaces:**

- Produces (SQL), in one `rawSql` op, `operationClass: 'additive'`:
  - `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog`.
  - `public.end_expired_sessions() RETURNS integer`, `LANGUAGE sql`, `SET search_path = ''`. It runs `DELETE FROM auth.sessions WHERE created_at < now() - interval '7 days'` and returns the number of rows deleted. Refresh tokens cascade with their sessions.
  - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
  - `SELECT cron.schedule('end-expired-sessions', '0 * * * *', 'select public.end_expired_sessions()')`.

- [ ] **Step 1: Write the failing tests** in `session-limit.db.spec.ts`:

```ts
it('removes a session older than 7 days, so its refresh fails', async () => {
  const old = await createTestUser();
  const fresh = await createTestUser();
  await withCatalog((c) => c.query(`update auth.sessions set created_at = now() - interval '7 days 1 minute' where user_id = $1`, [old.id]));
  await withCatalog((c) => c.query('select public.end_expired_sessions()'));
  expect((await old.client.auth.refreshSession()).error).not.toBeNull();
  expect((await fresh.client.auth.refreshSession()).error).toBeNull();
});
it('is scheduled hourly', async () => {
  const { rows } = await withCatalog((c) => c.query(`select schedule, command from cron.job where jobname = 'end-expired-sessions'`));
  expect(rows).toEqual([{ schedule: '0 * * * *', command: 'select public.end_expired_sessions()' }]);
});
it('cannot be called by a signed-in user or anon', async () => {
  const a = await createTestUser();
  expect((await a.client.rpc('end_expired_sessions')).error).not.toBeNull();
  expect((await anon().rpc('end_expired_sessions')).error).not.toBeNull();
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm db:test -- session-limit`
Expected: FAIL, because `function public.end_expired_sessions() does not exist`.

- [ ] **Step 3: Create the migration** with `prisma migration new --name end_expired_sessions`, add the `rawSql` op, self-emit it, and apply it with `db:migrate`. If the `DELETE` on `auth.sessions` fails with `42501` as `postgres`, stop and report. Don't work around it with ownership changes.

- [ ] **Step 4: Regenerate the types, then run the suite**

Run: `pnpm db:types && pnpm db:test`
Expected: all pass, and `rls-enabled` stays green (pg_cron's tables are in `cron`, not `public`).

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/database/migrations apps/web/src/lib/supabase/database.types.ts apps/db-tests/src
git commit -m "feat(auth): end sessions older than 7 days with an hourly pg_cron job"
```

---

### Task 3: Admin users CLI (invite, block, unblock, list)

**Files:**

- Create: `apps/xjobs/src/admin/auth-users.ts`. Move `findAuthUserId` here from `seeds/users.seed.ts` as `findAuthUserByEmail`.
- Modify: `apps/xjobs/src/database/seeds/users.seed.ts` to import it.
- Create: `apps/xjobs/src/admin/users-admin.ts`, `apps/xjobs/src/admin/users-cli.ts`
- Test: `apps/xjobs/src/admin/users-admin.spec.ts`, `apps/xjobs/src/admin/users-cli.spec.ts`
- Modify: `apps/xjobs/package.json` (script `"users": "tsx --tsconfig tsconfig.app.json src/admin/users-cli.ts"`) and root `package.json` (script `"users": "pnpm --filter @xjobs/xjobs users"`)
- Create: `apps/db-tests/src/block.db.spec.ts`

**Interfaces:**

- Produces:
  - `type AdminAuth = Pick<SupabaseClient['auth']['admin'], 'inviteUserByEmail' | 'listUsers' | 'updateUserById'>`
  - `normalizeEmail(raw: string): string`, which trims and lowercases.
  - `findAuthUserByEmail(auth: AdminAuth, email: string): Promise<User | undefined>`, paginated `listUsers`, 1 000 per page.
  - `type CommandResult = { ok: boolean; message: string }`
  - `inviteUser(auth, email): Promise<CommandResult>`, `blockUser(auth, email)`, `unblockUser(auth, email)`
  - `listAuthUsers(auth): Promise<CommandResult>`, whose message has one line per user: `<email>  <pending|active|blocked>  <last sign-in ISO or "never">`
  - `runUsersCli(argv: string[], env: NodeJS.ProcessEnv, deps?: { createAuth?: (url: string, key: string) => AdminAuth; print?: (line: string) => void }): Promise<number>`, which returns the exit code.
- Statuses:
  - `pending` means `email_confirmed_at` is null.
  - `blocked` means `banned_until` is in the future.
  - `active` means anything else.
- Fixed messages:
  - `Invited <email>.`
  - `Re-sent the invite to <email>.`
  - `<email> has already signed up; nothing changed.`
  - `Blocked <email>. Their data is kept.`
  - `Unblocked <email>.`
  - `No user with email <email>.`
  - `Usage: pnpm users <invite|block|unblock> <email> | pnpm users list`
- Block uses `updateUserById(id, { ban_duration: '876000h' })`. Unblock uses `ban_duration: 'none'`.
- The CLI reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. If either is missing, it prints `Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (locally: eval "$(scripts/supabase-env.sh)").` and returns 1. Otherwise its first output line is `Using <host of SUPABASE_URL>`.

- [ ] **Step 1: Write the failing unit tests** in `users-admin.spec.ts` and `users-cli.spec.ts`, using a fake `AdminAuth` that records calls:

```ts
it('normalizes before looking up and inviting', async () => {
  await inviteUser(fake, '  Me@Example.COM ');
  expect(fake.calls.invite).toEqual(['me@example.com']);
});
it('invites a new email', ...);              // no user → ok, 'Invited me@example.com.'
it('re-sends to a pending invitee', ...);    // user with email_confirmed_at null → invite called, 'Re-sent the invite to …'
it('changes nothing for a signed-up user', ...); // confirmed user → invite NOT called, ok true, '… has already signed up; nothing changed.'
it('maps email_exists from Supabase to the same message', ...); // race: lookup misses, invite errors email_exists
it('blocks with a 100-year ban and keeps data', ...); // updateUserById(id, { ban_duration: '876000h' })
it('unblocks with ban_duration none', ...);
it('fails block/unblock for an unknown email', ...); // ok false, 'No user with email …'
it('lists pending, active and blocked users', ...);
it('refuses to run without both variables', async () => {
  expect(await runUsersCli(['list'], {}, { print })).toBe(1);
});
it('prints the target host first', async () => {
  await runUsersCli(['list'], { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, { createAuth: () => fake, print });
  expect(lines[0]).toBe('Using abc.supabase.co');
});
it('prints usage and returns 1 for an unknown command', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx nx test xjobs -- admin`
Expected: FAIL, because the modules can't be resolved.

- [ ] **Step 3: Implement `auth-users.ts`, `users-admin.ts` and `users-cli.ts`, and point the seed at `findAuthUserByEmail`.** `users-cli.ts` calls `runUsersCli(process.argv.slice(2), process.env)` and sets `process.exitCode` only when it runs as the entry file.

- [ ] **Step 4: Write the block tests** in `apps/db-tests/src/block.db.spec.ts`. They ban through `admin().auth.admin.updateUserById` directly, which is the same call the CLI makes:

```ts
it('a blocked user cannot refresh, sign in or verify a code, and their rows stay', async () => {
  const a = await createTestUser();
  await ban(a.id);
  expect((await a.client.auth.refreshSession()).error).not.toBeNull();
  await anon().auth.signInWithOtp({ email: a.email, options: { shouldCreateUser: false } });
  const mail = await latestEmailTo(a.email); // pins the known gap: the email still arrives
  const v = await anon().auth.verifyOtp({ email: a.email, token: mail.code, type: 'email' });
  expect(v.error?.code).toBe('user_banned');
  const { data } = await admin().from('users').select('id').eq('id', a.id);
  expect(data).toHaveLength(1);
});
it('unblocking restores sign-in', async () => {
  // ban, unban (ban_duration 'none'), then signInWithPassword with the test user's password succeeds.
  // createTestUser must expose its password for this; add `password` to TestUser.
});
```

- [ ] **Step 5: Run the unit and database suites**

Run: `npx nx test xjobs && pnpm db:reset && pnpm db:test`
Expected: all pass, and the seed still creates its three users.

- [ ] **Step 6: Smoke-test the CLI against the local stack**

Run: `eval "$(scripts/supabase-env.sh)" && pnpm users invite me@xjobs.test && pnpm users list && pnpm users block me@xjobs.test && pnpm users unblock me@xjobs.test`
Expected: `Using 127.0.0.1`, then the fixed messages. The invite email appears in Mailpit at http://127.0.0.1:54324.

- [ ] **Step 7: Commit**

```bash
git add apps/xjobs/src/admin apps/xjobs/src/database/seeds apps/xjobs/package.json package.json apps/db-tests/src
git commit -m "feat(auth): admin users CLI to invite, block, unblock and list"
```

---

### Task 4: Route decisions and the 7-day check in the proxy

**Files:**

- Create: `apps/web/src/lib/auth/session-policy.ts`, `apps/web/src/lib/auth/session-policy.spec.ts`
- Modify: `apps/web/src/lib/supabase/session.ts`

**Interfaces:**

- Produces:
  - `MAX_SESSION_AGE_SECONDS = 604_800`
  - `PUBLIC_PATHS = ['/sign-in', '/auth/confirm']`. A path is public when it equals one of these or starts with one plus `/`.
  - `type SessionClaims = { sub: string; amr?: { method: string; timestamp: number }[] }`
  - `signedInAt(claims: SessionClaims): number | null`, the max `amr[].timestamp`, or `null` when there is none.
  - `type RouteDecision = { action: 'continue' } | { action: 'redirect'; to: string; signOut: boolean }`
  - `decideRoute(input: { pathname: string; claims: SessionClaims | null; nowSeconds: number }): RouteDecision`
- Rules, in order:
  1. Claims present and sign-in more than 7 days ago, or `signedInAt` is null: redirect to `/sign-in?reason=expired` with `signOut: true`.
  2. No claims, on a non-public path: redirect to `/sign-in`.
  3. Valid claims on `/sign-in`: redirect to `/`.
  4. Otherwise continue.
- `updateSession` reads the claims from `supabase.auth.getClaims()`. On `signOut: true`, it calls `supabase.auth.signOut({ scope: 'local' })` before redirecting. The redirect response must carry the cookies `setAll` wrote. Copy them onto `NextResponse.redirect`.

- [ ] **Step 1: Write the failing tests** in `session-policy.spec.ts`:

```ts
const now = 1_800_000_000;
const claims = (ageSeconds: number) => ({ sub: 'u', amr: [{ method: 'otp', timestamp: now - ageSeconds }] });
it('sends a signed-out request for / to /sign-in', () =>
  expect(decideRoute({ pathname: '/', claims: null, nowSeconds: now })).toEqual({ action: 'redirect', to: '/sign-in', signOut: false }));
it('lets signed-out requests reach /sign-in and /auth/confirm', ...); // continue
it('does not treat /sign-inx as public', ...);                        // redirect
it('sends a signed-in user on /sign-in to /', ...);
it('continues for a session 6 days 23 hours old', ...);
it('ends a session older than 7 days', () =>
  expect(decideRoute({ pathname: '/', claims: claims(604_801), nowSeconds: now })).toEqual({ action: 'redirect', to: '/sign-in?reason=expired', signOut: true }));
it('ends an expired session even on a public path', ...);             // '/sign-in' with claims(604_801) → expired redirect
it('uses the newest amr timestamp', () =>
  expect(signedInAt({ sub: 'u', amr: [{ method: 'otp', timestamp: 10 }, { method: 'password', timestamp: 20 }] })).toBe(20));
it('treats claims without amr as expired', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx nx test web -- session-policy`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `session-policy.ts`, then wire it into `updateSession`.** The redirect for `/sign-in?reason=expired` on `/sign-in` itself must not loop: after the sign-out there are no claims, so the next request takes rule 4.

- [ ] **Step 4: Run the web tests**

Run: `npx nx test web`
Expected: all pass, including `no-service-role.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat(web): protect app pages and end sessions 7 days after sign-in"
```

---

### Task 5: Sign-in page with neutral code request and code entry

**Files:**

- Add UI primitives with the shadcn CLI, run from `apps/web`: `pnpm dlx shadcn@latest add input label input-otp`. This creates files under `apps/web/src/components/ui/`.
- Create: `apps/web/src/lib/auth/copy.ts`, which holds the five copy constants from Global Constraints.
- Create: `apps/web/src/lib/auth/request-code.ts`, `apps/web/src/lib/auth/verify-code.ts` and their `.spec.ts` files.
- Create: `apps/web/src/app/sign-in/page.tsx`, `apps/web/src/app/sign-in/sign-in-form.tsx` (`'use client'`), `apps/web/src/app/sign-in/actions.ts` (`'use server'`).

**Interfaces:**

- Consumes: `createSupabaseServerClient()` from `@/lib/supabase/server`.
- Produces:
  - `MIN_RESPONSE_MS = 1500`
  - `type RequestCodeResult = { status: 'sent'; message: typeof NEUTRAL_SENT } | { status: 'invalid'; message: 'Enter a valid email address.' }`
  - `requestCode(auth: Pick<SupabaseClient['auth'], 'signInWithOtp'>, rawEmail: string, deps?: { now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (outcome: string) => void }): Promise<RequestCodeResult>`
    - It normalizes the email (trim, lowercase). A malformed email returns `invalid` without calling Supabase.
    - Otherwise it calls `signInWithOtp({ email, options: { shouldCreateUser: false } })`.
    - It logs `error?.code ?? 'sent'`, never the email.
    - It sleeps until `MIN_RESPONSE_MS` has passed since the start, then returns `sent` whatever the outcome, thrown errors included.
  - `type VerifyCodeResult = { ok: true } | { ok: false; message: typeof CODE_FAILED }`
  - `verifyCode(auth: Pick<SupabaseClient['auth'], 'verifyOtp'>, rawEmail: string, code: string): Promise<VerifyCodeResult>`
    - It uses `type: 'email'`.
    - A code that isn't exactly 6 digits returns `CODE_FAILED` without calling Supabase.
  - Server actions:
    - `requestCodeAction(email: string): Promise<RequestCodeResult>`
    - `verifyCodeAction(email: string, code: string): Promise<VerifyCodeResult>`, which calls `redirect('/')` from `next/navigation` on success.
- Page behaviour:
  - Step one is an email field.
  - After submit, the page shows `NEUTRAL_SENT`, then `EXPIRED_INVITE_HINT` in small text, a 6-digit `InputOTP`, and "Send a new code", disabled for a 60-second countdown.
  - `?reason=expired` shows `SESSION_EXPIRED` above the form, and `?reason=link` shows `LINK_FAILED`.
  - Signed-in users never see this page, because the proxy redirects them.

- [ ] **Step 1: Write the failing tests** in `request-code.spec.ts` and `verify-code.spec.ts`, with fake `auth` objects and a fake clock:

```ts
it.each([
  ['sent', { data: {}, error: null }],
  ['unknown email', { data: {}, error: { code: 'otp_disabled' } }],
  ['unaccepted invite', { data: {}, error: { code: 'signup_disabled' } }],
  ['rate limited', { data: {}, error: { code: 'over_email_send_rate_limit' } }],
])('answers %s with the neutral message', async (_, reply) => {
  expect(await requestCode(fakeAuth(reply), 'me@example.com', deps)).toEqual({ status: 'sent', message: NEUTRAL_SENT });
});
it('answers a thrown network error the same way', ...);
it('pads to 1500 ms from the start', async () => {
  // fake now: 0 at start, 200 after the call → sleep called with 1300
});
it('does not sleep when the call already took longer than 1500 ms', ...); // sleep not called or called with <= 0
it('passes shouldCreateUser false and the normalized email', ...);        // ' Me@Example.com ' → 'me@example.com'
it('rejects a malformed email without calling Supabase', ...);
it('never logs the email', ...);                                           // log args don't contain 'example.com'
// verify-code.spec.ts
it('verifies with type email', ...);                                       // verifyOtp called with { email, token, type: 'email' }
it('returns CODE_FAILED for an error, including user_banned', ...);
it('rejects a non-6-digit code without calling Supabase', ...);            // '12345', '1234567', '12a456'
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx nx test web -- request-code verify-code`
Expected: FAIL, because the modules aren't found.

- [ ] **Step 3: Implement `copy.ts`, `request-code.ts` and `verify-code.ts`, then the actions and the page.** The client form calls the server actions. It never imports the browser Supabase client.

- [ ] **Step 4: Run the web tests and the build**

Run: `npx nx run-many -t test lint typecheck build -p web`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): sign-in page with neutral code requests and 6-digit code entry"
```

---

### Task 6: Confirm link, sign-out, setup placeholder and home

**Files:**

- Create: `apps/web/src/app/auth/confirm/route.ts`, `apps/web/src/app/auth/confirm/route.spec.ts`
- Create: `apps/web/src/app/auth/sign-out/route.ts`
- Create: `apps/web/src/lib/auth/landing.ts`, `apps/web/src/lib/auth/landing.spec.ts`
- Create: `apps/web/src/app/setup/page.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/sign-out-button.tsx`

**Interfaces:**

- Consumes: `createSupabaseServerClient()`, plus `LINK_FAILED` and the `?reason=link` convention from Task 5.
- Produces:
  - `GET /auth/confirm?token_hash=…&type=invite|email`
    - It accepts only `type` values in `['invite', 'email']` and a non-empty `token_hash`. Anything else redirects to `/sign-in?reason=link` without calling Supabase.
    - It calls `verifyOtp({ token_hash, type })`. Success redirects to `/`, and an error redirects to `/sign-in?reason=link`.
  - `POST /auth/sign-out`: calls `signOut({ scope: 'local' })`, then answers `303` to `/sign-in`.
  - `landingPath(supabase: SupabaseClient<Database>): Promise<'/setup' | '/'>`. It runs `from('profiles').select('id').limit(1)` (RLS limits this to the user's own rows) and returns `/setup` when there are no rows.
  - `/` (server component):
    - It calls `getClaims()`. Without claims it redirects to `/sign-in`, as a defence beyond the proxy.
    - It then redirects to `/setup` if `landingPath` says so.
    - Otherwise it shows the user's email (`claims.email`) and the sign-out button.
  - `/setup`: a heading `Set up your profile`, one line saying guided setup is coming, and the sign-out button. It checks claims the same way. The heading is my call; slice 07 replaces this page.
  - `SignOutButton`: a `<form method="post" action="/auth/sign-out">` around the shadcn `Button`.

- [ ] **Step 1: Write the failing tests**. Use `vi.mock('@/lib/supabase/server')` to return a fake client:

```ts
// route.spec.ts
it('verifies an invite link and redirects to /', ...);  // verifyOtp({ token_hash: 'h', type: 'invite' }); 307 Location ends with '/'
it('verifies an email link', ...);                      // type 'email'
it('sends a failed verification to /sign-in?reason=link', ...);
it.each(['recovery', 'signup', ''])('refuses type %j without calling Supabase', ...);
it('refuses a missing token_hash without calling Supabase', ...);
// landing.spec.ts
it('sends a user with no profiles to /setup', ...);
it('sends a user with a profile to /', ...);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx nx test web -- confirm landing`
Expected: FAIL, because the modules aren't found.

- [ ] **Step 3: Implement the route handlers, `landing.ts`, the two pages and `SignOutButton`**

- [ ] **Step 4: Run the web checks**

Run: `npx nx run-many -t test lint typecheck build -p web`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): confirm links, sign-out, setup placeholder and signed-in home"
```

---

### Task 7: Docs, the manual end-to-end check, and full CI

**Files:**

- Modify: `README.md`, "Local stack". Add a "Signing in locally" paragraph:
  - Invite yourself with `eval "$(scripts/supabase-env.sh)" && pnpm users invite you@xjobs.test`.
  - Read the email at http://127.0.0.1:54324.
  - Public sign-up is off.
  - The seeded users can sign in by requesting a code.
- Create: `docs/auth-production.md`. List every Auth value from Task 1, so it can be mirrored in the Supabase Cloud dashboard:
  - sign-up off, OTP length 6, expiry 86400, a 60-second frequency, the email rate limit;
  - Site URL and redirect URLs as placeholders for slice 09;
  - both templates (paste from `supabase/templates/`) with their subjects.
  - Gmail SMTP: a dedicated Gmail account, 2-step verification, an app password, host `smtp.gmail.com`, port 587, sender name `10xjobs`, sender address the Gmail address. Credentials go only in the dashboard.
  - pg_cron gets enabled by the migration. The Pro-plan `timebox = "168h"` alternative is noted.
  - How to run `pnpm users …` against production (export the project's URL and key in the shell, and check the `Using <host>` line).
- Link `docs/auth-production.md` from the README "Documentation" section.

- [ ] **Step 1: Write both docs.**

- [ ] **Step 2: Run the manual end-to-end check** against the local stack and the web app (`npx nx dev web`). Write the result into the PR description:
  1. `pnpm users invite e2e@xjobs.test`. Type the invite code on `/sign-in` and land on `/setup`.
  2. Sign out, which lands on `/sign-in`.
  3. Request a code for `e2e@xjobs.test` and click the link in Mailpit. A user with no profiles lands on `/setup`. (To see `/` instead, insert a draft profile for them through Studio first.)
  4. Request a code for `nobody@xjobs.test`. You see the same message, and Mailpit receives nothing.
  5. Open `/` in a private window, which redirects to `/sign-in`.
  6. Click an already-used link, which lands on `/sign-in` with `LINK_FAILED`.

- [ ] **Step 3: Run CI locally**

Run: `npx nx run-many -t lint test build typecheck && pnpm db:reset && pnpm db:types && git diff --exit-code apps/web/src/lib/supabase/database.types.ts && pnpm db:test`
Expected: all green, with no diff.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/auth-production.md
git commit -m "docs: local sign-in and production auth setup"
```

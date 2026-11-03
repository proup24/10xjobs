# Accounts and Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tie `public.users` to Supabase Auth, turn on RLS for every table with the owner and draft-only policies, lock engine-set profile columns, and prove isolation with a two-user `supabase-js` harness plus a CI check that no table lacks RLS.

**Architecture:** Schema, policies and the foreign key to `auth.users` live in `apps/xjobs/src/database/contract.prisma` (Supabase extension pack). What the contract can't express (the data reset, the sign-up trigger, column grants) goes in hand-written Prisma migrations using `rawSql`. Tests live in `apps/db-tests` and act only through signed-in `supabase-js` clients. The service role only sets up data and reads back state.

**Tech Stack:** Prisma 8 rc.21 with `@prisma/orm-extension-supabase`, Supabase CLI stack, NestJS engine, Vitest, `@supabase/supabase-js`, `pg` (catalog check only).

**Spec:** `docs/superpowers/specs/2026-11-03-accounts-and-isolation-design.md`

**Branch:** `feat/accounts-and-isolation` (already created, spec committed). One PR to `main`.

## Global Constraints

- The Prisma contract and its migrations are the only schema source. Nothing goes in `supabase/` that creates schema objects.
- Policies target `authenticated` only. `anon` gets none.
- In `apps/db-tests`, the operation under test always goes through a signed-in user's (or anon) `supabase-js` client. The service role only creates users and fixture rows and reads back state.
- Isolation is asserted by outcome (rows returned, row unchanged, row still exists), never only by "an error happened". Only inserts and `WITH CHECK` violations are expected to error.
- `db-tests` refuses non-local hosts (the existing `assertLocal` rule extends to the Postgres URL).
- Migrations are framework-rendered: create them with `pnpm --filter @xjobs/xjobs db:migration:plan --name <slug>` or `pnpm --filter @xjobs/xjobs exec prisma migration new --name <slug>`, edit only the `operations` getter, then self-emit with `node <package>/migration.ts`. Never write a migration package from a blank file.
- Prisma docs for this version: `node_modules/@prisma/orm-postgres/skills/prisma-8/references/{supabase,migrations,contract}.md` (resolve through `node_modules/.pnpm/@prisma+orm-postgres@8.0.0-rc.21*`). `rawSql(op: Op)` is exported from the rendered migration import line. Read the `Op` type in `@prisma/orm-target-postgres/dist/migration-*.d.mts` for its fields.
- CI must be green: `npx nx run-many -t lint test build typecheck` and the `database` job.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude doesn't push.

## Review Focus

1. **A user invited through `auth.admin.inviteUserByEmail`** (slice 03's path), not just `createUser`, gets exactly one `users` row. Test in Task 1.
2. **A skill pointed at another user's draft profile.** A inserts a skill with their own `userId` and B's `profileId`. Expected: it fails. This catches an unqualified `"userId"` inside the policy's `EXISTS`, which would silently resolve to `profiles."userId"`. Test in Task 3.
3. **`insert(...).select()` on `profiles` after the column grants.** PostgREST returns the row, so the owner's draft insert must succeed and come back whole. Test in Task 3.
4. **The service role can still publish.** Column grants are revoked from `authenticated` and `anon` only, so a service-role update of `state`/`publishedAt` succeeds. Test in Task 4.
5. **Patching only a locked column** (e.g. `{ resumeKey }`) on one's own draft gives a permission error (`42501`), not a silent no-op, and the value is unchanged. Test in Task 4.

---

### Task 1: `users` tied to Auth, data reset, sign-up trigger, engine follow-through

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (`User`, `ProfileSkill`, `Profile`)
- Create (rendered): `apps/xjobs/src/database/migrations/app/<ts>_reset_users_for_auth/`, `<ts>_users_from_auth/`, `<ts>_auth_user_trigger/`
- Regenerate: `apps/xjobs/src/database/contract.json`, `contract.d.ts`, `apps/web/src/lib/supabase/database.types.ts`
- Modify: `apps/xjobs/src/database/seeds/users.seed.ts`, `apps/xjobs/src/config/environment.validation.ts` (seed schema)
- Modify: `apps/xjobs/src/modules/users/{controllers/users.controller.ts,services/users.service.ts,repositories/users.repository.ts,dto/create-user.dto.ts (delete),dto/update-user.dto.ts,dto/user.response.dto.ts,types/user.types.ts,testing/fakes.ts}` and their specs (`users.service.spec.ts`, `dto/user.dto.spec.ts`)
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts` (`writeSkills`), `testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/ingest/repositories/ingest.postgres.spec.ts`
- Create: `apps/xjobs-e2e/src/support/auth-users.ts`; Modify: `apps/xjobs-e2e/src/xjobs/users.spec.ts`
- Create: `scripts/supabase-env.sh`; Modify: root `package.json` (`db:reset`), `.github/workflows/ci.yml`
- Create: `apps/db-tests/src/support/admin.ts`; Modify: `apps/db-tests/src/support/test-users.ts`
- Test: `apps/db-tests/src/accounts.db.spec.ts`

**Interfaces:**

- Produces (db-tests): `admin(): SupabaseClient` in `support/admin.ts`, the service-role client for setup and read-back only. `test-users.ts` uses it, and its `TestUser` type is unchanged. Also `inviteTestUser(): Promise<{ id: string }>`: invites a random `@xjobs.test` address through the admin API and registers it for cleanup.
- Produces (schema): `users(id uuid pk → auth.users.id cascade, name text null, address jsonb null, createdAt, updatedAt)`, and `profile_skills."userId" uuid not null → users.id cascade`, indexed.
- Produces (e2e): `createAuthUser(name?: string): Promise<string>` in `apps/xjobs-e2e/src/support/auth-users.ts`, returning the new auth user's id, and `deleteAuthUser(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing account tests** in `apps/db-tests/src/accounts.db.spec.ts`:

```ts
it('a new auth user gets exactly one users row with a null name', async () => {
  const a = await createTestUser();
  const { data } = await admin().from('users').select('id, name').eq('id', a.id);
  expect(data).toEqual([{ id: a.id, name: null }]);
});
it('an invited user gets exactly one users row', async () => {
  const { id } = await inviteTestUser();
  const { data } = await admin().from('users').select('id').eq('id', id);
  expect(data).toHaveLength(1);
});
it('deleting the auth user removes their users row and everything they own', async () => {
  // A with a contact, a draft profile and one skill (inserted via admin()); then admin().auth.admin.deleteUser(a.id)
  // expect users, contacts, profiles, profile_skills rows for a.id all gone (count 0 each)
});
it('a user cannot insert a second users row or delete their own', async () => {
  // after Task 2's policies; mark .todo until Task 2, then enable
  // a.client.from('users').insert({ id: randomUUID() }) → error not null
  // a.client.from('users').delete().eq('id', a.id) → admin() still finds the row
});
it('users has no email column', async () => {
  const { error } = await admin().from('users').select('email').limit(1);
  expect(error?.code).toBe('42703');
});
```

- [ ] **Step 2: Run them and see them fail.** Run `pnpm db:test -- accounts`. Expected: FAIL. There's no trigger (no row), and `email` exists.

- [ ] **Step 3: Reset migration.** `prisma migration new --name reset_users_for_auth`. Add one `rawSql` op with `operationClass: 'destructive'`, an empty postcheck, and this SQL: `DELETE FROM public.query_search_builder; DELETE FROM public.users;`. Query links, hits, contacts, profiles and skills cascade. Raw jobs stay. Self-emit.

- [ ] **Step 4: Contract changes** in `contract.prisma`:
  - `User`: `id Uuid @id` (drop `@onCreate(uuid(7))`) plus `authUser supabase:auth.AuthUser @relation(fields: [id], references: [id], onDelete: Cascade)`. Remove `email` and `@@unique([email])`. Make it `name String?`.
  - `ProfileSkill`: `userId Uuid`, `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`, `@@index([userId])`.
  - Composite ownership: add `@@unique([id, userId])` on `Profile`, and on `ProfileSkill` a relation `(profileId, userId) → Profile(id, userId)` with `onDelete: Cascade`. If emit rejects a composite relation, drop it, keep the single `profileId` relation, and add a line to the PR description. Task 3's policy also checks ownership.
  - Then run `pnpm --filter @xjobs/xjobs db:migration:plan --name users_from_auth`. If it renders a `placeholder` to backfill `ProfileSkill.userId`, fill it from `profiles."userId"` by `profileId` (a no-op after the reset, but correct). Self-emit.

- [ ] **Step 5: Trigger migration.** `prisma migration new --name auth_user_trigger`. Add one `rawSql` op (additive, empty postcheck) with:

```sql
CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users (id) VALUES (NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

Self-emit, then run `pnpm db:reset`. Expected: migrations apply cleanly on a fresh stack. If `db verify` or the next `migration plan` complains about the unknown function or trigger, stop and report rather than work around it.

- [ ] **Step 6: Seed through Auth.** Add optional `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the seed env schema, and make the users seed fail with a clear message if either is missing. For each of `admin@`, `recruiter@`, `candidate@xjobs.local`: `auth.admin.createUser({ email, email_confirm: true })`. On an "already registered" error, find the id with `auth.admin.listUsers()`. Then set `name` on `public.users` by id through `tx`. It must stay safe to re-run.
  - Create `scripts/supabase-env.sh`. It prints `export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…` from `pnpm exec supabase status -o env` (`API_URL`, `SERVICE_ROLE_KEY`, quotes stripped).
  - `db:reset` evals it before seeding.
  - In `ci.yml`, a step before "Seed the database" appends the same two variables to `$GITHUB_ENV`.

- [ ] **Step 7: Engine follow-through.**
  - `POST /users` throws `GoneException('Users are created through Supabase Auth')`. Keep the Swagger decorator with status `410`.
  - Delete `CreateUserDto`, `UsersService.create`, `UsersRepository.create`, `EMAIL_TAKEN` and `normalize`.
  - `UserInput` becomes `{ name?: string | null; address?: Address | null }`.
  - `UpdateUserDto` drops `email`. `UserResponseDto` drops `email`, and `name` becomes `string | null`.
  - Update `fakes.ts` and the specs to match: drop the email-uniqueness tests and add a controller or service test that create returns 410.
  - `writeSkills(tx, userId, profileId, skills)` sets `userId` on every skill. Update its callers and the fake.

- [ ] **Step 8: The tests that created users directly.**
  - `ingest.postgres.spec.ts`: create each user by inserting `(id, email)` into `auth.users` with `db.raw.sql`, and let the trigger make the `users` row. Add `auth.users` to the truncate list. Its `ingest_test` database must now come from a migrated Supabase Postgres. Note that in the file's header comment.
  - e2e `users.spec.ts`: the `beforeAll` uses `createAuthUser` (service role via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`), then `PATCH`es the name and address through the engine. Drop the lowercased-email and duplicate-409 tests. The validation test now posts an invalid `name` to `PATCH`. Add one test that `POST /api/users` returns 410. `afterAll` deletes through the engine, then `deleteAuthUser`.

- [ ] **Step 9: Regenerate and verify.**
  - Run `pnpm db:types`.
  - Run `pnpm db:test -- accounts`. Expected: PASS.
  - Run `npx nx run-many -t lint test build typecheck`. Expected: PASS.
  - Run `npx nx e2e xjobs-e2e` with the engine served against the stack. Expected: PASS. If the e2e can't run locally, say so in the PR. Don't mark it as passing.

- [ ] **Step 10: Commit.** `feat(db): tie users to Supabase Auth with a sign-up trigger`

---

### Task 2: Isolation harness and owner policies on `users` and `contacts`

**Files:**

- Create: `apps/db-tests/src/support/registry.ts`, `apps/db-tests/src/support/fixtures.ts`
- Test: `apps/db-tests/src/isolation.db.spec.ts`
- Modify: `apps/xjobs/src/database/contract.prisma` (`@@rls` and policies on `User`, `Contact`), plus a rendered migration `<ts>_owner_policies`

**Interfaces:**

- Consumes: `createTestUser()`, `admin()` from Task 1.
- Produces, in `registry.ts`:

```ts
export type OwnedTable = {
  table: string;
  ownerColumn: 'userId' | 'id';
  /** Service role creates a row owned by userId and returns its id. */
  seed(userId: string): Promise<string>;
  /** A valid insert payload for userId, or null if users can't insert. */
  insertPayload: ((userId: string) => Promise<Record<string, unknown>>) | null;
  /** A harmless update the owner is allowed to make. */
  patch: Record<string, unknown>;
  canDelete: boolean;
};
export const ownedTables: OwnedTable[];
```

`fixtures.ts` exports `profileFields()` (valid required `profiles` fields: copy the values from `apps/xjobs-e2e/src/xjobs/users.spec.ts`'s `profile` without `techStack`), `seedProfile(userId, overrides?)`, `seedSkill(userId, profileId)` and `seedContact(userId)`. Each inserts through `admin()` with `id: randomUUID()` and returns the id.

- [ ] **Step 1: Write the shared isolation suite** in `isolation.db.spec.ts`. It's a `describe.each(ownedTables)` with users A and B. Assertions per table (`t`), where `bRow = await t.seed(b.id)`:
  - `a.client.from(t.table).select('*').eq('id', bRow)` → `data` is `[]`. A full `select` contains no row with B's owner value.
  - `a.client.from(t.table).update(t.patch).eq('id', bRow).select()` → `data` is `[]`, and `admin()` reads B's row unchanged.
  - If `t.canDelete`: `a.client.from(t.table).delete().eq('id', bRow)`, then `admin()` still finds the row.
  - If `t.insertPayload`: inserting `{ ...await t.insertPayload(a.id), [t.ownerColumn]: b.id }` → `error` is not null, and no such row exists.
  - `a.client.from(t.table).update({ [t.ownerColumn]: b.id }).eq('id', aRow)` → `error` is not null, and the row is still A's.
  - Owner path: A can select, update with `t.patch` (and get one row back), insert (if allowed) and delete (if `canDelete`) their own rows.
  - An anon client (`createClient(url, anonKey)`) selecting the table → `data` is `[]`.

  Register `users` (seed: none needed, since `createTestUser` makes the row. Return the user id. `insertPayload: null`, `patch: { name: 'Renamed' }`, `canDelete: false`) and `contacts` (`patch: { label: 'work' }`, `canDelete: true`).

- [ ] **Step 2: Run it and see it fail.** Run `pnpm db:test -- isolation`. Expected: FAIL on the read and write isolation cases, because there's no RLS yet.

- [ ] **Step 3: Policies.** Add `@@rls` to `User` and `Contact`. Then add these blocks, all `roles = [authenticated]`:
  - `policy_select users_owner_read` with `` using = sql`id = auth.uid()` ``
  - `policy_update users_owner_update` with `using` and `withCheck` both `` sql`id = auth.uid()` ``
  - `policy_all contacts_owner` with `using` and `withCheck` both `` sql`"userId" = auth.uid()` ``

  Put the blocks at the top level next to their models. If emit requires a `namespace public { }` wrapper for policy blocks, wrap only what it requires, and say so in the PR. Run `db:migration:plan --name owner_policies`, then `pnpm db:reset` and `pnpm db:types`.

- [ ] **Step 4: Run it.** Turn the `.todo` account test from Task 1 into a real test, then run `pnpm db:test`. Expected: PASS, with `smoke` and `accounts` still green.

- [ ] **Step 5: Commit.** `feat(db): owner RLS on users and contacts with a two-user isolation harness`

---

### Task 3: Profiles and skills: draft-only policies and column grants

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (`Profile`, `ProfileSkill`), plus a rendered migration `<ts>_profile_policies` and a hand-written `<ts>_profile_column_grants`
- Modify: `apps/db-tests/src/support/registry.ts` (add `profiles` and `profile_skills`)
- Test: `apps/db-tests/src/isolation.db.spec.ts` (Review Focus 2 and 3 cases)

**Interfaces:**

- Consumes: `OwnedTable`, `seedProfile`, `seedSkill`, `profileFields` from Task 2.
- Produces: the `profiles` user-editable column list, used by Task 4's tests:
  - Insert: `id`, `userId`, `position`, `languages`, `country`, `city`, `regions`, `yearsOfExperience`, `timezoneCurrent`, `timezoneMin`, `timezoneMax`, `engagements`, `arrangements`, `seniority`, `noticePeriodDays`.
  - Update: the same list minus `id` and `userId`.

- [ ] **Step 1: Write the failing tests.**
  - Registry entries: `profiles` (seed `seedProfile`, insert payload `{ id: randomUUID(), userId, ...profileFields() }`, `patch: { noticePeriodDays: 60 }`, `canDelete: true`) and `profile_skills` (seed: a draft profile for the user plus one skill; insert payload `{ id, userId, profileId: <a fresh draft of userId>, technology: 'rust', domain: 'backend', mastery: 5 }`, `patch: { mastery: 6 }`, `canDelete: true`).
  - Plus these extra cases:
    - A inserts a skill with `userId: a.id` and `profileId` of B's draft → `error` is not null, and no skill row exists (Review Focus 2).
    - Service role inserts a skill whose `userId` differs from its profile's owner → `error` is not null (composite FK). Skip with a note if Task 1 dropped the composite relation.
    - `a.client.from('profiles').insert(payload).select().single()` → `error` null, `data.id === payload.id`, `data.state === 'draft'` (Review Focus 3).

- [ ] **Step 2: Run them and see them fail.** Run `pnpm db:test -- isolation`. Expected: the new entries FAIL.

- [ ] **Step 3: Policies.** Add `@@rls` to `Profile` and `ProfileSkill`, then these blocks, all `roles = [authenticated]`:
  - `profiles_owner_read` (select): `"userId" = auth.uid()`
  - `profiles_owner_insert` (insert, withCheck): `"userId" = auth.uid() AND state = 'draft' AND "publishedAt" IS NULL`
  - `profiles_owner_update_draft` (update): using `"userId" = auth.uid() AND state = 'draft'`. withCheck: the same `AND "publishedAt" IS NULL`.
  - `profiles_owner_delete_draft` (delete): using `"userId" = auth.uid() AND state = 'draft'`
  - `profile_skills_owner_read` (select): `"userId" = auth.uid()`
  - `profile_skills_owner_insert`, `_update` and `_delete` share this predicate (as withCheck for insert, using and withCheck for update, using for delete):

```sql
"userId" = auth.uid() AND EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid() AND p.state = 'draft'
)
```

Qualify the outer column as `profile_skills."profileId"`. Never use bare `"userId"` inside the subquery. Run `db:migration:plan --name profile_policies`.

- [ ] **Step 4: Column grants.** `prisma migration new --name profile_column_grants`. Add one `rawSql` op with an empty postcheck:

```sql
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT (<insert list from Interfaces>) ON public.profiles TO authenticated;
GRANT UPDATE (<update list from Interfaces>) ON public.profiles TO authenticated;
```

Quote every camelCase column. Self-emit, then run `pnpm db:reset` and `pnpm db:types`.

- [ ] **Step 5: Run it.** Run `pnpm db:test`. Expected: PASS.

- [ ] **Step 6: Commit.** `feat(db): draft-only RLS and column grants on profiles and skills`

---

### Task 4: Published-profile freezing

**Files:**

- Test: `apps/db-tests/src/profile-freeze.db.spec.ts`

**Interfaces:**

- Consumes: `createTestUser`, `admin`, `seedProfile`, `seedSkill`, `profileFields` (Task 2), and the column lists (Task 3).

- [ ] **Step 1: Write the tests.** Setup: user A, with a published profile `pub` (via `seedProfile(a.id, { state: 'published', publishedAt: new Date().toISOString() })`) holding skill `pubSkill`, and a draft `draft` holding skill `draftSkill`. Each "unchanged" check reads back through `admin()`.
  - Updating `pub` with `{ noticePeriodDays: 90 }` → `data` is `[]` and the row is unchanged. Deleting `pub` → the row still exists.
  - Updating `pubSkill` → `[]` and unchanged. Deleting `pubSkill` → still exists. Inserting a skill on `pub` → `error` not null.
  - Inserting a profile with `state: 'published'` → `error` not null. With `publishedAt` set → `error` not null.
  - Updating `draft` with `{ state: 'published' }` → `error.code === '42501'`. With `{ publishedAt: <now> }` → `42501`. The row stays a draft with null `publishedAt`.
  - For each of `resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`, `createdAt`, `updatedAt`: an update of `draft` with only that column → `error.code === '42501'`, and the value is unchanged (Review Focus 5). An insert that includes `resumeKey` → `42501`.
  - On `draft`: updating `{ position: 'frontend_engineer' }` succeeds. Updating, inserting and deleting skills succeeds. Deleting the profile succeeds.
  - `admin().from('profiles').update({ state: 'published', publishedAt: <now> }).eq('id', draftId).select()` → one row back (Review Focus 4).

- [ ] **Step 2: Run them.** Run `pnpm db:test -- profile-freeze`. Expected: PASS, since Task 3 already built the behaviour. If any case fails, that's a policy or grant bug. Fix it in Task 3's migrations (re-render and self-emit), not in the test.

- [ ] **Step 3: Commit.** `test(db): prove published profiles and their skills are frozen for users`

---

### Task 5: Engine-only tables hidden, and the RLS-enabled check

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (`@@rls` on `QuerySearchBuilder`, `ProfileQuerySearchBuilder`, `RawJob`, `RawJobIdentity`, `RawJobQueryHit`, `AtsPostingIdentity`), plus a rendered migration `<ts>_engine_tables_rls`
- Create: `apps/db-tests/src/support/pg.ts`; Modify: `apps/db-tests/package.json` (add `pg` and `@types/pg`)
- Test: `apps/db-tests/src/engine-tables.db.spec.ts`, `apps/db-tests/src/rls-enabled.db.spec.ts`

**Interfaces:**

- Produces: `withCatalog<T>(fn: (client: pg.Client) => Promise<T>): Promise<T>` in `support/pg.ts`. It connects to `DATABASE_URL`, or `postgresql://postgres:postgres@127.0.0.1:54322/postgres` when that's unset. It refuses non-local hosts the same way as `stack-env.ts`'s `assertLocal` (reuse it by exporting it). It is for catalog reads only.

- [ ] **Step 1: Write the failing tests.**
  - `rls-enabled.db.spec.ts`: select `relname` from `pg_class` joined to `pg_namespace`, where `nspname = 'public'`, `relkind IN ('r','p')` and `NOT relrowsecurity`. Expect `[]`. The failure message lists the table names.
  - `engine-tables.db.spec.ts`: for each of the six tables, `admin()` inserts one minimal valid row (cleaned up `afterAll`). A signed-in user's `select('*')` returns `[]`. The user's insert of a valid row returns an error.

- [ ] **Step 2: Run them and see them fail.** Run `pnpm db:test -- rls-enabled engine-tables`. Expected: FAIL, listing the six engine tables.

- [ ] **Step 3: Add `@@rls` with no policies** to the six models. Run `db:migration:plan --name engine_tables_rls`, then `pnpm db:reset` and `pnpm db:types`.

- [ ] **Step 4: Run everything.**
  - Run `pnpm db:test`. Expected: all PASS.
  - Run `npx nx run-many -t lint test build typecheck`. Expected: PASS.
  - Run `pnpm --filter @xjobs/xjobs db:verify`. Expected: clean.
  - Serve the engine and hit `GET /api/users`. Expected: 200, which shows the engine as `postgres` still bypasses RLS.

- [ ] **Step 5: Commit.** `feat(db): hide engine-only tables behind RLS and fail CI on any table without it`

---

### Task 6: Docs and PR

**Files:**

- Modify: `README.md` (or wherever the local DB setup is documented): the seed now needs the stack's service key (`db:reset` handles it), and users are created through Auth.
- Modify: `docs/superpowers/specs/2026-11-03-accounts-and-isolation-design.md` only if a fallback was taken (composite FK, namespace wrapper): one line under "Known gaps".

- [ ] **Step 1:** Update the docs as above. Run `pnpm db:reset && pnpm db:test` once more from a clean stack. Expected: PASS.
- [ ] **Step 2: Commit.** `docs: local setup after users moved to Supabase Auth`
- [ ] **Step 3:** Tell the human the branch is ready to push. Give a PR description that lists any fallbacks taken and whether the e2e and `ingest_test` suites were run.

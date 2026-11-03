# Phase 1, slice 02: Accounts and isolation

Status: draft, 2026-11-03. Implements
[02-accounts-and-isolation.md](../../roadmap/phase-1-accounts-and-preferences/02-accounts-and-isolation.md)
under the decisions in the
[Phase 1 README](../../roadmap/phase-1-accounts-and-preferences/README.md).
Builds on the
[foundation spec](2026-11-02-foundation-design.md) (the Supabase CLI stack, the
Supabase extension pack and the `apps/db-tests` project).

## Intent

The Phase 1 exit criterion is "one user can never read or change another
user's data, and tests prove it." This slice makes that true and provable for
the tables that exist today, and sets the pattern every later table follows:

- `public.users` is tied to Supabase Auth, so the tenant is the auth user.
- Every table has RLS. User-owned tables carry `userId` and use the same owner
  policy, and shared engine tables are hidden from users.
- Profiles that have been published are frozen against the user.
- A reusable two-user harness proves isolation through `supabase-js`, the path
  the web app uses, and later slices add their tables to it in a few lines.

## Goals

- A new auth user gets exactly one `public.users` row, created by the database.
- `public.users.id` is a foreign key to `auth.users.id` with cascade delete.
- `profile_skills` gets a `userId`, so every owner policy is
  `"userId" = auth.uid()`.
- RLS is on for every table in `public`, written in the Prisma contract.
- The harness proves A can't read, insert into, update or delete B's rows, and
  that a published profile and its skills can't be changed by their owner.
- CI fails if any table in `public` has RLS disabled.

## Non-goals

- Teams, members or roles.
- Account deletion by the user. Removal stays a manual admin task: deleting
  the auth user cascades through everything.
- Removing the engine's CRUD endpoints (later, once the UI slices cover them).
- The engine's internal API and token check (with publishing).
- Invites, sign-in pages, and turning off public sign-up (slice 03).
- An admin flag, role or page.

## Anti-goals

- **A table without RLS**, or a user-owned table whose policy isn't a plain
  `"userId" = auth.uid()` check (the one exception is below).
- **Isolation tests that bypass RLS** to perform the operation under test. As
  in slice 01, the service role only sets up users and data, and may read back
  state to confirm nothing changed.
- **Tests that look for an error to prove isolation.** RLS hides rows instead
  of refusing them: a read of B's rows returns an empty list, and an update or
  delete of B's rows changes nothing and returns no error. Only an insert (or
  an update that writes a row the user can't own) fails loudly. Each test
  checks the outcome, not just the error.
- **A user publishing, unpublishing, editing or deleting a published profile**
  through `supabase-js`.
- **A second schema source.** Policies, the foreign key and the trigger all
  live in the Prisma contract and its migrations.

## Decisions (agreed with the user)

| Question                            | Decision                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing local `users` rows         | Reset. They are seeded test data. The seed creates auth users through the admin API and lets the trigger create their `public.users` rows.                                                                                                                                           |
| How the admin is identified         | By holding the service-role key. Slice 03's invite script runs with it. No flag or role column now.                                                                                                                                                                                  |
| How profile `state` is protected    | By RLS policies alone, no trigger. Insert must be a draft with no `publishedAt`; update must start from a draft and stay a draft with no `publishedAt`; delete only drafts. `profile_skills` policies also require their profile to be a draft, which needs a lookup of the profile. |
| `email` on `public.users`           | Dropped. Auth is the only copy. The web app reads it from the session, the engine from Auth with its service key. Application emails live in `contacts`.                                                                                                                             |
| `name` on `public.users`            | Becomes optional. The trigger fires before anyone has typed a name; guided setup (slice 07) fills it in.                                                                                                                                                                             |
| The engine's `POST /users` endpoint | Stops creating users (it would invent ids that aren't auth users). It returns an error rather than being fixed, since the CRUD endpoints are going away.                                                                                                                             |

## Shape

### 1. `users` tied to Auth

In `contract.prisma`:

- `User.id` becomes a relation to the pack's `supabase:auth.AuthUser` with
  `onDelete: Cascade`. It no longer generates its own id (`@onCreate(uuid(7))`
  goes); the id is always the auth user's id.
- `email` and its `@@unique` are removed. `name` becomes `String?`.

A hand-written Prisma migration adds the sign-up trigger:

- A function `public.handle_new_auth_user()`, `SECURITY DEFINER`, with
  `search_path = ''`, that inserts `(id)` into `public.users` for `NEW.id`.
  Nothing else is copied from Auth.
- An `AFTER INSERT ON auth.users FOR EACH ROW` trigger calling it.
- `EXECUTE` on the function revoked from `public`, `anon` and `authenticated`,
  so it can only run as the trigger.
- If the insert fails, the auth user isn't created either (same transaction).
  That's intended: an auth user without a `users` row is a broken account.

The migration that changes `users.id` resets the table (deletes its rows and
everything that cascades from them) before adding the foreign key, since
existing ids don't match any auth user. It also deletes every
`query_search_builder` row (their profile links and query hits cascade), so no
shared search is left counting profiles that no longer exist (my call; the
engine keeps those counters itself and a cascade can't). Raw jobs stay.
Production has no data yet, so this is safe everywhere.

### 2. `userId` on `profile_skills`

- `ProfileSkill` gets `userId Uuid` with a relation to `User` (cascade) and an
  index on `userId`.
- The skill's `userId` must equal its profile's `userId`. Enforce it with a
  composite foreign key `(profileId, userId) → profiles(id, userId)`, which
  needs a unique constraint on `profiles(id, userId)`. If the contract can't
  express a composite relation, the policy's profile lookup (below) checks
  ownership too, and the builder notes the gap.
- The engine's profile repository sets `userId` when it writes skills.

### 3. RLS policies

All written in the contract with `@@rls` and `policy_*` blocks. Policies are
for the `authenticated` role only; `anon` gets none, so it sees nothing.

**Standard owner set** (the pattern later slices copy). `USING` and
`WITH CHECK` are `"userId" = auth.uid()` (or `id = auth.uid()` on `users`):
select, insert, update, delete.

| Table            | Select | Insert                                     | Update                                                             | Delete                  |
| ---------------- | ------ | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------- |
| `users`          | own    | none (the trigger creates it)              | own                                                                | none                    |
| `contacts`       | own    | own                                        | own                                                                | own                     |
| `profiles`       | own    | own, `state = 'draft'`, `publishedAt` null | from own draft, to own draft with `publishedAt` null               | own draft               |
| `profile_skills` | own    | own, and its profile is an own draft       | own, and its profile is an own draft (before and after the change) | own, profile is a draft |

- The `profile_skills` draft check is an `EXISTS` on `profiles` by
  `profileId`. It's the one place a policy looks at another table. The user's
  own RLS on `profiles` applies inside it, which is fine because it only needs
  the user's own profiles.
- Users can't delete their `users` row (no account deletion).

**Column privileges on `profiles` (agreed with the user).** Policies decide
which rows a user can write, not which columns. So `authenticated` loses the
table-wide `INSERT` and `UPDATE` on `profiles`. It gets them back only on an
explicit list of user-editable columns, in a hand-written migration. Left off
the list: `id`, `userId` on update, `state`, `publishedAt`, `createdAt`,
`updatedAt`, and the five engine-set resume fields (`resumeKey`,
`resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`). This
stops a user from pointing `resumeKey` at another user's file, which the engine,
reading Storage with its service key, would otherwise attach to their
applications. `position` stays editable on drafts, since a draft isn't linked to
any shared search. A column added later is blocked for users until it's added to
the list. That's the safe default, and slice 04 and 05 specs must say which of
their new columns join it. The `state` policies above stay as well. Other
user-owned tables keep table-wide grants; they have no engine-set columns.

**Engine-only tables:** `query_search_builder`,
`profile_query_search_builders`, `raw_jobs`, `raw_job_identities`,
`raw_job_query_hits` and `ats_posting_identities` get `@@rls` with no
policies. Users can't read or write them.

**The engine** connects as `postgres` and bypasses RLS, as today. Nothing in
it changes for this slice except the items in section 5.

### 4. Isolation harness (`apps/db-tests`)

Extends slice 01's helpers. All operations under test run through a signed-in
user's `supabase-js` client. The service role creates users, inserts fixture
rows (including published profiles, which users can't create), and reads back
state to confirm nothing changed.

**A table registry.** Each user-owned table registers one entry:

- the table name and its owner column (`userId`, or `id` for `users`);
- a function that creates a row owned by a given user (through the service
  role) and returns its id;
- a valid insert payload for a given user, or a marker that users can't
  insert into it (`users`);
- a harmless update patch;
- whether users can delete from it.

Adding a later table is one registry entry. For each entry, the shared tests
check, with users A and B:

- A reads B's row by id, and lists the table: B's row isn't returned.
- A updates B's row: no row comes back, and B's row is unchanged.
- A deletes B's row: B's row still exists.
- A inserts a row with B's `userId`: the insert fails.
- A updates their own row to B's `userId`: the update fails, and the row is
  still A's.
- A can do each allowed operation on their own row (so the policies aren't
  just denying everything).
- A signed-out (`anon`) client sees no rows.

**Engine-only tables:** a signed-in user lists each one and gets no rows, and
an insert fails. Fixture rows are created with the service role so "no rows"
means hidden, not empty.

**Published-profile freezing,** on a published profile (set up by the service
role) with skills:

- The owner can't update any field, can't delete it, and can't add, change or
  delete its skills.
- The owner can't insert a profile as `published` or with a `publishedAt`.
- The owner can't move their own draft to `published` or set `publishedAt`.
- On a draft, the owner can update, add and remove skills, and delete it.
- On a draft, the owner can't insert or update any resume field, `state`,
  `publishedAt` or the timestamps, but can change `position`.

**Accounts:**

- A new auth user has exactly one `users` row, with their id and a null
  `name`.
- Deleting the auth user (service role) removes their `users` row and
  everything they own.
- A user can't insert a second `users` row, and can't delete their own.

**Profile-skill ownership:** a skill whose `userId` differs from its profile's
owner is rejected, whether inserted by the user or by the service role.

### 5. Engine and seed changes

- The seed creates its users (`admin@`, `recruiter@`, `candidate@xjobs.local`)
  as auth users through the Supabase admin API with the service-role key, then
  sets their `name` on `public.users`. Re-running it is still safe.
- `POST /users` returns an error (`410 Gone` or `501`, builder's call) saying
  users are created through Auth. The other user endpoints drop `email` from
  their DTOs and responses.
- The profiles repository sets `userId` on `profile_skills`.
- `contract.json` / `contract.d.ts` are re-emitted and the web app's
  `database.types.ts` regenerated, as CI already checks.
- Engine unit tests and fakes are updated to match.

### 6. CI check for RLS

A test in `apps/db-tests`, run by the existing database job, that reads
`pg_class` / `pg_tables` for every table in `public` and fails, naming the
tables, if any has RLS disabled. It needs a direct read-only catalog query,
not `supabase-js`. The builder picks how (a direct Postgres connection from the
test, or a `psql` step in the CI job). It only reads the catalog, so it doesn't
break the "tests don't bypass RLS" rule.

## Left to the builder

- How the `@@rls` and `policy_*` blocks are written. Check the pack's docs
  (`skills/prisma-8/references/supabase.md` and `examples/supabase` in
  `prisma/orm`) against the installed version.
- Whether the trigger and the `users` reset go in one hand-written migration
  or two, and how they sit alongside the planned migration.
- The exact error status for `POST /users`.
- How the harness registry and helpers are laid out.
- Whether `contacts` and `profiles` keep their current indexes (they already
  index `userId`).

## Known gaps

- **Removing a user with published profiles.** Deleting an auth user cascades
  through their profiles and links but doesn't lower the shared searches'
  `associatedProfiles` or clear `isActive`, which the engine maintains. Until
  that's handled, the manual removal process is: unpublish the user's profiles
  through the engine first, then delete the auth user. Account removal isn't a
  Phase 1 feature.

## Done when

- A new auth user gets exactly one `public.users` row.
- Every table in `public` has RLS on, and CI fails if one doesn't.
- The harness proves A and B can't touch each other's rows on `users`,
  `contacts`, `profiles` and `profile_skills`, that users can't see engine-only
  tables, and that published profiles and their skills are frozen.
- `npx nx run-many -t lint test build typecheck` and the database job pass.

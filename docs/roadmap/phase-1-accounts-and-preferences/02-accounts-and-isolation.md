# 02: Accounts and isolation

## Goal

Tie the engine's `users` table to Supabase Auth, and set the RLS pattern and two-user test harness that every later table reuses. This slice is what makes "one user can never read or change another user's data" provable.

## In scope

- `public.users.id` becomes a foreign key to `auth.users.id` (cascade), through the Prisma Supabase extension pack. The email comes from Supabase Auth.
- A `public.users` row created automatically when an auth user is created, by a database trigger in a hand-written Prisma migration.
- A `userId` column on every user-owned table that lacks one (`profile_skills` today), so every policy is `"userId" = auth.uid()` with no joins.
- RLS on every table, written in the contract with `@@rls` and `policy_*` blocks:
  - User-owned tables (`users`, `contacts`, `profiles`, `profile_skills`): the standard owner policy set.
  - `profiles` and `profile_skills`: updates and deletes allowed on `draft` profiles only, and `state` and `publishedAt` can't be set by the user.
  - Engine-only shared tables (search queries, raw jobs and their identity and hit tables): RLS on, no user policies.
- A reusable isolation test harness: two signed-in users, A and B. A can't read, insert into, update or delete B's rows through `supabase-js`, the path the web app uses. Later slices add their tables to it in a few lines.
- A CI check that fails if any table in `public` has RLS disabled.

## Out of scope

- Teams, members or roles. Not planned.
- Account deletion.
- Removing the engine's CRUD endpoints. That happens once the UI slices cover them.
- The engine's internal API and token check (with publishing, see the phase README).

## Locked

- The tenant is the Supabase Auth user. No workspaces.
- Every user-owned record carries `userId` and is protected by RLS. Shared tables are hidden from users.
- Users can't delete their account.

## For the slice spec

- How existing local rows in `users` map to auth users (a reset is fine if the data is test data only).
- How the admin is identified (slice 03 needs it): a flag, a role claim, or simply the service key held by the admin script.
- Whether the user can set their own `state` field at all, or whether it is enforced by policy `WITH CHECK` alone or also by a trigger.
- Whether the user's `email` column stays on `public.users` (copied from Auth) or is read from Auth only.

## Done when

A new auth user gets exactly one `public.users` row, every table has RLS on, and the isolation harness proves A and B can't touch each other's rows, including published-profile freezing.

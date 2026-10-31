# 02: Workspaces and isolation

## Goal

The workspace model, plus the RLS pattern and two-user test harness that every later table reuses. This slice is what makes "one workspace can never read or change another's data" provable.

## In scope

- A `workspaces` table and the link from each auth user to their workspace.
- A workspace created automatically the first time a user signs in.
- One RLS helper (for example "the current user's workspace id") and a standard policy set that every workspace-scoped table copies.
- A reusable isolation test harness: two signed-in users, A and B. A can't read, insert into, update or delete from B's workspace through any path the web app has. Later slices add their tables to it.
- A check that fails CI if a workspace-scoped table is missing RLS. This is optional; the slice spec decides.

## Out of scope

- Teams, members or roles within a workspace.
- Workspace deletion.
- The engine's server-role access (Phase 2).

## Locked

- One person per workspace.
- Every domain record carries a workspace id and is protected by RLS. The only exception is the shared tech catalog (slice 04).
- Users can't delete their workspace.

## For the slice spec

- Whether the user-to-workspace link is a column on `workspaces` or a membership table. A membership table costs little and leaves room for teams later, but teams aren't planned.
- What the auto-create hooks into: a database trigger on new auth users, or a step on first sign-in.
- How the admin is identified (slice 03 needs it): a flag, a role claim, or simply the service key held by the admin script.
- Whether any workspace-level fields exist in Phase 1 (display name, created-at, status).

## Done when

A new user gets exactly one workspace, and the isolation harness proves A and B can't touch each other's rows. Later slices can add a table to the harness in a few lines.

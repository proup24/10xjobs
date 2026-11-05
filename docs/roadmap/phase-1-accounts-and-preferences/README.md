# Phase 1: Accounts and preferences

Date: 2026-10-29
Revised: 2026-11-02, to match the engine work already on `main` (see "Revision 2026-11-02" below).
Status: draft

## Intent

Phase 1 builds the hosted, invite-only app where each job seeker gets an isolated account and records the inputs every later phase acts on: what jobs they want, what they're eligible for, and their resume. Phase 2 qualifies jobs against these inputs and Phase 3 applies with them, so the data has to be precise enough that a rejection can always name the rule that caused it.

**Backend and schema come first.** The UI slices come last and will be shaped as the earlier slices land. The UI foundation (the Next.js scaffold and the component baseline in slice 01) can start now.

## How this folder works

Each slice below is a short brief: scope, the decisions already locked, and the questions its own spec must answer. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs. Locked decisions are not reopened in the slice spec unless something new comes up.

## Exit criteria

An invited user can sign up on the hosted app and can create and edit their profiles (preferences, eligibility and resume). One user can never read or change another user's data, and tests prove it.

## Slices, in order

| #   | Slice                                                  | Depends on |
| --- | ------------------------------------------------------ | ---------- |
| 01  | [Foundation](01-foundation.md)                         | none       |
| 02  | [Accounts and isolation](02-accounts-and-isolation.md) | 01         |
| 03  | [Invite-only sign-in](03-invite-only-sign-in.md)       | 02         |
| 04  | [Preferences schema](04-preferences-schema.md)         | 02         |
| 05  | [Eligibility schema](05-eligibility-schema.md)         | 02         |
| 06  | [Resume storage](06-resume-storage.md)                 | 02         |
| 07  | [Guided setup UI](07-guided-setup-ui.md)               | 03–06      |
| 08  | [Edit preferences UI](08-edit-preferences-ui.md)       | 07         |
| 09  | [Hosted launch](09-hosted-launch.md)                   | 01–08      |

Slices 04 and 05 share one spec, [Preferences and eligibility schema](../../superpowers/specs/2026-11-05-preferences-and-eligibility-design.md), because they use the same value lists and change the same contract. Slices 04, 05 and 06 are independent of each other. Slice 09's production setup can start early, but the launch check runs last.

## Decisions locked for the whole phase

**Who and how people get in**

- The tenant is the Supabase Auth user. There are no workspaces, teams or members.
- A user owns one or more job-search profiles. Each profile targets one position.
- Sign-up is invite-only and there's no waitlist. Only the admin (the maintainer) sends invites. Users can't invite others.
- Sign-in is by email only: a magic link or a one-time code. No Google or other OAuth.
- Users can't delete their account in Phase 1. Removal, if ever needed, is a manual admin task.

**Keys and cost**

- Anthropic and Apify run on the platform's own keys, held in server environment config and shared by all users. Users never enter keys. Phase 1 makes no use of them; they matter from Phase 2.
- Invite-only is Phase 1's cost control. Per-user usage limits belong to Phase 2, where the usage starts.

**Architecture**

- **Hosting:** the Next.js web app runs on Vercel. The database, Auth and Storage run on Supabase Cloud. The NestJS engine is hosted separately (its host is a Phase 2 decision).
- **Next.js is the web app's backend (BFF).** It reads and writes user data through `supabase-js` with the signed-in user's session. RLS enforces isolation on every one of those requests, and Storage has matching policies.
- **NestJS is an internal API, never public.** It runs collection and handles only actions with side effects that a plain row write can't do safely: publishing a profile and deleting a published profile (both update the shared search queries). Next.js calls it server to server and forwards the user's Supabase access token. The engine verifies the token against Supabase's JWKS and checks ownership. This replaces today's Basic auth.
- **The engine's CRUD endpoints are temporary.** The users, contacts, profiles and resume controllers in `apps/xjobs` were a quick way to see data. They are removed once the web app covers them.
- **The engine bypasses RLS** (it connects as a server role), so every engine query that touches user data filters by user id, and the engine has its own isolation tests.

**Data and schema**

- **One schema source:** the Prisma contract in `libs/database/src/contract/contract.prisma`, migrated with Prisma. This includes RLS: models use `@@rls` and `policy_*` blocks from Prisma's Supabase extension pack, and `public.users.id` is a foreign key to `auth.users.id`.
- SQL the contract can't express (the sign-up trigger, helper functions) goes in hand-written Prisma migrations. There is no `supabase/migrations` folder.
- The web app gets its database types from `supabase gen types`, run against the migrated database.
- **Ownership:** every table a user owns carries its own `userId` column, child tables included (`contacts`, `profiles`, `profile_skills` and later ones), so every policy is `"userId" = auth.uid()` with no joins.
- **Shared tables:** search queries (`query_search_builder`, `profile_query_search_builders`) and raw jobs (`raw_jobs` and its identity and hit tables) are shared across users on purpose, so the same search runs once. They have RLS on with no user policies, so users can't see them. The processor's value lists (techs, roles, seniorities, contract types, engagements, regions, countries, cities, languages and currencies) are shared tables that users can read, read-only and for approved rows only, so the web app's pickers can load them. Only an admin changes them.
- **Every table has RLS enabled**, which makes a "table without RLS" check in CI simple.
- **Published profiles are frozen.** RLS lets a user update and delete only their `draft` profiles, and never set `state` themselves. Only the engine publishes.

**Local development and CI**

- The local stack is the Supabase CLI (`supabase start`), with auth settings kept in `supabase/config.toml`. The self-hosted Supabase services in `docker-compose.yaml` are removed.
- CI starts the same stack, applies the Prisma migrations and runs the isolation tests on every PR.

**Preferences**

- The engine's existing `Profile` and `ProfileSkill` models are the base. Slices 04 and 05 describe changes to them, not a new schema. Query generation already depends on them.
- The set of preference types is fixed and defined by us. Users can't create custom rules, and custom rules aren't on the roadmap.
- Preferences are strict. A job that breaks any one of them is a miss, recorded in Phase 2 with the rule it broke. Nothing is shown or applied to unless it matches.
- So each preference is stored as a separate, named field or row, never as one free-text blob.

**Resume**

- One PDF per profile, replaced on upload, with no version history. Phase 3 applications use this file as it is.
- Building, rendering and tailoring resumes are out of Phase 1. Tailoring per job comes after the MVP.

## Open, to settle before slice 07

- **When publishing ships.** Publishing goes through the engine, so the publish button needs a deployed engine. Recommendation: keep the engine undeployed in Phase 1 and ship the button when the engine deploys in Phase 2. Until then, profiles stay editable drafts.
- **Preference fields.** Which of the original preference ideas get added to `Profile` (see slice 04) and the shape of eligibility (slice 05).

## Revision 2026-11-02

The first draft of this phase assumed a `workspaces` table, a Supabase migrations folder, and a web app that never calls the engine. Meanwhile the engine work on `main` removed workspaces in favour of user and profile ownership, built the schema in Prisma, and added a profile model with publishing. This revision adopts that work:

| First draft                              | Now                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| One workspace per user                   | The Supabase Auth user is the tenant, owning one or more profiles                    |
| Supabase CLI migrations                  | Prisma contract and migrations, RLS included; Supabase CLI runs the local stack only |
| Web app and engine never call each other | Next.js calls the engine's internal API for publishing                               |
| A new preferences schema                 | Changes to the existing `Profile` model                                              |
| One resume per workspace                 | One resume per profile                                                               |

## Raised during the brainstorm, not part of Phase 1

These came up while describing the full journey and belong to later phases. They're listed here so they aren't lost.

- **A feedback loop:** the user marks matches as fit or reject, and that feedback refines their preferences. It needs matches first, so Phase 2 at the earliest. Not on the roadmap yet.
- **More application channels:** applying through job sites and aggregators beyond LinkedIn, Ashby and Greenhouse. This would widen Phase 3's scope.
- **Phase 2 qualify rules that follow from Phase 1's model:**
  - A job is a miss only when it _requires_ a tech outside the user's stack. Whether a "nice to have" mention counts is for the Phase 2 spec. Assumption going in: it doesn't.
  - When a posting is vague about how it hires (employee or contractor), the Phase 2 spec decides whether that's a match or a miss.

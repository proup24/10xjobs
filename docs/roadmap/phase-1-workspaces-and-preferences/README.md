# Phase 1: Workspaces and preferences

Date: 2026-10-29
Status: draft

## Intent

Phase 1 builds the hosted, invite-only app where each job seeker gets an isolated workspace and records the inputs every later phase acts on: what jobs they want, what they're eligible for, and their resume. Phase 2 qualifies jobs against these inputs and Phase 3 applies with them, so the data has to be precise enough that a rejection can always name the rule that caused it.

**Backend and schema come first.** The UI slices come last and will be shaped as the earlier slices land.

## How this folder works

Each slice below is a short brief: scope, the decisions already locked, and the questions its own spec must answer. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs. Locked decisions are not reopened in the slice spec unless something new comes up.

## Exit criteria

An invited user can sign up on the hosted app, gets a workspace, and can set and edit their preferences, eligibility and resume. One workspace can never read or change another workspace's data, and tests prove it.

## Slices, in order

| #   | Slice                                                      | Depends on |
| --- | ---------------------------------------------------------- | ---------- |
| 01  | [Foundation](01-foundation.md)                             | none       |
| 02  | [Workspaces and isolation](02-workspaces-and-isolation.md) | 01         |
| 03  | [Invite-only sign-in](03-invite-only-sign-in.md)           | 02         |
| 04  | [Preferences schema](04-preferences-schema.md)             | 02         |
| 05  | [Eligibility schema](05-eligibility-schema.md)             | 02         |
| 06  | [Resume storage](06-resume-storage.md)                     | 02         |
| 07  | [Guided setup UI](07-guided-setup-ui.md)                   | 03–06      |
| 08  | [Edit preferences UI](08-edit-preferences-ui.md)           | 07         |
| 09  | [Hosted launch](09-hosted-launch.md)                       | 01–08      |

Slices 04, 05 and 06 are independent of each other. Slice 09's production setup can start early, but the launch check runs last.

## Decisions locked for the whole phase

**Who and how people get in**

- A workspace belongs to one person, a single job seeker. No teams.
- Sign-up is invite-only and there's no waitlist. Only the admin (the maintainer) sends invites. Users can't invite others.
- Sign-in is by email only: a magic link or a one-time code. No Google or other OAuth.
- Users can't delete their workspace in Phase 1. Removal, if ever needed, is a manual admin task.

**Keys and cost**

- Anthropic and Apify run on the platform's own keys, held in server environment config and shared by all workspaces. Users never enter keys. Phase 1 makes no use of them; they matter from Phase 2.
- Invite-only is Phase 1's cost control. Per-workspace usage limits belong to Phase 2, where the usage starts.

**Architecture**

- The Next.js web app is deployed on Vercel and talks to Supabase (Auth, Postgres, Storage) directly, as the signed-in user.
- Postgres row-level security (RLS) enforces workspace isolation for every request from the web app. Storage has matching policies.
- The NestJS engine isn't deployed in Phase 1. Choosing its host is a Phase 2 decision (likely a Hetzner server for always-on, low-cost running). It will connect with a server role that bypasses RLS, so isolation in the engine becomes a Phase 2 requirement with its own tests.
- The web app and engine never call each other directly. The database sits between them.

**Preferences**

- The set of preference types is fixed and defined by us. Users can't create custom rules, and custom rules aren't on the roadmap.
- Preferences are strict. A job that breaks any one of them is a miss, recorded in Phase 2 with the rule it broke. Nothing is shown or applied to unless it matches.
- So each preference is stored as a separate, named rule, never as one free-text blob.
- Storage shapes:
  - **Postgres enums** for short lists we own: work arrangement, hours, hired-as, seniority, travel.
  - **ISO codes** for languages and countries, and **IANA names** for timezones, checked against reference data instead of enums.
  - **A shared catalog table** for tech stack. Users can add new techs, and an addition is available to every workspace. This catalog is the deliberate exception to "every record is workspace-scoped".
  - **Free text** for titles, which Phase 2 matches semantically.
- Hours (full-time, part-time) and hired-as (employee, employee through an employer of record, B2B contractor, corp-to-corp) are two separate fields.

**Resume**

- One PDF per workspace, replaced on upload, with no version history. Phase 3 applications use this file as it is.
- Building, rendering and tailoring resumes are out of Phase 1. Tailoring per job comes after the MVP.

## Raised during the brainstorm, not part of Phase 1

These came up while describing the full journey and belong to later phases. They're listed here so they aren't lost.

- **A feedback loop:** the user marks matches as fit or reject, and that feedback refines their preferences. It needs matches first, so Phase 2 at the earliest. Not on the roadmap yet.
- **More application channels:** applying through job sites and aggregators beyond LinkedIn, Ashby and Greenhouse. This would widen Phase 3's scope.
- **Phase 2 qualify rules that follow from Phase 1's model:**
  - A job is a miss only when it _requires_ a tech outside the user's stack. Whether a "nice to have" mention counts is for the Phase 2 spec. Assumption going in: it doesn't.
  - When a posting is vague about how it hires (employee or contractor), the Phase 2 spec decides whether that's a match or a miss.

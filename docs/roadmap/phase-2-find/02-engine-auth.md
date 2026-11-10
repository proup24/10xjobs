# 02: Web app to engine auth

## Goal

The web app can call the hosted engine on the signed-in user's behalf, and the engine trusts only that: a valid Supabase access token for a user who owns the profile in the request.

## What already exists (on `main`)

- Basic auth on the engine (`apps/xjobs/src/common/guards/basic.guard.ts`).
- Temporary CRUD controllers: `users`, `contacts` and `profiles` under `apps/xjobs/src/modules/users/controllers/`, routed as `users/:userId/...`.
- `ProfilesService.publish` and `releaseAll`, which attach and release a profile's shared query search builders.

## In scope

- A guard that verifies the Supabase access token against the project's JWKS and puts the user id on the request. The user id comes from the token, never from the path.
- Ownership checks on every engine action that names a profile.
- A small server-only client in the web app that calls the engine with the user's access token, used by later slices.
- Removing the temporary CRUD endpoints the web app already covers, and Basic auth with them.
- Operator-only endpoints (the processor and matcher controllers used for testing) either kept behind a separate admin credential or not exposed on the hosted API; the spec decides.

## Out of scope

- The publish, edit and delete flows themselves (slices 03 and 04).

## Locked

- Supabase JWKS verification and an ownership check, as Phase 1 planned.
- The web app keeps reading and writing user data through `supabase-js` under RLS; the engine is only for side-effect actions.
- The web app still has no service-role key (`no-service-role.spec.ts`).

## For the slice spec

- The new route shape (for example `POST /profiles/:id/publish` with the user from the token).
- How the web app knows the engine's URL per environment (Vercel env), and what it does when the engine is unreachable.
- Engine isolation tests: user B's token can't act on user A's profile.

## Done when

A web app server action can call an engine endpoint as the signed-in user, the engine rejects missing, expired, wrong-project and other-user tokens, and the temporary CRUD endpoints and Basic auth are gone.

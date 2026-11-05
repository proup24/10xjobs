# 05: Eligibility schema

Spec: [Preferences and eligibility schema](../../superpowers/specs/2026-11-05-preferences-and-eligibility-design.md), shared with slice 04.

## Goal

Record where a user is legally able to work and where they live, so Phase 2 can reject jobs they can't take, with a clear reason. None of this exists in the engine yet; `Profile` has only `country` and `city`, which the spec replaces with residence on the user.

## In scope

- Eligibility for each user:
  - **Authorized to work in:** a list of `{ kind, place }`. `kind` is one of `work-permit`, `citizenship`, `residency` or `clearance`, and `place` is a country or region code.
  - **Country of residence:** an ISO country code. This is separate from authorization because many remote jobs require residence in a region whatever the work permit says.
  - **Needs visa sponsorship:** one yes/no, `acceptsSponsorship` ("I would take a job that sponsors my visa").
- RLS, and the table or columns added to the isolation harness.

## Out of scope

- How a job is judged against eligibility (Phase 2).
- Citizenship as its own field, unless the slice spec finds a need for it.

## Locked

- Eligibility is strict, like preferences.
- How someone can be hired (employee, employer of record, B2B, corp-to-corp) lives in the preferences as "hired as" (slice 04), not here.

Worked examples from the brainstorm, for a user authorized only in Morocco, living in Morocco, accepting B2B and corp-to-corp:

- "US work authorization required" → miss: not authorized to work in the US.
- "Remote, must reside in the EU" → miss: based in Morocco.
- "Remote, W-2 only" → miss: employee-only in the US, and the user accepts B2B or corp-to-corp.
- "Remote worldwide, contractors welcome" → match.

## For the slice spec

Settled in the spec:

- Eligibility belongs to the user, the same for every profile.
- Residence replaces `Profile.country` and `city`: it is `users.residenceCountry`.
- Sponsorship is a single boolean, `acceptsSponsorship`, not per country.
- A user can be authorized in a region: a work authorization is a `kind` plus a country or region code.

## Done when

A user can store and edit their eligibility with valid country codes, and the isolation harness covers it.

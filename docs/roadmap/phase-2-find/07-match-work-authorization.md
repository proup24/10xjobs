# 07: Match on work authorization

## Goal

A job is matched against where the user may legally work _(user)_. A role for "US citizens only", "must have the right to work in the UK", or "EU residents, no visa sponsorship" shouldn't reach a user who can't take it.

## What already exists (on `main`)

- Eligibility on the **user**, not the profile: `work_authorizations` rows (`kind`: `work-permit`, `citizenship`, `residency` or `clearance`, and a country or region `place`), plus `User.residenceCountry` and `User.acceptsSponsorship`.
- The v2 extraction's `workAuthorization` fact: `requirements: [{ kind, place }]` and `sponsorship: yes | no | unstated`.
- The matcher's place hierarchy (worldwide ⊃ region ⊃ country ⊃ city), `MATCHER_VERSION` and `db:rematch`.
- Neither query generation nor the matcher reads eligibility today.

## In scope

- **Work authorization rule:** each job requirement is checked against the user's authorizations and residence, using the place hierarchy. A requirement the user meets: `pass`. One they don't meet: `fail`, unless the job offers sponsorship and the user accepts it. Nothing stated: `unknown`.
- The matcher loads the user's eligibility with the profile, filtered by user id like every engine query.
- **Eligibility edits re-match** _(follows from the rule)_: eligibility is per user, so changing it in preferences re-decides recent jobs for all of that user's published profiles, like a profile edit in slice 04. Each decision records which eligibility it read, alongside the profile version.
- A `MATCHER_VERSION` bump and a rematch of recent jobs.
- Unit tests per row of the rule's table, and golden cases.

## Out of scope

- Inferring authorization from a place mention alone. "Remote, US" is a location fact for the location rule, not an authorization requirement, unless the posting says so.
- Security clearance beyond comparing the stated kind and place.

## Locked

- A fact the job doesn't state never rejects on its own.
- Pure rule functions and readable, stored reasons, as in slice 06.

## For the slice spec

- How `residency` compares to `work-permit` and `citizenship` (does citizenship satisfy every requirement for that place?).
- What `acceptsSponsorship` means when the job is silent on sponsorship.
- How this sits with slice 04's apply path (the same engine call, or its own) and whether slice 07 should land after 04 for that reason.

## Done when

Recent jobs are re-decided with the authorization rule, a "US citizens only" job rejects a user with no US authorization with a readable reason, a job offering sponsorship stays qualified for a user who accepts it, and changing eligibility in preferences re-decides recent jobs for all of the user's published profiles.

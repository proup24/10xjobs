# 09: Rejected view

## Goal

The user can see recent jobs that were rejected for a profile, and why, so a wrong rejection can be caught and fixed. It's for checking the matcher, not the main path.

## What already exists

- Every decision stores all its checks with `pass`, `fail` or `unknown`, the job's value, the profile's value and a reason (the matching spec).
- The matches view (slice 08).

## In scope

- A **Rejected** tab beside Qualified on the matches page, in the same side-by-side layout _(my call)_.
- Each rejected job leads with the check or checks that failed, for example "job seniority `junior` is not in your seniorities [`senior`]", with the passing and unknown checks below.
- The same recent window and profile switcher as the qualified tab.

## Out of scope

- Overriding a rejection, or marking it wrong from the app. Fixes go through preferences (slice 04) or a matcher rule change.
- The full rejection history beyond the recent window.

## Locked

- Every rejection shows a readable reason; there is no rejection without one.

## For the slice spec

- Whether rejected jobs can be filtered by failing rule (position, seniority, location, stack, languages, work authorization), which makes over-eager rules easy to spot.
- Whether the tab shows a count, and whether rejected jobs carry the "new" marker. Default going in: no.

## Done when

On the hosted app, a user can open the Rejected tab for a profile and, for each recent rejected job, see the job and which rule rejected it and why.

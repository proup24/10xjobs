# 05: Rejected view

## Goal

The user can see recent jobs that were rejected for a profile, and why, so a wrong rejection can be caught and fixed. It's for checking the matcher, not the main path.

## What already exists

- Every decision stores all its checks with `pass`, `fail` or `unknown`, the job's value, the profile's value and a reason (the matching spec).
- The matches view (slice 04).

## In scope

- A **Rejected** tab beside Qualified on the matches page, in the same side-by-side layout _(my call)_.
- Each rejected job leads with the check or checks that failed, for example "job seniority `junior` is not in your seniorities [`senior`]", with the passing and unknown checks below.
- The same recent window and profile switcher as the qualified tab.

## From Phase 3 slice 02 (listing facts)

Slice 02 ([spec](../../superpowers/specs/2026-11-12-listing-facts-design.md)) changes what this tab shows. It doesn't build the tab _(user)_.

- **A third outcome, `review`,** with its own Review tab, built in 02. A job that would be rejected only on `unsure` facts goes there, never to Rejected.
- **The user's decisions on review items.** A review item the user moved to Rejected is stored in 02 as a per-user overlay on the match. Until this tab exists, it simply leaves the Review list. This tab must also list those jobs, marked as the user's own decision with the rule and fact that sent them to review.
- **New rules in the reasons:** contract type, salary, accepted currencies, required languages, posting language and work authorization, next to position, seniority, location and stack.
- **Facts come from `job_facts`, not the extraction.** Each check shows its source (description or LinkedIn), plus any conflict, through `match_details`.
- **Mismatch reports** (02) are available from any job, so "Marking it wrong from the app" under Out of scope now means overriding the outcome, not reporting a fact.

## Out of scope

- Overriding a rejection, or marking it wrong from the app. Fixes go through preferences (slice 07) or a matcher rule change.
- The full rejection history beyond the recent window.

## Locked

- Every rejection shows a readable reason; there is no rejection without one.

## For the slice spec

- Whether rejected jobs can be filtered by failing rule (position, seniority, location, stack, languages, work authorization), which makes over-eager rules easy to spot.
- Whether the tab shows a count, and whether rejected jobs carry the "new" marker. Default going in: no.

## Done when

On the hosted app, a user can open the Rejected tab for a profile and, for each recent rejected job, see the job and which rule rejected it and why.

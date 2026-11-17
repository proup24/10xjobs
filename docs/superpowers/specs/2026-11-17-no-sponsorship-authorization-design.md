# "No sponsorship" means authorization where the job is

Date: 2026-11-17
Status: draft

## Problem

Job `01a1e587-e858-7498-847e-e1800e21b7f9` (The Planet Group, "Senior Full Stack Engineer", LinkedIn location "United States") says "Full Time (no sponsorship available)" and "100% remote but must work EST". The processor read it correctly: `workAuthorization = { requirements: [], sponsorship: "no" }`, sure. The matcher passed it with "job states no work authorization requirement", because `checkWorkAuthorization` (`apps/xjobs/src/modules/matcher/rules/work-authorization.ts`) passes whenever `requirements` is empty and reads `sponsorship` only to rescue an unmet requirement. A Moroccan resident who holds no US work right got the match.

"No sponsorship" means you must already have the right to work where the job is. On dev, 58 of 1,183 jobs say no sponsorship, 10 of them with no explicit requirement.

This job's US place is not in its facts either. `combineOpenings` (`apps/xjobs/src/modules/facts/rules/combine.ts`) copies the LinkedIn place onto an opening only when the description gave that opening no places and no time zones. Here the description gave it "must work EST", so the opening has `places: []`.

## Goal

A job that says it offers no sponsorship, and states no authorization requirement of its own, requires a work permit for the place it is in. Users who hold no authorization covering that place are rejected, with a reason that says the requirement came from "no sponsorship".

## Non-goals

- Changing the processor or its prompt. It already extracts `sponsorship: "no"` correctly.
- Changing jobs that state requirements of their own. Their requirements stand as they are, and nothing is derived.
- Treating residence as a work permit. Living somewhere doesn't give the right to work there, and the eligibility form describes authorizations as "where you can work without needing a visa from an employer".
- Handling users with blank eligibility. Publishing a profile already requires residence and the sponsorship answer (`ELIGIBILITY_REQUIRED` in `profiles.service.ts`), so such users are never matched _(user, after checking the code)_.

## Anti-goals

- Rejecting someone because of a place the posting only mentions in passing (an office, a headquarters).
- A derived rejection that can't be told apart from an explicit one in the stored reason.

## Approaches

- **Derive the requirement in the facts layer (chosen by the user).** `combine.ts` already holds the description openings and the LinkedIn place, which is exactly what the derivation needs. The job's facts then show the requirement to the matcher, the job detail page and `db:analyze`. The cost is that an inference is stored in facts, so a change to it needs a `FACTS_VERSION` bump.
- **Carry the LinkedIn place in facts and derive in the matcher (rejected).** This keeps facts literal, but it needs a schema change and a matcher change, and it adds a loose LinkedIn place field that the location rule could start reading. That would go against the residence spec's decision that a LinkedIn place alone never makes a check strict.
- **Matcher reads `normalized_jobs` places directly (dropped).** It goes around facts, which are the matcher's only input, and resolves places a second time.

## Design

### When a requirement is derived (facts)

In `combine.ts`, when the description's `workAuthorization` value has `sponsorship: "no"` and `requirements: []`:

1. **Description places first.** Take the places of the described openings (before the LinkedIn fill) whose `placeStrictness` is not `mention`. _(Claude's call: a mentioned place is the anti-goal above.)_
2. **Else the LinkedIn place**, when the listing has one and the description's places gave no code (none, only mentions, or a city with no country). _(User's call: option B in the conversation. "No sponsorship" together with a listing place is a much stronger signal than a LinkedIn place alone, which is why this doesn't contradict the residence spec.)_
3. Turn each place into a code: a country gives its code, a region its code, a city its `countryCode`. Drop duplicates.
4. If any place is `worldwide`, or no codes are left, derive nothing.
5. Otherwise, each code becomes `{ kind: "work-permit", place: code, derived: "no-sponsorship" }`.

The derived requirements keep the fact's `quote` (the "no sponsorship" words), `confidence` and `source`. The facts-layer requirement schema gains the optional `derived` marker; the processor's shared `workAuthorizationSchema` is unchanged. `FACTS_VERSION` goes from 4 to 5, and the sweep rebuilds facts on its own.

### How the matcher judges them

- Derived requirements are **alternatives**: the group is met when the user meets **any one** of them. Explicit requirements keep today's rule that every one must be met. A job never has both, because step 1 above requires `requirements: []`. _(User's call: authorization in any one place is enough.)_
- A met group passes. A group judged `maybe` (a place the index can't resolve) gives `unknown`, as today. An unmet group fails. Sponsorship can't rescue it, since the job said no.
- Reasons:
  - Fail: `you don't meet work-permit US (the job offers no sponsorship)`. With several places: `you don't meet work-permit in any of US, CA (the job offers no sponsorship)`.
  - Pass: `you meet work-permit US (the job offers no sponsorship)`.
  - `sponsorship: "no"` with nothing derived (worldwide or no place): `the job offers no sponsorship but names no place to check`, instead of "job states no work authorization requirement".
- Unsure confidence carries over as today (`restsOn('workAuthorization')`).
- `MATCHER_VERSION` goes from 8 to 9. Rematch through the sweep, or `db:rematch -- --all`.

### Example

This job: no description places → LinkedIn `US` → `work-permit US (derived)`. The owner's account (residence MA, one authorization that doesn't cover the US) fails with "you don't meet work-permit US (the job offers no sponsorship)".

## Tests

- `combine` unit tests: a description place, the LinkedIn fallback (this job's shape: a time zone and no places), a city mapped to its country, `mention` places skipped, worldwide, explicit requirements present (nothing derived), `sponsorship` `yes` or `unstated` (nothing derived), duplicate codes.
- `work-authorization` unit tests: any-of pass, all-unmet fail, `maybe` gives unknown, the three new reasons, an explicit requirement unchanged.
- The processor golden set is unaffected, so no eval run is needed.

## Left to the builder

- The exact name and type of the `derived` marker, and whether `combine` derives in its own small function (recommended).
- Whether the web's match detail shows the marker. It renders the reason text, which already says where the requirement came from, so nothing more is required.
- Documenting the rule in `apps/xjobs/src/modules/matcher/README.md` under work authorization.

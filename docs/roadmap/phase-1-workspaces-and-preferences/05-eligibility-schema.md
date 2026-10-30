# 05: Eligibility schema

## Goal

Record where a user is legally able to work and where they live, so Phase 2 can reject jobs they can't take, with a clear reason.

## In scope

- One eligibility record per workspace:
  - **Authorized to work in:** a list of ISO country codes.
  - **Country of residence:** an ISO country code. This is separate from authorization because many remote jobs require residence in a region whatever the work permit says.
  - **Needs visa sponsorship:** per country.
- RLS, and the table added to the isolation harness.

## Out of scope

- How a job is judged against eligibility (Phase 2).
- Citizenship as its own field, unless the slice spec finds a need for it.

## Locked

- Eligibility is strict, like preferences.
- How someone can be hired (employee, employer of record, B2B, corp-to-corp) lives in the preferences schema as "hired as" (slice 04), not here.

Worked examples from the brainstorm, for a user authorized only in Morocco, living in Morocco, accepting B2B and corp-to-corp:

- "US work authorization required" → miss: not authorized to work in the US.
- "Remote, must reside in the EU" → miss: based in Morocco.
- "Remote, W-2 only" → miss: employee-only in the US, and the user accepts B2B or corp-to-corp.
- "Remote worldwide, contractors welcome" → match.

## For the slice spec

- Whether sponsorship is per country or a single yes/no. The assumption from the brainstorm (not yet confirmed) is that a user not looking to relocate answers no everywhere.
- Whether eligibility merges into the preferences tables or stays its own table.
- Whether a user can be authorized in a region (for example, EU citizens across the EU) without listing every country.

## Done when

A workspace can store and edit its eligibility with valid country codes, and the isolation harness covers it.

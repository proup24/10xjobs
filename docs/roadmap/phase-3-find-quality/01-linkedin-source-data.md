# 01: LinkedIn source data

## Problem

The LinkedIn job board actor (`cheap_scraper/linkedin-job-scraper`) doesn't return facts that matching depends on. The processor then has to guess them from the description, or leave them unstated.

- **No workplace type.** There is no remote, hybrid or onsite field; the actor's `workType` is deprecated and always empty. Of the first 60 processed jobs, 45 came back with arrangement `unstated`, so the location check returns `unknown` and filters almost nothing.
  - The work-type filter of the search that found a job (`raw_item_sightings.queryId` → builder `type`) is stored, but never reaches the processor.
  - That filter also leaks: 18 of the 60 were returned by searches with two or three different work types.
- **No employer apply link.** For external jobs, `applyUrl` is the LinkedIn page. That blocks linking a job to its Ashby or Greenhouse posting, and applying directly later.
- **Company identity is thrown away.** `companyId` isn't mapped, and `enrichCompanyData` is off, so there's no website, size, industry or organisation type. Duplicates such as "ALTEN" and "ALTEN MAROC" go unmerged, and staffing agencies can't be told apart from employers.
- **Description is plain text only**, and sometimes ends with page residue ("Show more Show less").

We'll probably replace the actor rather than work around it.

## Open questions

- Which source returns the workplace type, the external apply URL and company identity? Options: another Apify actor, a per-job page fetch after the search, or a mix. Only Apify is allowed for LinkedIn data.
- What does each candidate cost per 1,000 jobs and per run, compared with today ($0.70 per 1,000 plus a start fee per run)? How reliable is it, and how fresh is its data?
- Can it take LinkedIn search URLs with `f_WT`, `f_E`, `geoId` and `f_TPR`, so the query builders and the shared-searches planner carry over?
- Tasks 4–9 of the shared-searches plan (`docs/superpowers/plans/2026-11-09-shared-linkedin-searches.md`) are built around the current actor, and its planner merges work types. Pause them until the source is chosen, or build them source-agnostic?
- Until then, should the search's work type be passed to the processor as an "unsure" hint, like `experienceLevel`?
- Company data: fetch it per job, or once per company and cache it?
- Already-collected raw items: re-map them with `db:renormalize`, or leave them as they are?

## Suggested path

1. List the required fields (workplace type, external apply URL, company id and website) and the nice-to-have ones (applicant count, HTML description, company size and industry).
2. Run a small, budget-capped live comparison of 2–3 candidates on the same searches, as `linkedin-plan-test` does. Compare field coverage, cost and reliability.
3. Pick a source. Add its mapper next to the existing ones, and store the new fields on `normalized_jobs`.
4. Pass workplace type to the processor as evidence, the way experience level and contract type are passed today.
5. Settle the order with the shared-searches plan before its planner tasks are built.

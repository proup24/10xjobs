# 02: Listing facts

**Done**, as PRs 53–60 (2026-11-12). Spec: [2026-11-12-listing-facts-design.md](../../superpowers/specs/2026-11-12-listing-facts-design.md). Plan: [2026-11-12-listing-facts.md](../../superpowers/plans/2026-11-12-listing-facts.md). The spec describes the slice as built. This brief is kept as the starting point it was.

Still to do by hand on `10xjobs-dev`:

1. `db:reprocess -- --all-in-scope` (about 60 jobs) before about 2026-12-09, when they leave the 30-day match window.
   - It needs OpenRouter credit.
   - Reprocessed jobs queue behind the pending cheap_scraper backlog (3,988 jobs, about $33). Settle the backlog first, or put the 60 at the front of the queue.
2. After the match sweep:
   - run `db:match-shares -- --days 7`;
   - check that no Casablanca job shows Worldwide.
3. When Apify has credit: `db:places -- --days 7`, then alias or approve cities with `db:vocab`.
4. Check the Review tab at 360px. It wasn't checked in a browser.

## Problem

After slice 01, LinkedIn gives structured facts: workplace type, a parsed location, salary bounds and employment type. Nothing turns them into facts the matcher can use, and the processor still guesses from LinkedIn's text.

- **The model builds places from LinkedIn's location text, and nothing checks the result.** That's where "Worldwide" on Moroccan jobs comes from.
  - 10 of the first 60 processed jobs are tagged Worldwide.
  - 9 of those are openings the prompt built from the listing (`decidedBy: "ingest"`), from texts such as "Casablanca, Casablanca-Settat, Morocco".
  - The 10th was the model itself: it quoted "Lieu : Casablanca – Centre-ville" and still produced Worldwide. That one belongs to processor quality.
- **Arrangement is missing where LinkedIn has it.** It's `unstated` on 45 of 60 jobs, and the location check returns `unknown` on 47. LinkedIn's `workplaceType` covered 27 of 30 jobs in the live run.
- **No rule decides between the two sources.** LinkedIn's values (on `normalized_jobs`) and the processor's (on `job_extractions`) are kept apart by design, and they may disagree.
- **Slice 01 stores less location than this needs.** It keeps the country and region code, not the parsed city, state or `geoId`.
- **Closed jobs aren't detected.** A search only returns listed jobs, so a closed job just stops appearing. `expireAt` passing is the only signal.

## Decisions so far

- **The processor reads only the description.** The listing metadata block and the "listing as a last resort" opening rule leave the prompt. The processor never sees LinkedIn's values _(user)_.
- **Resolution is deterministic.** It runs after the processor and is separate from it _(user)_.
- **Default rule:** when the description states a fact, it wins. When it doesn't, the listing value fills the gap. Every disagreement is stored as a conflict: both values, the quote, and which one won.

## In scope

- **A listing opening built by code, with no model:**
  - arrangement from `workplaceType`;
  - places from `location.parsed`: the country code, a region code mapped to our regions, or a city only when it matches our city list (otherwise the country).
  - Anything that doesn't map falls back to the country, or to no place, never to a guess.
- **Salary** from `salary.min`, `max`, `currency` and `payPeriod` when set (1 of 30 jobs in the live run), keeping `providedByEmployer`.
- **Employment type** mapped onto our contract-type codes.
- **More stored location detail:** the parsed city, state and `geoId`, plus `providedByEmployer`. This is a mapper change and a `NORMALIZER_VERSION` bump.
- **Expiry:** a job whose `expireAt` has passed counts as closed.
- **Resolved facts and conflicts are stored,** and the rebuilt matcher reads the resolved facts, not the raw extraction.

## Not in scope

- **Seniority gap-filling.** LinkedIn's "Mid-Senior level" spans two of our levels, and posters tag loosely. A seniority disagreement is recorded as a conflict, but the listing value never fills a gap.
- **Processor quality** (03): `needsReview` on 59 of 60, no tech stack on 29 of 60, wrong places from the model.
- **Search precision** (04): `jobFunctions` (unreliable: a backend intern was tagged `ACCT, FIN`), the `functionIds` filter, OR keywords. 52 of 60 jobs failed the position check.
- **Flagging staffing agencies.** The company table makes it possible, but it's a matching decision.
- **Old cheap_scraper jobs.** They have no structured fields, so they get no listing facts.

## Open questions

- Where do resolved facts and conflicts live: columns on the job, a new table, or next to the extraction? What does the rebuilt matcher expect?
- Which LinkedIn regions and region texts occur ("European Union", "EMEA", "Latin America") and how do they map to our region codes? Which city spellings need aliases?
- Remote jobs: is LinkedIn's location where the employer hires (a `limit`), or only a label? It changes what the match does with it.
- When the description gives one place and LinkedIn another, is that a conflict, or two openings?
- Removing listing data from the prompt changes the prompt hash, so every in-scope job is reprocessed. Does this slice go into the processor rebuild, or does the rebuild start from it?

## Suggested path

1. Wait for a week of harvestapi jobs to be collected and processed after slice 01.
2. Extend the mapper with the parsed city, state, `geoId` and `providedByEmployer`. Write the region and city mapping tables from the values that actually occurred.
3. Build the listing facts (opening, salary, contract type, expiry) as pure functions, tested against the 01 fixtures.
4. Remove the listing metadata from the prompt, as part of the processor rebuild or alongside it.
5. Add the resolution step and conflict storage. The matcher reads resolved facts.
6. After a week, read the conflicts per field. Change the default rule only where LinkedIn proves more reliable than the description.

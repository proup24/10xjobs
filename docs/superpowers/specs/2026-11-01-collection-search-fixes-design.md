# Collection search fixes (LinkedIn job board first, Google boards)

Date: 2026-11-01. Follows the collection review of the same day (query and segment generation checked against run history and platform docs).

## Intent

Collection exists to find the right jobs. The review found searches that probably search the wrong place, searches paid for twice, recall lost to page caps, and no way to measure any of it. These fixes make collection measurable first, then correct, then broader: every change to what we search is judged by numbers LinkedIn and Google report, never by guess.

## Goals

1. **Place-bound LinkedIn searches name an unambiguous place.** `Casablanca, MA` (ISO code; also Massachusetts) becomes `Casablanca, Morocco`. Regions and cities get LinkedIn `geoId`s once a human has verified each one on linkedin.com.
2. **One search per distinct LinkedIn URL per run.** Builders whose searches are identical (the MENA builders search `EMEA`, like the EMEA builders) share one segment and one start URL; results are attributed to every builder that produced the URL.
3. **Every LinkedIn run records what LinkedIn says matched.** The actor's `SEARCH_TOTALS` key-value record is stored with the segment run, untouched, and mapped to a per-query `total` once its shape is known.
4. **Google board discovery stops losing results to page caps.** Every Ashby and Greenhouse run hit `maxPagesPerQuery: 3` (about 30 results, as Google serves 10 per page since September 2025).
5. **LinkedIn jobs carry their company profile** (industry, website, size), as exact facts for later use (agency engagement, company domains), with volatile company fields kept out of the content hash.
6. **Keyword and seniority filters are tuned by measurement.** Title and technology variants and an `f_E` widening are compared on totals and a precision sample before any is adopted.
7. **`db:regenerate` runs.** A recipe change (goal 1) needs it, and it crashes today: scripts run under `tsx`, which emits no decorator metadata, so Nest cannot inject services.

## Non-goals

- Eligibility filtering of "Worldwide remote" jobs (qualify's job).
- Merging all segments into one actor run (cost is negligible today).
- LinkedIn posts collection.
- Probing LinkedIn from our own machines to find geoIds or totals: only the actor and a human in a browser touch LinkedIn.

## Anti-goals

- Narrowing a search without measuring it (missing the right jobs).
- Widening a search that floods Process with irrelevant jobs (precision over volume).
- A collection change that silently moves every stored item to a new version (content-hash churn).

## Decisions

- **Measurement first.** A probe script runs one small actor run with given URLs and prints `SEARCH_TOTALS`, a sample item's keys and the cost. A human runs it (it needs the Apify token and spends cents). Its output pins the totals shape, the company-profile fields and the keyword decisions. _Builder's call: the script's flags._
- **Country names** come from `Intl.DisplayNames('en', { type: 'region' })` of the ISO code. Deterministic, no table to maintain. LinkedIn only; Google keeps its `countryCode`.
- **geoIds** are filled by the human into `linkedin_geo.ts` (regions) and a city table, read from the URL after picking the place in LinkedIn's search box. Free text stays the fallback.
- **Segment place for the LinkedIn job board** is the search place (`geoId`, else `location` text), not the profile's region enum, so identical searches meet in one segment.
- **Recipe version 5** for the location change; `db:regenerate` moves profiles to it.
- **Google pages:** `maxPagesPerQuery` 3 → 10 for Ashby and Greenhouse (about 100 results per query, what `num=100` used to give; about $1.80 per 1,000 pages). _My call; adjust after seeing truncation in the run history._
- **Keyword variants adopted only if** the variant's total is higher and at least 16 of a 20-job sample of the extra results are relevant to the profile. _My call for the threshold._
- **`f_E` widening** (senior to `3,4`) is judged by the same rule.

## Constraints

- No test calls Apify, LinkedIn or Google; the probe is a human-run script.
- Batch file format stays version 1.
- Existing raw versions must not churn: new payload fields from the company profile are either stable or volatile-listed before the switch is turned on.

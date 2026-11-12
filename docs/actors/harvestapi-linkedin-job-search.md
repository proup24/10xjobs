# harvestapi/linkedin-job-search

The LinkedIn job board actor. Spec: `docs/superpowers/specs/2026-11-11-linkedin-source-harvestapi-design.md`. Input mapping: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts`. Fixtures: `apps/xjobs/src/modules/ingest/utils/fixtures/linkedin-job-harvest.json` (six scrubbed items from a live France run).

## Input

Structured fields, not search URLs: `jobTitles` (boolean operators supported), `geoIds` or `locations`, `workplaceType` (`remote`, `hybrid`, `office`), `experienceLevel` (`internship`, `entry`, `associate`, `mid-senior`, `director`, `executive`), `employmentType`, `postedLimit` (`1h`, `24h`, `week`, `month`), `sortBy` (`relevance`, `date`), `maxItems` (per title and location). We always send `geoIds`: the parity check showed text places are unreliable (see below).

## Output

Each item carries `query`, the search that found it, and `_meta.pagination.totalElements`, LinkedIn's total match count. Job id is `id`. Fields: `title`, `linkedinUrl`, `jobState`, `postedDate`, `descriptionText`/`descriptionHtml`, `location` (with `parsed`: `countryCode`, `regionCode`, `city`, ...), `employmentType`, `workplaceType`, `workRemoteAllowed`, `applyMethod`, `applicants`, `hiringTeam`, `company`, `salary`, `experienceLevel`, `applicantTrackingSystem`, `expireAt`.

## Prices

$0.001 per job plus a $0.001 start fee per search title (pay per event). A job returned by two searches in one run is charged twice.

## Field coverage (France run, 2026-11-11, 30 items)

| Field                                           | Coverage                              |
| ----------------------------------------------- | ------------------------------------- |
| `workplaceType`                                 | 27 of 30                              |
| Employer apply URL                              | 21 of 30 (the other 9 are Easy Apply) |
| `company.website`, company id, size, industries | 30 of 30                              |
| `experienceLevel`                               | 9 of 30                               |
| `employmentType`                                | 29 of 30                              |
| Structured salary                               | 1 of 30                               |
| `descriptionHtml`                               | 30 of 30                              |
| `location.parsed`                               | 30 of 30                              |

## Parity check (2026-11-11)

Script: `pnpm --filter @xjobs/xjobs apify:linkedin-parity`. The same three builders' searches, posted in the last 24 hours, on cheap_scraper and harvestapi, capped at $0.03 per run (the first run cost $0.04 in all). Harvest used text places, before the geoId decision.

| Search                                      | cheap_scraper returned | harvestapi returned (total) | shared ids |
| ------------------------------------------- | ---------------------- | --------------------------- | ---------- |
| `next js` / Morocco / f_E 3,4 / f_WT 1      | 2                      | 0                           | 0          |
| `nestjs` / European Economic Area / 4,5 / 2 | 36                     | 0 (place rejected)          | 0          |
| `next js` / United States / 3,4 / 2         | 37                     | 29 (total 92, capped)       | 0          |

The brief's formal criterion failed: `onlyCheap` was 100% of cheap_scraper's jobs on every search. The follow-up investigation explains why:

- **US remote, uncapped:** cheap_scraper 36 jobs, harvestapi 66 (`totalElements` 65), 0 shared ids. "Next.js" appears in 6 of 36 cheap jobs and 11 of 66 harvest jobs. All were posted within 24 hours. The two actors see disjoint slices of LinkedIn, and harvestapi found more jobs and more relevant ones.
- **Morocco on-site:** cheap_scraper 2, harvestapi 0.
- **Region text:** "European Economic Area", "EMEA", "Middle East" and "Latin America" were rejected ("not recognized by LinkedIn"): the run succeeds with 0 items. "North Africa" was silently read as South Africa.
- **geoIds:** 91000002, 91000000 and 91000007 worked. They were then verified for free on LinkedIn's public jobs page, in both directions (spec, "Places").

## Decision: GO

Go, by the user's decision, not by the brief's criterion. harvestapi found more and more relevant jobs on the one comparable search, and the empty runs come from text places, which the collector no longer sends. The user chose to switch, with geoIds first.

Caveat: Morocco on-site returned 0 on harvestapi against 2 on cheap_scraper, and that search was run with text. Recheck it with geoId `102787409` after the switch.

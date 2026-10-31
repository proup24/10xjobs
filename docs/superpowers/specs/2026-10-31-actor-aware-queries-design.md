# Actor-aware search queries

Date: 2026-10-31. Follows the collector review of the same day and builds on `2026-10-31-search-segments-design.md`.

## Intent

Builders today emit one plain phrase, for example `senior backend engineer nestjs`, plus a few params. Every platform searches with it the same way. That loses results:

- Google wraps the phrase in quotes and matches it exactly, so Ashby and Greenhouse return almost nothing.
- LinkedIn posts search with no place.
- LinkedIn regions are sent as free text such as `EMEA`.
- Hourly Google windows are shorter than Google's indexing delay.

Each channel builder should instead produce the query its platform understands best. A filter goes in a param when the platform supports one, and in the query text only when it does not.

## Goals

- Seniority is removed from the shared keyword phrase. Each channel decides where it goes:
  - **LinkedIn job board:** the `f_E` param only.
  - **LinkedIn posts, Greenhouse and Ashby:** a word in the query, since none of them has a seniority filter.
- Titles use boolean OR over the position's alternative titles (`POSITION_TITLES`), so one query covers what would take three.
- Place:
  - **LinkedIn job board:** a `geoId` for regions, the location text for cities and countries.
  - **LinkedIn posts:** the city, or the word "remote", in the query.
  - **Google:** the city, or `"remote"`, in the query, plus a run-level `countryCode` for on-site and hybrid segments.
- The Google channels (Greenhouse and Ashby) run daily with a window of at least 72 hours, and flag a query as truncated from Google's `hasNextPage`.
- The recipe version moves to 4, and every published profile is regenerated so live builders use the new queries.

## Non-goals

- A board registry, i.e. polling the Greenhouse and Ashby board APIs. That gets its own spec next.
- `f_JT` from engagement, and combining technologies with OR.
- Any change to segment grouping or to ingest.

## Anti-goals

- Losing LinkedIn boolean operators to lowercasing. `OR` and `AND` must stay uppercase.
- Going over a platform's limits:
  - **LinkedIn posts:** 500 characters and 5 operators per query.
  - **Google:** 32 words per query.
- Builders from the old recipe staying active after the regeneration.

## Decisions

Decided by the user:

- Remove seniority from keyword generation.
- Each platform controls its params, and puts seniority in the query when it has no param for it.
- Cover the review items in one plan.

Builder's calls:

1. **Where queries are built.** Channel builders (`modules/queries/channels`) build the final, platform-ready `keyword` and `params`. Collectors only add actor plumbing: Google's `site:` and suffix, the time window and limits. This keeps "Apify takes only the builder's params" true.
2. **Shared pieces** (`builders/channel.builder.ts`):
   - `titleClause(position)` gives `("backend engineer" OR "backend developer" OR "backend software engineer")`, or a single quoted title when there is only one.
   - `technologyTerms(combination)` gives terms written plainly, such as `nestjs`, or quoted when they contain a space or a symbol, such as `"spring boot"` or `"c#"`.
   - `seniorityWord(experience)` reuses `SENIORITY_WORDS`, but `mid` and `unstated` add nothing, since "mid-level" is rarely written.
   - `keywordPhrase` keeps its name for logs, without seniority.
3. **Lowercasing.** `toRecipe` lowercases only the terms. Builders lowercase their own terms, and operators stay uppercase. `toRecipe` stops calling `.toLowerCase()` and only trims.
4. **LinkedIn job board.**
   - keyword: `<titleClause> AND <technology>`;
   - params: `experienceLevel` (`f_E`, unchanged), `workType` (`f_WT`, unchanged), and either `location` for cities and countries or `geoId` for remote regions.
   - The collector writes `geoId` into the URL, plus `location` when it is set. `GLOBAL` becomes geoId `92000000` (Worldwide).
5. **The `Region → geoId` table** lives in `channels/linkedin_geo.ts`. Every value must be checked on linkedin.com before it is committed: pick the location in the jobs search and read `geoId` from the URL. A region with no reliable LinkedIn geo is mapped to its country list, or left out with a comment. A test pins the table.
6. **LinkedIn posts.**
   - keyword: `hiring <titleClause> <technology> [<seniority>] [<city> | remote]`. That uses 2 OR operators and no explicit AND, well under the limit.
   - A test asserts the 500-character and 5-operator limits for the longest position.
7. **Greenhouse and Ashby (Google).**
   - keyword: `<titleClause> <technology> [<seniority>] ["<city>" | "remote"]`;
   - params: `countryCode` (the lowercased ISO country) for on-site and hybrid, and `remote` (unchanged).
   - The collector builds `site:<site> <keyword> <suffix>` and drops today's extra quoting of the keyword. When every member of a segment has the same `countryCode`, it sends it as the run's `countryCode`.
   - A test asserts the 32-word limit.
8. **Google window and schedule.**
   - The Greenhouse and Ashby job configs use the schedule `0 6 * * *` UTC and the window `{ initialHours: 72, overlapMinutes: 0, maximumHours: 168, minimumHours: 72 }`.
   - `WindowConfig` gains an optional `minimumHours`: `since` is never later than `until − minimumHours`.
   - `quickDateRange` uses days (`d<ceil(hours / 24)>`) from 24 hours up.
9. **Google truncation.** A member is truncated when its last returned page has `hasNextPage: true` and it returned `maxPagesPerQuery` pages.
10. **Regeneration.**
    - A script `src/database/seeds/regenerate-query-search.ts` (pnpm `db:regenerate`) runs `detach` and then `generate` for every published profile.
    - Old-version builders fall to 0 associated profiles and go inactive by themselves. The script then soft-deletes inactive builders whose `version` is older than the current one.
    - Running it twice changes nothing.

## Testing

- **Each channel builder:** keyword and params for remote, on-site and hybrid; unstated, junior, senior and mid seniority; one-title and three-title positions; technologies that need quotes; the platform limits.
- **Recipe:** operators survive `toRecipe`, and version 4 changes the hashes.
- **Collectors:**
  - LinkedIn URL: `geoId` and `location`.
  - Google: the run `countryCode` (shared by all members, or omitted when they differ), day `quickDateRange`, `hasNextPage` truncation, and no double quoting.
- **Window:** `minimumHours`.
- **Regeneration:** with the fakes, run it twice and only current-version builders stay active.

## Left to the builder

The exact quoting rule for technology terms beyond those listed, and file names.

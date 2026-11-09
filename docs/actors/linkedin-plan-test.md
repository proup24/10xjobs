# LinkedIn plan live test

Results of `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test`, run by the maintainer before the shared-search planner is built. Spec: `docs/superpowers/specs/2026-11-09-shared-linkedin-searches-design.md`, section "The test". Run on: <date>. Total reserved budget: <usd>.

## How to run

1. Find a geoId for each place the test needs (at least EMEA; also LATAM, Europe, United States, Canada, Morocco and your own places): on linkedin.com/jobs pick the location in the search and read `geoId` from the URL.
2. Dry run (no Apify calls): `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test -- --dry-run --geo 'EMEA=<id>' ...`
3. Main run: `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test -- --geo 'EMEA=<id>' ... > private/linkedin-plan-test.json`
4. Ceiling run (its own $1 budget): `... -- --sections ceiling --geo 'EMEA=<id>' > private/linkedin-plan-ceiling.json`

## Gate verdict

| Question                                          | Result |
| ------------------------------------------------- | ------ |
| OR form that works (`LINKEDIN_OR_FORMAT`)         |        |
| Max keyword length (`LINKEDIN_KEYWORD_MAX_CHARS`) |        |
| EMEA has a pinned geoId and passes containment    |        |
| Row ceiling (`LINKEDIN_ROW_CEILING`)              |        |
| 1024 MB works (`memoryMbytes`)                    |        |
| `publishedAt` usable                              |        |
| Go / no-go                                        |        |

## places

## or

## length

## containment

## ceiling

## publishedAt

## Approved pairs (checked <date>)

| Child | Parent | Verdict | Missing ids | Notes |
| ----- | ------ | ------- | ----------- | ----- |
|       |        |         |             |       |

## Pinned geoIds

| Place | geoId | Verified how |
| ----- | ----- | ------------ |
|       |       |              |

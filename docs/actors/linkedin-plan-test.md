# LinkedIn plan live test

Results of `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test`, run by the maintainer before the shared-search planner is built. Spec: `docs/superpowers/specs/2026-11-09-shared-linkedin-searches-design.md`, section "The test". Run on: <date>. Total reserved budget: <usd> (of the $2 campaign cap). Real spend (sum of `costUsd`): <usd>.

## Spend: about $2, not $1

The spec asks for about $1 in total. The procedure below is two invocations, each capped at $1 of reserved run caps: the main run, and the ceiling run, whose 1,200-row cap alone reserves about $0.97. So the test can reserve up to **about $2** in all. Reserved caps assume the Free plan's $0.70 per 1,000 jobs, so the real spend is lower; it is the sum of `costUsd` in the output.

A spend file (`apps/xjobs/tmp/linkedin-plan-test-spend.json`, gitignored) records every paid run, and the script refuses a run that would push all invocations together past `CAMPAIGN_BUDGET_USD = 2`. Rerunning needs that file deleted on purpose. **The maintainer approves the $2 before the first paid run**, or lowers `CAMPAIGN_BUDGET_USD` and skips the ceiling run.

## Memory

Every run uses 1024 MB, the ceiling run included. The plan said "the cheapest memory" for the ceiling; 1024 MB is kept on purpose: it is what production would run at, so the heaviest run also answers the memory question, and a smaller machine would save at most $0.0025 in start fee.

## How to run

1. Find a geoId for each place the test needs (at least EMEA; also Latin America, Europe, United States, Canada, Morocco and your own places): on linkedin.com/jobs pick the location in the search and read `geoId` from the URL. Give a region by its label or code: `--geo 'LATAM=<id>'` and `--geo 'Latin America=<id>'` are the same.
2. Dry run (no Apify calls): `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test -- --dry-run --geo 'EMEA=<id>' ...`. Read the `plan` block: the ordered pairs, how many fit, and any warnings. If the pairs you need don't fit, narrow them with `--pairs 'Casablanca>Morocco,Europe>EMEA,...'`.
3. Main run: `pnpm --filter @xjobs/xjobs apify:linkedin-plan-test -- --geo 'EMEA=<id>' ... > private/linkedin-plan-test.json`
4. Ceiling run: `... -- --sections ceiling --geo 'EMEA=<id>' > private/linkedin-plan-ceiling.json`

## Reading containment

Each pair prints a `containment` block, then a `containment-rerun` block when its parent came back full and was rerun at 200 rows (the rerun's verdict is the one that counts).

- `pass`: no child job is missing. Only this approves a pair.
- `row-limit-cut`: the parent was full, and every missing job is dated on or before its oldest day (or undated). Inconclusive.
- `window-edge`: the only missing jobs are from the window's first day, so they may have aged out between the two runs. Inconclusive.
- `fail`: a job is missing that the parent should have held.
- `invalid`: a run failed or the child came back empty.

## Gate verdict

| Question                                          | Result |
| ------------------------------------------------- | ------ |
| OR form that works (`LINKEDIN_OR_FORMAT`)         |        |
| Max keyword length (`LINKEDIN_KEYWORD_MAX_CHARS`) |        |
| EMEA has a pinned geoId and passes containment    |        |
| Row ceiling (`LINKEDIN_ROW_CEILING`)              |        |
| 1024 MB works (`memoryMbytes`)                    |        |
| Real spend (sum of `costUsd`)                     |        |
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

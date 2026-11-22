# Indeed actor sample (Phase 5, slice 01)

Date: 2026-11-22
Status: design, awaiting approval (builder check done)
Brief: [docs/roadmap/phase-5-indeed/01-actor-sample.md](../../roadmap/phase-5-indeed/01-actor-sample.md)

## Intent

Before any Indeed channel code is written, pick the Apify actor the `INDEED` channel will be built on, or stop the phase. A small paid sample runs the shortlisted actors on the same searches and measures what each returns and what it costs _(user: "sample the actors first")_.

The sample also maps every profile preference to what LinkedIn and each Indeed actor can search on. Preferences are global: one profile drives both channels, and the process and results must stay consistent across them _(user)_.

## Goals

- A go/no-go verdict on the phase, with numbers that anyone can reproduce.
- The pick, with its reasons, in `docs/actors/`.
- A written preference → search-filter map for LinkedIn and each shortlisted actor. It records which Indeed filters can be trusted, as measured by the sample.
- Raw results saved locally, so later work can reuse them without paying again: the processor and matcher check (below) and slice 04's mapper.

## Non-goals

- The `INDEED` channel, its schedules and its markets (slice 03). The ingest mapper (slice 04).
- Designing Indeed's search groups, places or cadence. The map says what each filter can do. Slice 03 decides how to use it.
- Running the processor or matcher on the sample. That check comes later, see "Later check".

## Anti-goals

- A verdict based on numbers that can't be rerun, or on spend that wasn't capped in code.
- Recording an Indeed filter as safe when it drops relevant jobs. That is "missing the right jobs", the project's anti-goal.
- Overspending: no Apify call happens unless the reserved total fits the cap.

## Decided

### Consistency principle _(user: "just like you proposed")_

The matcher is the single judge on every channel, with the same rules and the same reasons. A search filter only narrows what we pay to collect. An Indeed search uses a filter only when the sample shows it is at least as trustworthy as the LinkedIn filter it stands in for. Otherwise the search stays broader and the matcher decides. A gap in an actor's filters can cost money, but it must never hide a right job.

### How "qualified" is judged _(user picked A; B later)_

- **Now (A): a relevance rule.** A job is _relevant_ when its title matches `ENGINEERING_TITLE` (`scripts/linkedin-region-test/logic.ts`, English and French) **and** its title or description mentions at least one spelling of the LinkedIn group it's compared with (see "Baseline"). The same rule runs on harvestapi's dev items from the same window, so both sides are measured the same way. The rule is reused, not rewritten, and it is the cost-per-qualified-job proxy for the gate.
- **Later (B): the real processor and matcher.** They run over the saved raw items, to confirm or reverse the pick _(user)_. That is its own small piece of work once slice 04's mapper exists, and it is out of scope here.

### Shortlist (from the store and READMEs, 2026-11-22; my proposal, user agreed)

| Actor                             | Price per 1,000 / start (free tier) | `jk` field | Employer apply link                       | Posted time            | Remote filter                   | Level filter      |
| --------------------------------- | ----------------------------------- | ---------- | ----------------------------------------- | ---------------------- | ------------------------------- | ----------------- |
| `valig/indeed-jobs-scraper`       | $0.10 / $0.001                      | `key`      | `jobUrl`, resolved                        | `datePublished`, exact | none (location "Remote")        | none              |
| `kaix/indeed-scraper`             | $0.05 / ~$0                         | `id`       | `apply.url`, resolved, plus `isEasyApply` | `age`, relative        | `remote`, plus `isRemote` field | none              |
| `memo23/apify-indeed-cheerio-ppr` | $1.49 / $0.007                      | job key    | `resolveExternalApplyUrl` option          | to check               | `remoteWork`                    | `experienceLevel` |
| `curious_coder/indeed-scraper`    | $0.10 / $0.0001                     | `id`       | to check                                  | to check               | none                            | none              |

- **Dropped: `misceres/indeed-scraper`.** It costs $6 per 1,000 and returns only Indeed's `applystart` redirect.
- **Also dropped: borderline ($5 per 1,000), cheap_scraper and the rest,** which are less used or more expensive for the same fields.
- **Inputs.** All four cover the US, Brazil, Poland, the UK, Canada and Morocco. All are pay per event, so run memory doesn't change cost, and none needs login cookies.
- **Start fees are negligible.** The highest is memo23 at $0.007 per run, which answers the brief's start-fee question on paper. The sample records the real cost per run.
- **The redirect question.** Two actors already return the resolved employer link, so "should we resolve Indeed's redirect ourselves?" probably goes away. If the sample says otherwise, it's reopened in slice 04.

### Searches

All searches cover the last 24 hours (Indeed's newest window) and are sorted by date where the actor allows it.

**Keywords _(user: one run of each)_:**

- _Plain_: the profile's first role word plus its top spelling by importance, e.g. `developer typescript`.
- _Real_: the merged keyword of the live LinkedIn search group that each place is compared with (see "Baseline"), exactly as `mergedLinkedinKeyword` builds it for the whole group, i.e. `(roles OR …) AND (spellings OR …)`. That is the keyword LinkedIn actually runs and pays for. If the group packs into several keywords, the sample uses the first one and prints the rest _(my call)_. This tests whether Indeed, through each actor, honours boolean syntax.

**Places (from the brief):**

- US remote and UK remote: the actor's remote filter where it has one, else location `Remote`.
- Morocco on-site: the `ma` site, location `Morocco`, no arrangement filter, since no actor has an on-site filter.

That gives 6 core searches per actor (3 places × 2 keywords).

**Filter probes,** which test the filters the map needs to judge:

- **Remote filter vs location "Remote".** US, plain keyword, on kaix and memo23: the same search with the remote filter and with location `Remote` only. It counts the relevant jobs each one finds that the other misses.
- **Level filter.** US remote, plain keyword, on memo23: with and without `experienceLevel=SENIOR_LEVEL`. It counts the relevant jobs the filter drops.
- **When a filter is trusted _(user: "2% lost is fine")_.**
  - A _lost_ job is one the probe pair's relevant jobs show only in the unfiltered search. Each lost job is read by hand, and those the matcher would reject anyway (not really remote, not senior) are struck off.
  - The filter is **trusted** when the jobs left are at most 2% of the unfiltered search's relevant jobs. Otherwise it's **not trusted (measured)**, and slice 03 searches without it.
  - The report lists the lost jobs with title, company and link for that reading. With about 50 relevant jobs, 2% means at most one lost job.
- **Boolean.** The plain vs real keyword pairs of the core searches already measure this. "Honoured" means the real keyword's results all match the relevance rule at least as often as the plain keyword's, rather than returning unrelated jobs or nothing.

### Rows, spend and the cap

- **Rows.** 100 rows per run on valig, kaix and `curious_coder`, and 50 on memo23 because of its price, probes included (my call). memo23 runs with `includeCompanyDetails` off, since we don't use company details.
- **Reservation.** Each run reserves its start fee plus `rows ×` the sum of every per-row event its input turns on (for memo23 with `resolveExternalApplyUrl` on, the result event and `additional-data`), rounded up to the next cent. Under-reserving would let Apify's limit cut a run short, and that would look like low volume. Each run is started with that amount as Apify's `maxTotalChargeUsd`, so Apify itself can't charge more.
- **The cap.** The total reserved must fit a hard cap of **$1.50** _(user)_. Otherwise the paid path refuses to start. The plan reserves about $1.43, about $1.12 of it on memo23's 8 runs. Real spend should be lower, because each reservation rounds up and counts every event.
- **Prices are read live.** The script reads each actor's current price per event from Apify's public actor endpoint before reserving. If a price has changed so that the plan no longer fits, it refuses.
- **Stopping.** A run that fails or times out stops the sample and prints the spend so far. Raw items from finished runs stay saved.

### The script: `db:indeed-sample`

- **Shape.** It follows `db:split-check`: `src/scripts/indeed-sample.ts` is the entry point, and `src/scripts/indeed-sample/logic.ts` holds the pure logic, covered by unit tests:
  - the search plan
  - one input builder per actor
  - the reservation and cap check
  - field coverage
  - the relevance rule
  - overlap and the report numbers
- **Command.** `pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <id> [--dry-run]`. It's maintainer-only, and it gets a line in `CLAUDE.md` like `db:split-check`'s.
- **`--dry-run`** reads the profile, prints every actor × search pair with its exact actor input, reserved spend, total and cap, and exits before `APIFY_TOKEN` is read.
- **Reading the database.** It reads the profile and its LinkedIn job-board builders, and harvestapi's items for the baseline, from the database `DATABASE_URL` names. A remote database needs `XJOBS_ALLOW_REMOTE_DB=1`, as other scripts do. It writes nothing to the database.
- **The paid path** is the only code that builds an Apify client. Runs go one at a time, in plan order.
- **Raw items** go to `tmp/indeed-sample/<ISO timestamp>/<actor>/<search id>.json` (`tmp` is gitignored), with a `plan.json` and the final `report.json` beside them. Nothing from the sample is committed except the written report.
- **Rerun from saved items.** `--from <folder>` re-computes the report from saved raw items without any Apify call, so the report logic can change without paying again _(my call)_.

### The report: numbers per actor

- **Volume and cost.** For each search: rows, distinct `jk`s and real cost (the run's final usage from Apify). Overall: cost per 1,000 distinct jobs and cost per relevant job.
- **Overlap.** Between actors, by `jk`.
  - **Proven overlap with dev's existing jobs**: the actor's resolved apply link run through `job-key.ts` to an `ats:` or `url:` key, found among dev's jobs. That's early evidence for the keep-or-drop test.
  - **Likely overlap**: same company and title among dev's LinkedIn jobs, counted but never merged.
- **Field coverage:** the share of rows with
  - a `jk`
  - a full description: at least 500 characters of text after stripping HTML, and not cut off with an ellipsis
  - an employer apply link that isn't an `indeed.com` URL
  - an Easily apply flag
  - a posted time, exact or relative
  - company, place, a remote flag, salary and job type
- **Filter probes:** relevant jobs only with the filter, only without it, and in both.
- **Boolean:** the relevant share for the plain keyword vs the real keyword, per place.
- **Baseline:** harvestapi's cost per relevant job on dev, per sampled place (below).

### Baseline _(my calls, from dev's live searches on 2026-11-22)_

- **Which LinkedIn groups.** Each sampled place is compared with the live harvestapi group for the same place and arrangement, as a whole group, all its profiles included:
  - US remote ↔ `united states` remote
  - Morocco on-site ↔ `morocco` on-site
  - UK remote ↔ `europe` remote. LinkedIn has no UK search, since `uk` maps to `europe`.
- **Whole-group cost.** The cost counted is each group run's full `costMicroUsd`, and "relevant" uses the union of the group's spellings, which is what that money paid for. The Indeed side of the same place uses the same spellings, so both sides are measured on the same terms. Prorating a shared run across profiles would just invent a split.
- **Which day.** The latest full Morocco day in the last 7 where every harvestapi run in those groups has a final cost (`costFinalAt` set) and none was skipped for budget. The script finds that day before any spend, prints it in `--dry-run`, and refuses the paid path if there's none. This avoids days like 2026-11-20, when collection stopped early.
- **Which places gate.** US remote and Morocco on-site decide the gate. UK remote is reported, but Europe is a broader search than the UK, so its ratio isn't fair to either side.

### The gate _(user)_

An actor passes when:

- at least 95% of its rows have a `jk` and a full description, and
- its cost per relevant job is at most **2× harvestapi's** _(my call for "not clearly worse")_. This is judged on US remote and Morocco on-site combined: the sum of cost over the sum of relevant jobs, on each side.

A missing apply link is never a fail. If no actor passes, the phase stops at this slice and the roadmap says why.

Among actors that pass, the pick weighs these, in order:

1. Relevant jobs found, since missing the right jobs is the anti-goal.
2. Trustworthy filters, which cut spend later.
3. Apply link coverage, which gives proven duplicates for slice 05.
4. Cost.

### Deliverables

1. `db:indeed-sample`, with unit tests for the logic, in one PR.
2. One maintainer run: `--dry-run` first, then paid.
3. `docs/actors/indeed-actor-sample.md`, with:
   - the comparison tables
   - the pick and its reasons, or the stop
   - **the preference → search map**: one row per preference (keyword, places, arrangement, seniority, time window, contract type and engagement, salary, languages, time zone, notice period). Its columns are LinkedIn and each actor, with each filter marked _trusted_, _not trusted (measured)_, _not offered_ or _matcher only_.
4. Roadmap updates: slice 01's status and findings, and the open questions it answered in slices 03 and 04.

## Approaches considered

- **A. A paid one-off script in the engine, like `db:split-check` (picked, _user_).** It can be rerun, it's capped in code, the inputs are kept in the repo, and its raw items can be reused. It's the most code of the three.
- **B. Runs started by hand in the Apify console, plus a read-only comparison script.** Less code, but about 30 runs by hand is error-prone. The inputs wouldn't be recorded and a rerun would mean doing it all again.
- **C. Building the `INDEED` channel straight away and trialling actors through it.** It skips the gate the phase puts first, so it was dropped.

## Left to the builder

- How each actor's output fields map into the report's common shape, read from the actual items. The "to check" cells above get filled from the dry-run's first real items.
- Whether the plain keyword's role word should be the profile's first or most common one, as long as the choice is printed.
- How to wait for and re-read a run's final cost. Reuse what `ApifyProvider` and the trial channels do.
- How harvestapi's same-window items are selected, as long as it's by batch actor, by the sample profile's builders and by time.

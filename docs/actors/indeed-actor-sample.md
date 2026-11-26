# Indeed actor sample (Phase 5, slice 01)

Spec: `docs/superpowers/specs/2026-11-22-indeed-actor-sample-design.md`. Plan: `docs/superpowers/plans/2026-11-22-indeed-actor-sample.md`. Script: `db:indeed-sample` (`apps/xjobs/src/scripts/indeed-sample/`).

**Status: decided (2026-11-25).** Phase 5 goes ahead. **valig** is the `INDEED` channel's actor, and **curious_coder** is the candidate for a later trial channel _(user)_. The verdict rests on the weekday re-run (2026-11-24, below). The Sunday run (2026-11-22) follows it, kept as the first measurement.

## Weekday re-run (2026-11-24)

- **Date:** 2026-11-24, from 10:25 UTC (a Tuesday). The 24-hour window covers Monday 10:25 to Tuesday 10:25 UTC: the whole US Monday workday.
- **Folder:** `tmp/indeed-sample/2026-11-24T10:25:49.874Z/` (local, gitignored).
- **Runs:** the same 27, all `SUCCEEDED`. kaix's core remote searches now use location `Remote`, with its filter as the probe.
- **Spend:** **$0.1745** final. memo23 is $0.142 of it.
- **Baseline:** harvestapi on dev, Morocco day **2026-11-23** (a Monday, after #99). US remote: 524 relevant jobs for $0.779. Morocco on-site: 4 for $0.021. Gate cost per relevant job: **$0.00152**.

### Volume

| Place           | valig | curious_coder | kaix | memo23 | harvestapi (2026-11-23) |
| --------------- | ----- | ------------- | ---- | ------ | ----------------------- |
| US remote       | 81    | 73            | 9    | 9      | 524                     |
| UK remote       | 1     | 1             | 1    | 2      | 652 (Europe remote)     |
| Morocco on-site | 4     | 4             | 5    | 5      | 4                       |

Relevant jobs per place, per actor. On a weekday, US remote is about 6× the Sunday run. valig and curious_coder both returned **100 rows on the US real keyword, the run's row cap**, so Indeed had more than this. How much more is unmeasured. UK remote and Morocco on-site stay thin.

### Per actor

| Actor         | Distinct jobs | Cost    | Per 1,000 distinct | Gate cost per relevant (× harvestapi) | Gate     |
| ------------- | ------------- | ------- | ------------------ | ------------------------------------- | -------- |
| valig         | 115           | $0.0164 | $0.14              | $0.00017 (0.11×)                      | pass     |
| curious_coder | 112           | $0.0129 | $0.12              | $0.00016 (0.11×)                      | pass     |
| kaix          | 35            | $0.0030 | $0.09              | $0.00015 (0.10×)                      | pass     |
| memo23        | 38            | $0.1422 | $3.74              | $0.00418 (**2.8×**)                   | **fail** |

Rows per run:

| Search                 | valig | kaix | memo23 | curious_coder |
| ---------------------- | ----- | ---- | ------ | ------------- |
| us-remote-plain        | 12    | 13   | 13     | 12            |
| us-remote-real         | 100   | 5    | 0      | 100           |
| uk-remote-plain        | 0     | 0    | 1      | 0             |
| uk-remote-real         | 3     | 3    | 5      | 3             |
| ma-onsite-plain        | 0     | 0    | 0      | 0             |
| ma-onsite-real         | 7     | 9    | 9      | 8             |
| us-locremote-plain     |       |      | 18     |               |
| us-remote-plain-senior |       |      | 16     |               |
| us-filterremote-plain  |       | 5    |        |               |

- **valig and curious_coder overlap heavily again:** 90 shared jobs out of 115 and 112. On Sunday they returned the same 16. With 100 rows capped, each picked a slightly different 100 from the same results.
- **kaix with location `Remote` still found only 5 rows on the US real keyword**, against 100 for valig and curious_coder. Its 9 relevant US jobs come mostly from the plain keyword.
- **memo23 again returned 0 rows on the US real keyword.** It repeats, so memo23 can't run the merged boolean keyword on the US site.
- **valig costs about $0.0009 per run start plus about $0.09 per 1,000 rows.** A 100-row US search cost $0.0099.

### Field coverage (share of rows)

| Field               | valig | kaix | memo23 | curious_coder |
| ------------------- | ----- | ---- | ------ | ------------- |
| `jk`                | 100%  | 100% | 100%   | 100%          |
| Full description    | 100%  | 100% | 100%   | 100%          |
| Employer apply link | 89%   | 71%  | 95%    | 93%           |
| Easily apply flag   | 0%    | 100% | 81%    | 0%            |
| Posted time         | 100%  | 100% | 100%   | 100%          |
| Company             | 95%   | 100% | 100%   | 100%          |
| Place               | 100%  | 100% | 100%   | 100%          |
| Remote flag         | 100%  | 100% | 98%    | 100%          |
| Salary              | 68%   | 66%  | 77%    | 67%           |
| Job type            | 75%   | 80%  | 60%    | 73%           |

### Boolean keyword

The merged keyword keeps working, but on a weekday it lets more wrong jobs through: 78% of valig's US real-keyword rows are relevant (73% on curious_coder), down from 93% on Sunday. UK and Morocco real-keyword rows are 33% to 57% relevant, on 3 to 9 rows. The matcher has to reject the rest with a reason, as for LinkedIn.

### Filter probes

| Probe                                     | Lost share | Verdict                                  |
| ----------------------------------------- | ---------- | ---------------------------------------- |
| kaix `remote` filter vs location `Remote` | 100% (9)   | **not trusted (measured)**, again        |
| memo23 `remoteWork` vs location `Remote`  | 58% (7)    | **not trusted (measured)** (was 0% on 3) |
| memo23 `experienceLevel=SENIOR_LEVEL`     | 11% (1)    | matcher only                             |

Location `Remote` stays the only remote search to trust on Indeed.

### Dev overlap

Every actor found **1 proven and 1 likely** duplicate of a dev job. The other relevant jobs are not on dev: Indeed brings jobs LinkedIn, Greenhouse and Ashby didn't.

### The verdict

**Go** _(user, 2026-11-25)_. The gate passes for valig, curious_coder and kaix. On a weekday, Indeed's US remote supply is large enough to matter: 81 relevant jobs in 24 hours, almost all new to dev, at about a tenth of harvestapi's cost per relevant job. UK remote and Morocco on-site stay small, and slice 06 judges them per market.

**The pick: valig** _(user)_.

1. **valig** found the most relevant US remote jobs (81), at a cost per relevant job within 5% of curious_coder's. It reads `jk`, full description, employer link (89%), posted time, place and the remote flag. It has no Easily apply flag. The edge over curious_coder is thin: both stopped at the row cap, so the 81 against 73 partly reflects which 100 rows each took.
2. **curious_coder** is the later trial channel. It returns mostly the same jobs at about the same cost, so a trial would mainly test reliability and field coverage.
3. **kaix** isn't picked. Its remote filter is broken, and even with location `Remote` it found 5 rows where the others found 100.
4. **memo23** fails the gate on cost, and returns nothing for the merged keyword on the US site.

## Sunday run (2026-11-22)

- **Date:** 2026-11-22, 19:15 to 19:25 UTC (a Sunday). The 24-hour window covers Saturday 19:15 to Sunday 19:15 UTC.
- **Folder:** `tmp/indeed-sample/2026-11-22T19:15:34.315Z/` (local, gitignored). Replay it with `--from` and no Apify call.
- **Profile:** the owner's (`9074f82b-…`). Plain keyword: `engineer claude code`.
- **Runs:** 27 of 27 `SUCCEEDED`. None hit its charge limit.
- **Spend:** **$0.0884** final, out of $1.43 reserved. memo23 is $0.0769 of it.
- **Baseline:** harvestapi on dev, Morocco day **2026-11-19** (a Thursday).
- **Reader fix after the run:** valig and curious_coder carry Indeed's remote attribute (`DSQF7`) in `attributes`. The readers missed it, so the remote flag read 0%. They now read it, and the replay changed nothing else. memo23's reader was built from its dataset schema, not a real item. It read every field right on the real items.

### Caveats

- **The baseline isn't the same window.** It is 2026-11-19, three days before the Indeed window and a weekday. It also predates the 2026-11-20 search-cost change (#99).
- **Morocco on-site barely counts.** Its baseline has 1 relevant job for $0.025, so US remote decides the gate almost alone.
- **Weekend window.** Indeed's 24-hour window on a Sunday is likely its quietest. The volume gap to LinkedIn (below) may shrink on a weekday. That is what the re-run measures.
- **The relevance counts are thin.** US remote: 13 relevant jobs at most per actor, 1 on UK remote and 1 to 3 on Morocco on-site. The 2% filter bar assumes about 50 relevant jobs per probe. The probes here had 3 to 5.

### Volume

Indeed returned far fewer jobs than asked. Every run asked for 100 rows (50 on memo23), and runs returned 0 to 14. Each actor's log shows Indeed itself ran out of results (kaix: `no-next-page`; memo23: `no_serp_results`, "the pages loaded fine"). So this is Indeed's supply for these keywords in 24 hours, not a pagination bug.

| Place           | Best Indeed actor, relevant (24 h, Sat–Sun) | harvestapi, relevant (2026-11-19, Thu) |
| --------------- | ------------------------------------------- | -------------------------------------- |
| US remote       | 13                                          | 536                                    |
| UK remote       | 1                                           | 460 (Europe remote, a broader search)  |
| Morocco on-site | 3                                           | 1                                      |

US remote compares like with like on keywords: every US remote keyword packs to the same merged keyword, which the sample ran. Even allowing for the weekend, that's about 40× fewer. Morocco is the one place where Indeed found more.

**Dev overlap is 0 for every actor,** proven and likely. None of the 16 to 21 jobs is on dev. Some employers are (Upstart has a different role). The Greenhouse short links (`grnh.se/…`) aren't resolved to board URLs, so proven overlap can be understated. But no job matched on title and company either. Few as they are, these are jobs LinkedIn didn't bring.

### Per actor

#### Volume and cost

| Actor         | Distinct jobs | Cost    | Per 1,000 distinct | Relevant US / UK / MA | Gate cost per relevant (× harvestapi) |
| ------------- | ------------- | ------- | ------------------ | --------------------- | ------------------------------------- |
| valig         | 16            | $0.0070 | $0.44              | 13 / 1 / 1            | $0.00037 (0.18×)                      |
| kaix          | 21            | $0.0021 | $0.10              | 0 / 1 / 3             | $0.00041 (0.20×)                      |
| memo23        | 8             | $0.0769 | $9.61              | 4 / 1 / 3             | $0.00539 (**2.7×**)                   |
| curious_coder | 16            | $0.0024 | $0.15              | 13 / 1 / 1            | $0.00015 (0.08×)                      |
| harvestapi    |               |         |                    |                       | $0.00199 (US + MA: $1.066 / 537)      |

Rows per run (rows = distinct in every run):

| Search                 | valig | kaix | memo23 | curious_coder |
| ---------------------- | ----- | ---- | ------ | ------------- |
| us-remote-plain        | 2     | 5    | 4      | 2             |
| us-remote-real         | 14    | 5    | 0      | 14            |
| uk-remote-plain        | 0     | 0    | 0      | 0             |
| uk-remote-real         | 1     | 1    | 1      | 1             |
| ma-onsite-plain        | 0     | 0    | 0      | 0             |
| ma-onsite-real         | 1     | 3    | 3      | 1             |
| us-locremote-plain     |       | 8    | 3      |               |
| us-remote-plain-senior |       |      | 4      |               |

- **Start fees.** valig about $0.0009 per run, memo23 $0.007, kaix and curious_coder under $0.0002. With few rows, memo23's start fee is most of its cost.
- **kaix's US remote numbers aren't Indeed's remote jobs.** With `remote: "remote"` and no location, kaix returned on-site jobs around Buffalo, NY (the proxy's area). Most were posted between July and mid-November, so neither the remote filter nor the 24-hour window held. kaix's schema warns that rich mode returns sponsored placements outside the filters. With location `Remote` (the probe), it found the real remote jobs. Its 0 relevant on US remote is this, not a lack of jobs.
- **memo23 on the US real keyword returned 0.** With the same keyword and location `Remote`, valig and curious_coder found 14. memo23 sends Indeed's remote attribute (`sc=attr(DSQF7)`) instead. Unexplained. The re-run will show whether it repeats.

#### Field coverage (share of rows)

| Field               | valig | kaix | memo23 | curious_coder |
| ------------------- | ----- | ---- | ------ | ------------- |
| `jk`                | 100%  | 100% | 100%   | 100%          |
| Full description    | 100%  | 100% | 100%   | 100%          |
| Employer apply link | 78%   | 55%  | 87%    | 78%           |
| Easily apply flag   | 0%    | 100% | 87%    | 0%            |
| Posted time         | 100%  | 100% | 100%   | 100%          |
| Company             | 94%   | 100% | 100%   | 100%          |
| Place               | 100%  | 100% | 100%   | 100%          |
| Remote flag         | 100%  | 100% | 100%   | 100%          |
| Salary              | 94%   | 86%  | 87%    | 94%           |
| Job type            | 33%   | 86%  | 40%    | 33%           |

- **Easily apply.** valig and curious_coder don't output it. Their items have no such field.
- **Posted time.** valig, curious_coder and memo23 give a date. memo23 also gives relative text ("1 day ago"). kaix's `dates.posted` is a date.

#### Overlap between actors (shared distinct `jk`)

| Pair                   | Shared |
| ---------------------- | ------ |
| valig – curious_coder  | 16     |
| kaix – memo23          | 7      |
| valig – kaix           | 4      |
| valig – memo23         | 4      |
| kaix – curious_coder   | 4      |
| memo23 – curious_coder | 4      |

valig and curious_coder returned **the same 16 jobs** on the same inputs, likely through the same Indeed endpoint. curious_coder costs a third as much.

### Boolean keyword

Indeed honours the merged boolean keyword (`(roles OR …) AND (spellings OR …)`) through every actor except memo23 on US remote (0 rows, above).

| Actor         | US remote plain / real relevant share | UK real | MA real |
| ------------- | ------------------------------------- | ------- | ------- |
| valig         | 100% (2) / 93% (14)                   | 100%    | 100%    |
| kaix          | 0% / 0% (off-place, above)            | 100%    | 100%    |
| memo23        | 100% (4) / no rows                    | 100%    | 100%    |
| curious_coder | 100% (2) / 93% (14)                   | 100%    | 100%    |

On valig and curious_coder, the one real-keyword job that isn't relevant is "Integrations Administrator". Its title has no role word, so the boolean matched in the description. By the letter of the spec, 93% < 100% isn't "honoured", but the plain side has 2 jobs, so the comparison means little. Every real-keyword job held the role and spelling terms. The plain keyword (`engineer claude code`) is the weaker search on Indeed: it found 0 jobs on UK remote and Morocco on-site.

Morocco: the role words' French spellings work on ma.indeed.com ("Ingénieur Cybersécurité", "Développeur Full Stack").

### Filter probes, after strike-off

The profile accepts junior to staff, so no lost job is struck for seniority. Every lost job is listed as `Remote`, so none is struck for arrangement either.

| Probe                                     | Unfiltered relevant | Lost | Struck off | Lost share | Verdict                               |
| ----------------------------------------- | ------------------- | ---- | ---------- | ---------- | ------------------------------------- |
| kaix `remote` filter vs location `Remote` | 5                   | 5    | 0          | 100%       | **not trusted (measured)**            |
| memo23 `remoteWork` vs location `Remote`  | 3                   | 0    | 0          | 0%         | trusted on 3 jobs; recheck on weekday |
| memo23 `experienceLevel=SENIOR_LEVEL`     | 4                   | 0    | 0          | 0%         | matcher only (see below)              |

kaix's lost jobs, all found by location `Remote` and none by the filter:

| Title                                                           | Company                    | Link                                               |
| --------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Senior Power Platform Developer & Architect (Copilot Studio)    | eSoftware Associates, Inc. | https://www.indeed.com/viewjob?jk=4b1856fe8158819e |
| Senior Full Stack Engineer – Healthcare Data & Interoperability | TAP Innovations            | https://www.indeed.com/viewjob?jk=87ccd8dfdf1e4693 |
| Senior Integration Engineer                                     | Oddball                    | https://www.indeed.com/viewjob?jk=87fa6a3c1e0a1871 |
| Senior Software Engineer - AI Evaluation / Coding Agents        | AuraOne Human Data         | https://www.indeed.com/viewjob?jk=9a588f0abef11bc9 |
| Integration Engineer                                            | Oddball                    | https://www.indeed.com/viewjob?jk=ddf465a1a276247d |

memo23's remote attribute found one remote job that location `Remote` missed: Bluesky, "Staff Software Engineer, Fullstack", listed as "United States". So the attribute can be the wider search.

memo23's senior filter kept "Integration Engineer", a title with no senior marker. It didn't narrow anything here. With a profile open to junior to staff, a level filter would drop the right jobs, so seniority stays with the matcher on Indeed.

### The gate

Harvestapi's gate cost per relevant job is $0.00199 (US remote $1.041 / 536, Morocco on-site $0.025 / 1).

| Actor         | `jk` + full description ≥ 95% | Cost per relevant ≤ 2× | Gate     |
| ------------- | ----------------------------- | ---------------------- | -------- |
| valig         | yes                           | 0.18×                  | pass     |
| kaix          | yes                           | 0.20×                  | pass     |
| memo23        | yes                           | 2.7×                   | **fail** |
| curious_coder | yes                           | 0.08×                  | pass     |

### The pick (provisional)

The report's pick order is **curious_coder, valig, kaix**.

1. **curious_coder** leads. It finds the most relevant jobs (tied with valig), with full `jk` and description coverage, employer links on 78% and a remote flag from Indeed's attribute. It is the cheapest per relevant job and doesn't depend on a filter it can't honour. It has no Easily apply flag, and job type is on only 33% of rows.
2. **valig** returns the same jobs at about 3× the cost, with no field curious_coder lacks.
3. **kaix** has the richest fields (Easily apply 100%, job type 86%) and the lowest cost per row. Its remote filter is broken in rich mode, though, and its 24-hour window leaks old sponsored jobs. With location `Remote` instead of the filter, it would likely rank higher. Its relevance count is depressed by its own search mode, not by Indeed.
4. **memo23** fails the gate on cost. Its start fee dominates when a search returns few rows.

**Go or no-go was left open** on Sunday: the gate passed, but 13 relevant US remote jobs in a weekend day, against LinkedIn's 536 on a weekday, left volume as the question. The weekday re-run settled it (above).

#### The weekday re-run (as planned)

- **When:** a weekday evening UTC (for example Wednesday 2026-11-25), so the 24-hour window covers a full US workday. The script picks the latest qualifying harvestapi day itself, which should then fall after #99.
- **Cost:** the same 27 runs, $1.43 reserved and about $0.09 spent. It needs the user's OK at the time. A rerun pays again.
- **kaix change (user, 2026-11-23):** kaix's core remote searches now use location `Remote`, and its probe runs the filter (`us-filterremote-plain`), so kaix is measured on remote jobs. Still 27 runs.
- **Planned** for Monday 2026-11-23 at 18:00 UTC _(user)_. It ran on Tuesday 2026-11-24 at 10:25 UTC instead, for $0.1745.

## Preference → search map

Each cell is one of:

- _trusted_: in use, or measured within 2%
- _not trusted (measured)_
- _not offered_
- _matcher only_: offered but not measured, or deliberately left to the matcher

Input names are in code font.

| Preference                    | LinkedIn (harvestapi)                                   | valig                                      | kaix                                                                                    | memo23                                                               | curious_coder                                    |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Keyword                       | trusted: `jobTitles`, boolean                           | trusted: `title`, boolean                  | trusted: `keyword`, boolean (rich mode adds sponsored)                                  | trusted: `position` / `keywords[]`, boolean (US real 0 rows twice)   | trusted: `query`, boolean                        |
| Places                        | trusted: `geoIds`                                       | trusted: `country` site + `location`       | trusted: `country` site + `location` (an empty location falls back to the proxy's area) | trusted: `country` + `location` (`expandToCities` off)               | trusted: `country` site + `location`             |
| Arrangement (remote)          | trusted: `workplaceType`, plus the matcher's leak rules | location `Remote` only: trusted            | `remote`: **not trusted (measured)**; location `Remote`: trusted                        | `remoteWork`: **not trusted (measured)**; location `Remote`: trusted | location `Remote` only: trusted                  |
| Arrangement (hybrid, on-site) | trusted: `workplaceType`                                | not offered (matcher only)                 | `remote: "hybrid"`: matcher only                                                        | `remoteWork: "HYBRID"`: matcher only                                 | not offered (matcher only)                       |
| Seniority                     | trusted: `experienceLevel`                              | not offered (matcher only)                 | not offered (matcher only)                                                              | `experienceLevel`: matcher only (kept a non-senior title)            | not offered (matcher only)                       |
| Time window                   | trusted: `postedLimit: 1h`                              | trusted: `datePosted: 1` (day granularity) | `fromDays: 1`: **not trusted (measured)** in rich mode                                  | trusted: `datePosted: 1` (day granularity)                           | trusted: `postedWithinDays: 1` (day granularity) |
| Contract type and engagement  | matcher only (`employmentType` not sent)                | not offered (matcher only)                 | `jobType`: matcher only                                                                 | `jobType[]`: matcher only                                            | not offered (matcher only)                       |
| Salary                        | matcher only                                            | not offered (matcher only)                 | not offered (matcher only)                                                              | `minSalary` (Indeed estimates): matcher only                         | not offered (matcher only)                       |
| Languages                     | matcher only                                            | matcher only                               | matcher only                                                                            | matcher only                                                         | matcher only                                     |
| Time zone                     | matcher only                                            | matcher only                               | matcher only                                                                            | matcher only                                                         | matcher only                                     |
| Notice period                 | matcher only                                            | matcher only                               | matcher only                                                                            | matcher only                                                         | matcher only                                     |

Other filters seen but not used: kaix `radius`, `searchMode`; memo23 `postedBy`, `onlyExternalJobs`, `strictMatch`, `deepSearch`, `uniqueCompanies`; curious_coder `radiusKm`. None narrows on a preference the matcher judges.

## Answers for later slices

- **Start fees (slice 03):** none is large. memo23's $0.007 per run is the highest, and it dominates memo23's cost when searches return few rows. For the others, the start fee per run is $0.0009 or less.
- **Rows per search (slice 03):** on Sunday, Indeed ran out before 15 rows on every search. On the weekday, the US real keyword filled the 100-row cap on valig and curious_coder, so the US remote search needs a higher cap; how much Indeed holds past 100 is unmeasured. UK and Morocco stayed under 10 rows. Indeed's ~1,000 result cap per search didn't come into play.
- **Keyword (slice 03):** the LinkedIn merged boolean keyword works on Indeed as is, at up to 403 characters (the UK and Morocco keywords; US is 293). A single plain keyword finds much less.
- **Remote per site (slice 03):** location `Remote` works on the US and UK sites through every actor. kaix's remote filter doesn't, and memo23's attribute filter lost 58% on the weekday.
- **Language per site (slice 03):** on ma.indeed.com, French role words in the keyword find French titles.
- **The redirect (slice 04):** valig returns the resolved employer link on 89% of rows on the weekday (78% on Sunday), curious_coder on 93%, memo23 on 95%. The rest point back to Indeed. Resolving Indeed's redirect ourselves isn't needed for the jobs that link out.
- **HTML descriptions (slice 04):** every actor gave a full description on 100% of rows after `htmlToPlainText`.

# LinkedIn region test (harvestapi)

Results of `pnpm --filter @xjobs/xjobs apify:linkedin-region-test` (`apps/xjobs/src/scripts/linkedin-region-test.ts`), a throwaway spike for Phase 3 slice 04 (search precision) and the shared-searches revision. Run on 2026-11-14, about 01:50–02:10 UTC, on `harvestapi/linkedin-job-search`. Real spend was $1.55 of a $2 cap: $0.86 for the main run, $0.44 for the control, $0.15 for the countries run and $0.11 for the keyword check.

Raw outputs are in `apps/xjobs/tmp/linkedin-region-test.json` and `apps/xjobs/tmp/linkedin-region-control.json` and `apps/xjobs/tmp/linkedin-region-countries.json` and `apps/xjobs/tmp/linkedin-region-keywords.json` (gitignored).

## Method

- **Keyword and window:** `react`, past 24 hours, sorted by date, no experience or work-type filter.
- **Places:** each place searched once, capped at 150 rows.
- **Pair judgement:** a pair "child > parent" passes when every child job posted inside the span both runs fully saw is also in the parent's results. That span ends when the earlier run started and starts at the later of the 24-hour edge (plus 30 minutes) and the oldest job of any run that hit its row cap. Fewer than 5 compared jobs counts as inconclusive.
- **Control:** EU, Europe, Middle East and Africa, each run twice at the same time with 100 rows, and each copy judged against its twin.

## Findings

### 1. LinkedIn results are not repeatable, so one comparison can't prove containment

The same search, started at the same moment:

| Place       | Copy 1: returned / total | Copy 2: returned / total | Missing from the twin |
| ----------- | ------------------------ | ------------------------ | --------------------- |
| EU          | 100 / 431                | 100 / 475                | 6% and 18%            |
| Europe      | 100 / 730                | 100 / 719                | 10% and 5%            |
| Middle East | 94 / 93                  | 39 / 39                  | 64% and 0%            |
| Africa      | 23 / 23                  | 53 / 53                  | 13% and 62%           |

- For large places, a search misses 5–18% of what its own twin returns.
- For small places, LinkedIn's total itself changes between twins (Middle East 93 vs 39, Africa 23 vs 53).
- This is also a collection recall problem: a single run sees only part of what LinkedIn has.

### 2. Region containment

| Pair                     | Compared | Missing  | Totals, child / parent | Reading                                               |
| ------------------------ | -------- | -------- | ---------------------- | ----------------------------------------------------- |
| EU > EEA                 | 147      | 12 (8%)  | 461 / 471              | Within noise; not proven                              |
| EU > Europe              | 101      | 4 (4%)   | 461 / 687              | Within noise; control rerun 9–12% missing; not proven |
| EEA > Europe             | 104      | 14 (13%) | 471 / 687              | Within noise; not proven                              |
| UK > Europe              | 41       | 9 (22%)  | 151 / 687              | Above the large-place noise; not proven               |
| Europe > EMEA            | 150      | 18 (12%) | 687 / 681              | EMEA's total is no larger than Europe's               |
| Africa > EMEA            | 25       | 22 (88%) | 78 / 681               | Not contained                                         |
| Middle East > EMEA       | 13       | 7 (54%)  | 68 / 681               | Not contained                                         |
| Middle East > MENA       | 68       | 31 (46%) | 68 / 42                | Within small-place noise; unproven either way         |
| MENA > EMEA              | 6        | 1        | 42 / 681               | Too little data                                       |
| Morocco > Africa, > MENA | 10       | 7 each   | 10 / 78, 10 / 42       | The 7 are Morocco's "EMEA"-wide jobs (see 3)          |
| Morocco > EMEA           | 1        | 0        | 10 / 681               | Too few                                               |

- **EMEA behaves like Europe.** Its total (681) is about Europe's (687–730), and only 9 of its 150 jobs are in Africa or the Middle East. A broad region returns a thin sample of its outer countries, not a superset.
- **No pair is approved.** EU, EEA and UK into Europe sit inside or near LinkedIn's own noise, so folding them can't be proven with single comparisons.

### 3. A country search also returns region-wide postings

Six of Morocco's 10 jobs were posted to "EMEA" as a whole. LinkedIn shows a job posted to a region in searches for countries inside it. Those jobs don't appear in sibling regions such as Africa or MENA.

### 4. Several places in one run

One run with `geoIds` for the United States, Canada and Latin America:

- charged 3 `actor-start` events, one per place;
- returned 45 rows, so `maxItems` applies per place;
- tags every job's `query.geoId` with the place that found it.

So a combined run costs the same as separate runs, and results stay traceable.

### 5. Keyword syntax (EMEA, past week, LinkedIn totals)

| Keyword                        | Total  |
| ------------------------------ | ------ |
| `nestjs`                       | 190    |
| `next js`                      | 630    |
| `"next js"`                    | 36     |
| `nestjs OR next js`            | 22     |
| `nestjs OR "next js"`          | 179    |
| `(nestjs) OR ("next js")`      | 177    |
| `nestjs or "next js"`          | 3      |
| the 8-term stack, quoted, OR'd | 21,775 |

- A multi-word term must be quoted or in parentheses; bare, it misparses.
- `OR` must be uppercase; lowercase `or` is read as a word.
- Bare `next js` matches about 17 times more than `"next js"`: loose matching is part of today's noise.
- OR totals aren't additive (`nestjs OR "next js"` is below `nestjs` alone), so totals are approximate or OR isn't a clean union.
- Generic terms (`aws`, `typescript`) flood the stack OR with unrelated roles.

### 6. Job functions

Of 487 distinct jobs from the place runs, 325 have an engineering title. 117 of those (36%) carry neither `ENG` nor `IT`: most have no job function at all (often staffing agencies), and some are `OTHR`. A `functionIds: ['eng', 'it']` filter would lose about a third of real engineering jobs.

### 7. Prices seen

- `job` is $0.001 and `actor-start` is $0.001 per place.
- Some small runs reported $0 with zero charged events. The reason is unknown; the spend file counted what Apify reported.

### 8. Repeats and country searches (Middle East)

The Middle East was searched 3 times at once (80 rows each), and 8 of its countries once each (40 rows each).

| Copy | Returned | LinkedIn total | New compared with earlier copies |
| ---- | -------- | -------------- | -------------------------------- |
| 1    | 80 (cap) | 96             | 80                               |
| 2    | 38       | 38             | 11                               |
| 3    | 42       | 42             | 0                                |

- LinkedIn's answer looks bimodal: about 95 or about 40 for the same search. A second copy added 11 jobs, and a third added nothing.
- Over the span every run fully saw, the three copies together found 91 jobs and the countries together 66. 53 were in both.
- **Only in the region (38):** mostly Türkiye (13), Bahrain (5), Iraq (4), Egypt (3) and Lebanon. Iraq, Egypt and Lebanon weren't among the countries searched, but the Türkiye and Bahrain searches still missed them: Bahrain returned 0 jobs and Türkiye 7.
- **Only in the countries (13):** 7 were posted to "EMEA" as a whole, which a country search returns and the region search doesn't. The other 6 were in Kuwait.
- Country searches are no steadier: they're small and miss jobs the region search finds.
- The unverified geoIds checked out: Israel's (101620260) returned Israeli jobs and Türkiye's (102105699) returned Turkish jobs.

### 9. Keyword check (role word and stack)

Role words: `engineer OR developer OR ingénieur OR développeur OR programmer OR "tech lead"`. Stack: the 8 terms OR'd, multi-word terms quoted.

LinkedIn totals, Europe, past week:

| Keyword                       | Total         | Newest titles                                          |
| ----------------------------- | ------------- | ------------------------------------------------------ |
| `aws`                         | 14,555        | Senior Account Executive, Business Development Manager |
| `typescript`                  | 4,275         | C# Software Engineer, CTO                              |
| `react`                       | 3,345         | Team Manager, Technical Product Owner                  |
| `postgresql`                  | 2,970         | Software Engineer C/C++, AI Data Science Analyst       |
| `nestjs` (bare)               | 1,514         | Quote-to-Cash Manager, Legal Officer                   |
| `"node js"`                   | 151           | Senior Node.Js Engineer, Node.js Developer             |
| `"next js"`                   | 32            | Frontend Developer - Next.js & React                   |
| `"react native"`              | 23            | Software Engineer - React Native                       |
| stack OR'd                    | 18,323        |                                                        |
| role words alone              | 51,421        |                                                        |
| `(role) AND (stack)`          | 12,536        |                                                        |
| `(role) (stack)` (no `AND`)   | 12,582        |                                                        |
| `développeur` / `developpeur` | 1,303 / 1,296 |                                                        |

- The role word cuts the stack's volume by 32% in Europe and by 24% in Morocco (199 to 152 over a week).
- `AND` and juxtaposition read the same way, and accents don't matter.
- A bare single term matches loosely: `nestjs` returns legal and finance roles. Quoted terms match tightly, perhaps too tightly: `"node js"` returns only 151.
- `aws` alone is most of the stack's volume.

Title samples, 40 newest jobs each:

| Place, window      | Stack: engineering titles | Role AND stack: engineering titles | Engineering jobs the role form lost |
| ------------------ | ------------------------- | ---------------------------------- | ----------------------------------- |
| Europe, past 24 h  | 38 / 40                   | 38 / 40                            | 6 of 38 compared (16%)              |
| Morocco, past week | 36 / 40                   | 39 / 40                            | 2 of 23 compared (9%)               |

- The jobs lost were architects (Solution, Lead, Integration), a consulting director, a Danish DevOps specialist, a French "Développeur principal", and two "EMEA" engineering management roles. The losses are within LinkedIn's own run-to-run noise (5–18%), so they can't all be blamed on the role word. Architect and management titles plausibly are, because neither word is in the list.
- In the newest jobs, the stack alone already returns mostly engineering titles. The noise is concentrated in the long tail that `aws`, `typescript`, `react` and bare `nestjs` pull in.

### 10. Final check (real filters, role words, spellings, keyword length)

Run on 2026-11-14 with `pnpm -s apify:linkedin-region-test -- --sections final --campaign final --concurrency 4` (raw output in `apps/xjobs/tmp/linkedin-final-check.json`, gitignored). Real spend was $0.055 of the $1 `final` campaign cap. Every run carried the filters the planner will use: Europe remote is geoId 100506914 with `workplaceType: remote` and `experienceLevel: mid-senior`; Morocco is `workplaceType: hybrid, office` and `experienceLevel: associate, mid-senior`.

**(a) Role words**, 24-hour samples of 40 rows, each AND the dev stack:

| Place         | Narrow total | Extended total | Engineering titles in the sample (narrow / extended) |
| ------------- | ------------ | -------------- | ---------------------------------------------------- |
| Europe remote | 362          | 427 (+18%)     | 39 / 40 and 39 / 40                                  |
| Morocco       | 8            | 8              | 8 / 8 and 8 / 8                                      |

- The extended list found engineering jobs the narrow one lost: "Team Lead, Software Engineering", "Head of Engineering" (twice), "Senior Data Governance & Privacy Architect", "Agent Identity Engineer…" and "Senior Solution Architect, MSP".
- It added no non-engineering noise in the sample. The one non-engineering flag, "Desarrollador Golang + GCP", is an engineering job whose title uses a word outside the English and French title check.

**(b) Spellings**, week totals on Europe remote, each keyword alone:

| Keyword                            | Total |
| ---------------------------------- | ----- |
| `nodejs`                           | 533   |
| `"node.js"`                        | 33    |
| `"node js"`                        | 33    |
| `"node js" OR "node.js" OR nodejs` | 351   |
| `nextjs`                           | 95    |
| `"next.js"`                        | 3     |
| `"next js"`                        | 3     |
| `"next js" OR "next.js" OR nextjs` | 57    |
| `nestjs`                           | 178   |
| `"nest.js"`                        | 1     |
| `"nest.js" OR nestjs`              | 19    |

- A bare term with no operator or quote is matched loosely, which is why `nodejs` alone (533) returns more than the OR group that contains it (351). Our keywords always carry `AND`, so they are in the strict mode, and the bare totals are not comparable.
- The dotted and spaced quoted forms give identical totals (33 and 33, 3 and 3): LinkedIn reads `.` as a space. One quoted form is enough.
- In the strict mode the OR group finds far more than the quoted form alone (351 against 33), so the bare spelling matters. No spelling floods.

**(c) Keyword length**, week totals on Europe remote, the dev role words AND the dev stack padded with other technologies:

| Target (characters) | Actual | Terms | Total                 |
| ------------------- | ------ | ----- | --------------------- |
| 400                 | 398    | 34    | 51                    |
| 800                 | 800    |       | 0 (no total returned) |
| 1,200               | 1,199  |       | 0                     |
| 1,600               | 1,595  |       | 0                     |

- **A keyword can return results and still be silently broken.** The 398-character keyword holds every term of the dev keyword plus nine more, over a week, yet returns 51 where the dev keyword returns 430 in 24 hours. A larger OR over a longer window cannot return fewer, so between 319 and 398 characters (25 and 34 terms) LinkedIn degrades the query without an error, most likely by truncating it. From 800 characters it returns nothing.
- **So "returns results" is not the limit. The limit is 319 characters and 25 terms, the largest keyword verified to behave:** the dev keyword (extended role words AND every spelling of the dev stack).

**(d) Real volume**, 24-hour totals, the dev keyword with the extended role words:

| Search                                              | 24 h total | Per hour |
| --------------------------------------------------- | ---------- | -------- |
| Europe remote, mid-senior                           | 430        | about 18 |
| Morocco hybrid and office, associate and mid-senior | 8          | under 1  |

- About 440 jobs a day is about $0.44 a day at $0.001 a job, plus start fees of $0.001 a run: well inside $3 a day. One tick's Europe search (about 18 jobs an hour) stays under 100 rows.

**Gate:** passed.

- `(…) AND (…)` with real filters works: 362 to 430 results and no error.
- The dev keyword (319 characters) is verified to work, but the usable limit is 319 characters and 25 terms, not 400.

**Values for the planner:**

- Role words, engineer family: English `engineer, developer, engineering, architect, programmer, "tech lead", "technical lead"`; French `ingénieur, développeur, architecte`. The DevOps family adds `devops, sre`. Other families and Spanish and German follow the spec table.
- Spellings: `nodejs: [nodejs, "node.js"]`, `nextjs: [nextjs, "next.js"]`, `nestjs: [nestjs, "nest.js"]`.
- `LINKEDIN_KEYWORD_MAX_CHARS = 319` and `LINKEDIN_KEYWORD_MAX_TERMS = 25`; a keyword fits when both hold.

## Consequences for the planner

- **No folding across places.** At most EU, EEA and UK into Europe, and that would need repeated runs to prove above the noise.
- **A run per place is not the cost driver.** Start fees are $0.001 per place either way. The cost is per job collected, plus processing.
- **Merging can still happen within a place:** technologies (quoted, uppercase `OR`) and filters.
- **LinkedIn's noise matters for recall.** Overlapping searches or repeated ticks may be needed to catch what one run misses.
- **Countries don't replace regions.** Splitting a region into countries finds a few region-wide postings, but loses more than it adds.
- **A second copy of a search is the cheapest recall gain seen.** It added 11 of 91 Middle East jobs (12%); a third added none.

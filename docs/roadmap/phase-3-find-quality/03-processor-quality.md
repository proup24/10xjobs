# 03: Processor quality

Revised: 2026-11-17, from the first Claude batch on `10xjobs-dev` and the golden eval. The first version described the 60 DeepSeek jobs from 2026-11-09; those were archived in 02b, and most of their problems are gone.

## Where it stands

Slice 02b moved the processor to `claude -p` (Sonnet 5.5, schema v4, generator only, no verifier). On 2026-11-16 it processed 1,183 harvestapi jobs on dev.

| Measure                   | DeepSeek, 60 jobs (2026-11-09) | Claude, 1,183 jobs (2026-11-16) |
| ------------------------- | ------------------------------ | ------------------------------- |
| `needsReview` set         | 59 (98%)                       | 489 (41%)                       |
| Seniority `unsure`        | 42 (70%)                       | 137 (12%)                       |
| Position `unsure`         | 26 (43%)                       | 139 (12%)                       |
| No tech stack at all      | 29 (48%)                       | 89 (8%)                         |
| Salary found              | 0                              | 416 (35%)                       |
| Cost per job (list price) | $0.0084                        | $0.0386                         |
| Failed to process         | n/a                            | 13 (1.1%)                       |

Matching, one published profile, 1,177 decisions: 66 qualified, 1,049 rejected, 62 review.

- **Review share is 5.3%** (position 55, location 7). That's within "review stays the exception", the target 02 set.
- **65 of the 66 qualified matches are Unverified.** The causes are contract type unknown (48), seniority unknown (31), stack unknown (4) and location unknown (3), plus `needsReview` on the job.

### Golden eval, 2026-11-17

`processor:eval` on 73 cases fails all four bars: openingPlaces 74%, mainStack 87%, sure facts contradicted 9.7%, and arrangement can't be scored. The per-case list (PR #89) showed that most misses were wrong labels from the career-hub import, not model errors. PR #90 fixed the clear-cut ones (16 places, 16 seniorities, 3 salaries). Expected after the fix, not yet re-run: openingPlaces about 96%, seniority about 95%, salary about 99%.

The model misses that remain:

- **Main stack:** 12 cases miss main technologies. #8826, #1393, #1568 and #10365 have an empty or partial main stack.
- **AI-training gigs:** #36 ("Full Stack Software Engineer | €65/hr", a remote AI-training project) is tagged `fullstack_engineer`. That's the "wrong job" anti-goal.
- **Non-English postings:** #24 misses "> 3 Jahre" and a 2026–2029 contract period; #7941 misses "solid English".
- **Seniority:** #24, #10365 and #1667 come out `unstated` against a labeled level.

## Problems

1. **`needsReview` doesn't single out jobs worth a look.** It's set on 41% of jobs, and every flagged job has some unsure fact or opening. The most common unsure facts aren't ones the matcher rejects on: `isSoftwareEngineeringRole` 158, `arrangement` 101, `engagement` 53, `junkFlags` 22. Unsure openings add 136.
2. **Unverified is on almost every match.** `unverified` is true when any check is unknown or unsure, or the job has `needsReview`. Most postings don't state contract type or seniority, so nearly every qualified job carries the badge, and it tells the user nothing.
3. **Main stack.** 285 engineering jobs have requirements but no `main` technology, so the stack check rests on must-haves alone, and it came out `unknown` 121 times. The eval shows main technologies missed.
4. **AI-training and data-labeling gigs pass as engineering roles** (#36).
5. **Vocabulary gaps.** Unmatched terms: Git (160), CI/CD (101), Databricks (44), PowerShell (35), PySpark (28), SQL Server (25), OpenTelemetry, Helm, Datadog, CloudFormation, DynamoDB, Azure DevOps, Oracle.
6. **Failures.**
   - 12 jobs failed on a duplicate technology. #77 fixed the cause after the batch ran, so `db:reprocess -- --failed` recovers them.
   - "Reached maximum number of turns (3)" hit 42 first attempts, and 1 job failed on it in the end.
7. **Cost** is 4.6 times DeepSeek's. It's notional on the subscription, and real once the engine moves to an API key (the gate before other users).
8. **The golden set can't judge the processor yet.**
   - Labels are still unreviewed drafts for roleKind, required techs and year ranges.
   - No case has an `arrangement`, `contractType`, `engagement` or `isSoftwareEngineeringRole` label, so the arrangement bar can't pass.
   - roleKind labels use career-hub's taxonomy: `devops_engineer` where the vocabulary splits platform and SRE, and codes like `ai_training`, `seo_marketing_web` and `ux_engineering`.
   - Open label calls: #10372 (a USD and a CAD salary range), #7824 ("eligible to work from France, Belgium or Spain": a place or work authorization?). The 16 openings #90 gave a place still have `placeStrictness: unstated`.

## Still open from slice 02

- **Work-authorization requirements are AND-ed.** The schema has no "or", so "authorized to work in the US or Canada" can come out as two requirements and sure-reject a US citizen.
- **Wrong-but-sure contract types reject on their own.** On dev in 02: a senior Java role tagged `internship/sure`. Only 8 contract-type rejections in this batch; check whether any are wrong.
- **`needsReview` still feeds the Unverified badge,** and the matches page can't say why, because `match_details` doesn't return the flag.
- **`engagement` and `junkFlags` stay out of matching** _(user, in 02)_. Engagement is now unstated on 77% of jobs and unsure on 4%. Whether it's worth extracting is still this slice's call.

## Open questions

- What should `needsReview` mean: "a fact the matcher relies on is doubtful", or "a human should look"? Which facts count?
- When should a match be Unverified? Should an unstated contract type or seniority count, when most postings state neither?
- How does the processor pick `main` technologies, and should a job with must-haves but no main still be judged on its stack?
- Should AI-training and data-labeling gigs be a junk flag, a roleKind the matcher rejects, or both?
- Which golden labels does the user review first, and against which roleKind taxonomy?
- Is Sonnet needed for every fact, or can a cheaper model or fewer output tokens hold the bars?

## Suggested path

1. **During the brainstorm** _(user)_, review the remaining golden labels with the user: roleKind against the current vocabulary, required techs, then arrangement and contract type, and the open calls in problem 8. Then re-run `processor:eval` for a real baseline before any prompt change.
2. Redefine `needsReview` and Unverified around the facts the matcher reads. Measure with `db:match-shares` and the Unverified share.
3. Fix the main stack and AI-training cases first; they decide wrong matches.
4. Add the vocabulary gaps with `db:vocab`.
5. Measure cost per job with each change, ahead of the API-key switch.

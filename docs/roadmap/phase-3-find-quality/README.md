# Phase 3: Find quality

Date: 2026-11-11
Status: draft

## Intent

Phase 2 made the pipeline run end to end. The first real results were poor:

- 60 jobs were decided for the one published profile on `10xjobs-dev`. All 60 were Moroccan, because the backlog stalled.
- 2 of the 3 matches were jobs the profile doesn't want. They qualified because a dropped fact counts as `unknown`, and `unknown` never rejects.
- Some details shown were wrong, for example "Worldwide" on a Casablanca job.

This phase fixes harvest, enrichment and matching so that the jobs that reach a user are the right ones, with correct details. It follows the anti-goals: don't miss the right jobs, and don't let the wrong ones through.

## How this folder works

Same as Phases 1 and 2: each slice is a short brief covering the problem, the open questions and a suggested path. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs.

## Slices

| #   | Slice                                                                          | Area    | Status                         |
| --- | ------------------------------------------------------------------------------ | ------- | ------------------------------ |
| 01  | [LinkedIn source data](01-linkedin-source-data.md)                             | Harvest | Done (PR 52)                   |
| 02  | [Listing facts](02-listing-facts.md)                                           | Enrich  | Done (PRs 53–60)               |
| 02b | [Models on Claude](02b-claude-models.md) (interim)                             | Enrich  | Done (PRs 62–65)               |
| 03  | [Processor quality](03-processor-quality.md)                                   | Enrich  | Next; brief revised 2026-11-17 |
| 04  | [Search precision](04-search-precision.md)                                     | Harvest | Done (PRs 66–70)               |
| 05  | [Posting language for close languages](05-posting-language-close-languages.md) | Enrich  | Done (PR 84)                   |
| 06  | [One job per apply link](06-one-job-per-apply-link.md)                         | Harvest | Done (PR 86)                   |
| 07  | [Trial LinkedIn actors](07-trial-linkedin-actors.md)                           | Harvest | Designed; plan next            |
| 08  | [Seniority to LinkedIn level](08-seniority-levels.md)                          | Harvest | Brief; brainstorm next         |
| 09  | [Non-remote jobs from remote searches](09-non-remote-leak.md)                  | Match   | Brief; investigate first       |
| 10  | [Search yield](10-search-yield.md)                                             | Harvest | Findings; not yet discussed    |

## Follow-ups from slice 02

Small items the slice 02 reviews left open. None of them blocks slice 03.

- **Places.**
  - The resolver passes an unmapped LinkedIn region code through when it equals one of our region codes. The spec says an unknown code gives no place.
  - `db:vocab cities alias` doesn't check whether another city already has that spelling.
  - `db:places` skips rows that carry only a city.
- **Matching.**
  - The "closed" check uses the engine's clock, while the sweep uses the database's `now()`. Clock skew causes repeated rebuilds.
  - There is no end-to-end sweep test.
  - `markStale`'s description-place branch is unindexed.
- **Review list.**
  - A decision on rule A, then on rule B, then back to A on the same outcome brings the old A decision back. Two code comments say it doesn't.
  - A user calling PostgREST directly can set `match_reviews."createdAt"`, and can insert `fact_reports` with arbitrary copied values and no length limits.
- **Web.**
  - The matches page repeats the matcher's reason sentences to show labels, with no test that catches drift.
  - Work-authorization kinds (`work-permit`) and the salary rule's currency still show as raw codes.

# 13: Slice 03 rollout checks

Checks for [slice 03](03-processor-quality.md) on `10xjobs-dev`, to run on the first weekday after each PR is deployed. Spec: [processor quality and cost](../../superpowers/specs/2026-11-26-processor-quality-design.md). Plan: [2026-11-26-processor-quality](../../superpowers/plans/2026-11-26-processor-quality.md).

Each check says what to look at, what passing looks like, and what to do in either case. One section per PR. Write each result under its section with the date. Read-only checks run against `10xjobs-dev` (for Claude, through the `supabase-dev` MCP). Commands that write need `XJOBS_ALLOW_REMOTE_DB=1`, and the owner runs them.

The eval numbers to compare against are in [PR 154](https://github.com/proup24/10xjobs/pull/154) (baseline) and [PR 155](https://github.com/proup24/10xjobs/pull/155) (the current prompt). A single eval run moves by about ±2 cases on any bar.

Before reading a day's numbers, check whether the worker was stopped by hand (see [slice 11](11-monday-checks.md)). A gap is not an outage.

## PR 150: Unverified and unknown stack

Merged 2026-11-27. The matcher version is 15.

| Check                                                                                              | Pass                                                                              | If it fails                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Re-decide.** `pnpm --filter @xjobs/xjobs db:rematch -- --all`, once after the deploy.            | It finishes, and every live decision is on matcher version 15.                    | Rows left on 14 mean the sweep stalled. Read the match worker log.                                                                   |
| **Unverified share.** `db:match-shares -- --days 7`, the Unverified share among qualified matches. | About 34% (it was 94%).                                                           | Much higher: a check still marks unknown facts as unsure. Look at `decide.ts`. Much lower: confidences are not reaching the matcher. |
| **Stack reviews.** The same report, reviews on rule `stack` and field `techStack`.                 | Up by about 59 (53 listings and 6 post roles), and review is still the exception. | Far more: postings name technology the vocabulary can't compare. Read the stack reasons, and add codes with `db:vocab`.              |

## PR 151: the check before the LLM

Merged 2026-11-27.

| Check                                                                                                    | Pass                                                                                                                           | If it fails                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **First ticks.** The worker's `prefilter` log lines (checked and skipped counts) on the first 2–3 ticks. | A line every tick, and no errors.                                                                                              | A failed demand load fails the tick and skips nothing. Fix it before reading the rest.                                             |
| **Skip share.** `db:analyze` section 14, after one weekday.                                              | About 28% of new LinkedIn listings (active, in processor scope) are skipped. Counts by tag and country look plausible.         | Much higher: read the countries. A profile's places may not be resolving. Much lower: tags or countries are missing on listings.   |
| **Wrong skips.** The 20 random skipped titles in section 14, audited with the owner.                     | None of them is a job a current profile could take.                                                                            | Add the missing remote phrase to `remote-words.ts`, bump `PREFILTER_VERSION`, deploy, then run `db:recheck-skips`.                 |
| **Qualified per profile.** `db:match-shares -- --days 7`.                                                | Not down against the week before.                                                                                              | Find the lost jobs among the skipped listings (by tag and country). Skips are the likely cause; an unrelated drop also shows here. |
| **Recheck on a profile change.** After a publish or a places edit, look for `reopened` jobs.             | Skipped listings first seen in the 24 hours before the change are back to `pending` with reason `reopened`, and get processed. | Check `profiles.prefilterCheckedVersion` against `matchVersion` for that profile.                                                  |

## PR 155: AI-training role kind and vocabulary

Merged 2026-11-27.

| Check                                                                                                                                                                                  | Pass                                                                                                                                         | If it fails                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Migration.** `role_kinds` row `ai_training`.                                                                                                                                         | `isEngineering` is true, and the web position picker offers it.                                                                              | The data migration did not run. Check the stepped `db:migrate` log for the `ai-training-engineering` invariant.      |
| **Vocabulary.** Approve or alias each new term with `db:vocab -- tech …`: the 22 codes in the PR body, plus `ci/cd` and `ci/cd pipelines` → `ci_cd`, and `gitlab ci/cd` → `gitlab_ci`. | Each term resolves to its code in `db:vocab -- tech list`.                                                                                   | The seed only covers fresh databases. Add the term by hand.                                                          |
| **Backfill.** `db:reprocess -- --matched`, then `db:rematch -- --all`.                                                                                                                 | About 760 jobs at about $0.042 each (about $32).                                                                                             | Cost well past that: stop the processor and check the count the command printed.                                     |
| **Gigs rejected.** Jobs with `roleKind = ai_training` and their decisions.                                                                                                             | Every profile whose position isn't `ai_training` rejects them on position. The Alignerr, Joblet-AI and Crossing Hurdles gigs are among them. | A qualified match on one: read the position check. A gig not labelled `ai_training`: add it as a golden case.        |
| **No real jobs lost.** Qualified matches per profile, before and after the rematch.                                                                                                    | Down only by AI-training gigs.                                                                                                               | A real engineering job labelled `ai_training`: read its role quote, then tighten the prompt definition with an eval. |

## PR 156: what each call's model requests did

Merged 2026-11-27.

| Check                                                                                                                                                                                                                                   | Pass                                                                                               | If it fails                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Record written.** New `processing_attempts` rows have `turns` set, for listings and posts.                                                                                                                                            | Every new attempt has it.                                                                          | `turns` stays null: the runner is not passing stdout to the parser.                              |
| **Counting.** On a few multi-request rows, compare `turns.requests` with `turns.numTurns`.                                                                                                                                              | `requests` is `numTurns` minus 1, or explained by the CLI's synthetic messages.                    | Fix the parser before reading the next check. The recorded fixtures only hold one-request calls. |
| **The cause.** `db:analyze` section 15, after one weekday.                                                                                                                                                                              | One pattern dominates among multi-request calls: text replies and nudges (H1), or rejections (H2). | Neither dominates: save a few calls' full stream-json and look again.                            |
| **Act on it.** H1: change the output section of both prompts to call the `StructuredOutput` tool once, never writing the JSON as text. H2: fix the schema path the rejection texts name. Run the eval before and after (about $3 each). | The bars are no worse within ±2 cases, and calls per job drop on dev.                              | Keep the prompt as it is and record what was tried here.                                         |

## Cost per job

| Check                                                                                  | Pass                                                                      | If it fails                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Cost per job on dev,** from `processing_attempts`, per day, after each change above. | Down from $0.042 (the current prompt). The spec's target is below $0.037. | This decides whether the engine can move to an API key before other users. Report it to the owner. |

## Trials

| Check                                                                                                                                                                   | Pass                                                                                                                          | If it fails                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Haiku 5.5** (plan Task 13). `processor:eval -- --generator claude-haiku-5-5`, compared with the PR 155 numbers.                                                       | The four bars are no worse within noise, and role kind and seniority are each within 2 points of Sonnet's.                    | List the facts it misses. Sonnet stays.                                                                              |
| **`AND remote` keyword** (plan Task 14), after the Apify top-up and the owner's OK on about $0.40. Build `db:remote-keyword-check` on `db:split-check`'s capped runner. | Row counts with and without the word, the share LinkedIn tags remote, and the keyword length against the 319-character limit. | Not a pass or fail: the owner decides whether the word goes into remote searches. The PR 151 check stays either way. |

## Follow-ups (not checks)

From the PR 151 review. None blocks the checks above:

- `skipJob` reloads the whole demand for each re-sighted skipped job.
- A profile republished between the sweep listing it and recording its recheck loses that recheck. The window is one tick.
- The republish trigger rule is tested only in a local Postgres spec. A db-test would put it in CI.
- `reopenSkipped` scans every skipped row. A partial index on `firstSeenAt` for skipped jobs would bound it.
- `db:recheck-skips` uses a flat window of the last 24 hours.
- A trial actor seeing a skipped job again does not recheck it (owner to confirm).
- The owner-reviewed post set's `hiringKept` is 91.4% (the bar is 95%). It needs a run on main to tell whether it is new, and it matters before [Phase 4 slice 05](../phase-4-social-posts/05-send-email.md) sends anything.

# Slice 03: processor quality and cost (design)

Roadmap: [phase 3, slice 03](../../roadmap/phase-3-find-quality/03-processor-quality.md). Brainstormed with the owner on 2026-11-26. Every processing and matching decision below was approved by the owner, one at a time. Calls marked _(my call)_ were left to me; the owner can overturn them in review.

## Why

On dev, 14,028 listings were processed by Claude between 2026-11-16 and 2026-11-25, at about $517 at list price. They produced only 438 qualified matches across three profiles, and 95% of the jobs were rejected by every profile. Once the engine moves to an API key (the gate before other users), the processor costs real money: about $1,100 a month at last week's volume, for three profiles. Nearly all of the matches that did qualify carry an Unverified flag that tells the user nothing, and some are AI-training gigs, which is the "wrong job" anti-goal.

The owner asked to measure the issues again, to find out why so few jobs qualify, and to settle this slice and collection cost for good.

## What the measurements showed (2026-11-26, dev)

- **Collection, not processing, is the main cause of rejections.** Each profile's own LinkedIn searches found 6,473, 1,793 and 1,588 jobs, and 78–88% of them fail on location.
- **LinkedIn ignores the remote filter.** That has been true since about 2026-11-18, and it is now confirmed on LinkedIn's side:
  - harvestapi still sends `workplaceType: ["remote"]`, and every row echoes it back;
  - cheap_scraper, which builds its own `f_WT` URL, got the same 20–24% remote share on the same days;
  - the owner checked logged out: `typescript` in Europe for the last 24 hours shows 8,000+ mixed hybrid and onsite results, with and without `f_WT=2`, and the URL keeps the filter.
  - The share of remote-search rows that LinkedIn tags remote: 100% on 11-16 and 11-17, 83% on 11-18, 51% on 11-19, and about 30% since.
  - No actor can restore the filter.
- **In remote searches, results LinkedIn tags as non-remote** (5,688 jobs) produced 21 qualified matches. Results it tags remote (1,739 jobs) produced 172.
- **The processor reads these jobs mostly right.** A sample of jobs rejected only because their role came out `other` was nearly all non-engineering. Location rejections such as "remote in US, requires living there" are correct.
- **Per job:** about 22k cached input tokens and about 2,100–2,500 output tokens, so output is most of the $0.037 a job. On the first attempt, 2.4% of jobs hit "Reached maximum number of turns (3)", at about $0.065 each.
- **Merging the level searches (PR #125) worked for Apify:** about 55% less per tick, with the same number of distinct jobs. But Apify for the job board is only about $3 a day. The processor is over 90% of spend.

## Goals

1. Stop paying the processor for jobs no current profile could take, without losing jobs a profile could take.
2. Label AI-training gigs so matching can reject them for profiles that don't want them.
3. Make Unverified mean something a user can act on.
4. Stop vague-stack jobs from qualifying as if the stack fit.
5. Make the golden eval trustworthy, then use it to cut cost per job (output tokens now; Haiku 5.5 only if it meets the bars).
6. Close the small gaps: max-turns failures and the vocabulary.
7. Test whether `AND remote` in the keyword cuts non-remote rows at the source.

## Non-goals

- Changing the position rule. A job passes only on an exact role-kind match, and that stays _(owner)_.
- Showing Unverified on the matches page. Today it is computed but not rendered. Its only consumer is the webhook payload.
- A two-model setup, with Haiku for some facts and Sonnet for others.
- A new LinkedIn actor. The filter is gone at the source.
- Indeed processing. That is Phase 5 slice 04; this design only sets one constraint on it (below).

## Anti-goals

- **A wrong skip:** a job a current profile could take never reaches the processor. Every rule below errs toward processing.
- **A fake verdict:** a skip must not appear as a matcher rejection.
- **Prompt changes judged against an unreviewed answer key.**

## Part 1: the check before the LLM

### Approaches considered

- **A. By search:** skip a job found only by remote searches when LinkedIn doesn't tag it remote and its text doesn't mention remote. Simple, but it reasons about searches, not people, and it can't bring a job back for a later user.
- **B. By the profiles' places, with a recheck (chosen):** skip only while no published profile could take the job, and recheck when profiles change.
- **C. Hold every job until a profile needs it:** in practice the same as B, so it was dropped.

The owner picked B with a recheck _(owner)_: "cut these jobs only if no current users look for them."

### The rule

The check reads the job's **arrangement tag** (the normalized `workplaceType`) and its **country**, never its channel _(owner)_.

| Tag                               | The job is processed when…                                                                                                                                                           | Otherwise |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| remote                            | always                                                                                                                                                                               | n/a       |
| no tag                            | always (slice 09 decision, kept _(owner)_)                                                                                                                                           | n/a       |
| hybrid or onsite, country unknown | always                                                                                                                                                                               | n/a       |
| hybrid or onsite in country X     | a published profile wants hybrid or onsite somewhere in X, **or** the title, location text or description mentions remote (the word list), **or** LinkedIn's `remoteAllowed` is true | skipped   |

- **`remoteAllowed` counts as a remote signal** _(my call)_. On dev it's false on all 5,190 hybrid or onsite jobs, so the backtest doesn't change; it's a free safeguard.
- **Only jobs never processed are checked** _(my call)_. A job with an extraction that goes back to `pending` (archived and seen again, or back after 21 days unseen, through `nextProcessing`) is processed as today. A job can therefore never be `skipped` while it still holds matches.

- **"Somewhere in X":**
  - by country, not city. A profile that wants hybrid in Paris lets every hybrid or onsite job in France through _(my call, approved)_;
  - a region counts by its member countries;
  - hybrid and onsite count as one, so a profile wanting either lets through jobs with either tag _(my call, approved)_.
- **The case where no profile wants remote at all** is ignored. Every profile wants remote today _(my call, approved)_.
- **Sources:** today only LinkedIn job-board jobs carry a tag. Any source whose mapper sets a real hybrid or onsite tag joins the check automatically.
  - **Constraint on Phase 5 slice 04:** Indeed's "not remote" maps to _untagged_, not onsite, so Indeed jobs always reach the processor _(owner)_.
- **Out of scope for the check:** posts and post roles (their own pipeline). Ashby and Greenhouse jobs aren't processed today.

### The word list

- **How it matches:** case-insensitive, on whole words (with word endings), against Unicode-normalized text (NFKC), so titles in Unicode bold letters match.
- **Where it looks:** the title, LinkedIn's location text and the description. One hit is enough.
- **Negatives are not handled:** "no remote" still sends the job through _(owner)_.

| Language   | Words and phrases                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| English    | remote, remotely, telecommute, telecommuting, telework, teleworking, work from home, working from home, work-from-home, WFH, home office, home-based, fully distributed, distributed team, work from anywhere, from anywhere, from everywhere, anywhere in, virtual |
| French     | télétravail, teletravail, à distance, a distance, distanciel, full remote                                                                                                                                                                                           |
| Spanish    | remoto, remota, teletrabajo, a distancia, desde casa, desde donde                                                                                                                                                                                                   |
| Portuguese | remoto, remota, trabalho remoto, à distância, home office                                                                                                                                                                                                           |
| German     | Homeoffice, Home-Office, mobiles Arbeiten, mobile Arbeit, ortsunabhängig, Fernarbeit                                                                                                                                                                                |
| Italian    | da remoto, telelavoro, smart working, lavoro agile                                                                                                                                                                                                                  |
| Polish     | zdalnie, zdalna, zdalny, praca zdalna                                                                                                                                                                                                                               |
| Dutch      | thuiswerken, op afstand                                                                                                                                                                                                                                             |
| Russian    | удалённ, удаленн                                                                                                                                                                                                                                                    |

- **Measured on the 5,190 dev jobs tagged hybrid or onsite outside Morocco:**
  - the processor read 256 of them as offering remote, and this list catches 253 (99%);
  - the 3 misses are "flexible working arrangements (office, home, client sites)" (2 jobs) and an office-days sentence, which are arguably hybrid.
- **Words with zero hits so far** (telelavoro, Fernarbeit, fully distributed, ortsunabhängig, distanciel) stay in. They cost nothing.
- **Excluded on purpose:** "hybrid", "flexible", "flexible working". They would rescue most hybrid jobs.

### A skipped job

- **The record** _(owner, option A)_:
  - a new processing status, `skipped`, added to the `normalized_jobs_processing_status` check;
  - a recorded skip reason: the tag, the country, and that no profile wants hybrid or onsite there and the text has no remote mention;
  - no `job_matches` rows. A decision needs an extraction, and a skip is a processing decision, not a matcher verdict.
- **What users see:** nothing changes on the matches page.
- **Reports:** `db:analyze` and `db:match-shares` report skipped jobs by reason, plus a sample of skipped titles for auditing wrong skips.

### When the check runs, and the recheck

- **When it runs:** in the processor's loop, on `pending` listings that have no extraction, before any is claimed _(my call, revised while planning)_.
  - Ingest still only sets `pending`, as today. A pass before each claim moves the jobs that fail the check to `skipped`, so no claim, and no LLM call, ever reaches them.
  - The decisions are the same as running it at ingest, and ingest doesn't have to load every profile's places inside each write transaction.
- **The recheck:**
  - **A profile is published, or its places change** (any arrangement): recheck the `skipped` jobs first seen in the **24 hours** before that moment and not marked closed or expired _(owner: 24 hours, not 7 days)_.
    - It must not depend on catching one event. A sweep, like the matcher's stale-decision sweep, rechecks any profile whose places changed since its last recheck _(my call, approved)_.
  - **A skipped job is seen again** by any search: check it again on the spot, at any age _(my call, approved)_.
  - **The check or word list changes:** a version number on the check, and one command that rechecks the last 24 hours of skips (like `db:rematch` after a matcher change) _(my call, approved)_.
- **What a release does:** a job that now passes goes back to `pending` with the reason `reopened`.
  - There's no limit per release _(owner)_. The processor's daily budget and usage stops still apply.
- **Never the other way:** a processed job is never un-processed when a profile is unpublished or its places shrink.
- **Cost:** the check and the recheck cost no LLM call and no Apify run. A release costs normal processing, about $0.037 a job. A rough size from last week's rates: a new profile wanting onsite in the US releases about 180 jobs (about $7), and France about 27.

### Rollout

- Turn it on directly, with no shadow week _(owner)_. The backtest on 14,028 real jobs stands in for one:
  - about 3,900 skipped (28%), roughly $145 saved;
  - no qualified match lost among tagged jobs.
- First week: audit the sample of skipped titles. If it turns up a wrong skip, fix the word list and run the recheck command.

## Part 2: AI-training gigs

### Approaches considered

- **A. A role kind of its own (chosen):** `ai_training` replaces the job's other role kind _(owner)_.
- **B. A separate fact next to the role kind**, with a profile setting "Include AI-training gigs". It keeps the gig's skill (full-stack, say) visible and lets each user opt in. The owner preferred A.

### The definition (goes into the role-kind section of the prompt)

> **AI-training work:** the job's main output is data used to train or evaluate AI models: writing, solving, reviewing or rating tasks, prompts, answers or code for a model or AI lab, labeling or annotation, or building benchmarks and RL environments for AI agents. A job that builds or runs a product, including AI products and evaluation tooling a team uses, is not AI-training work, even when it mentions training or evaluating models.

The test is what the work produces, and it beats the title. Real examples from dev:

| Kind                                                  | Example                                                                                                                                 | Role kind     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1. Labeling, rating, "your sessions train our models" | Alignerr, "Get Paid to Build Your Own Project with an AI Coding Assistant"                                                              | `ai_training` |
| 2. Part-time hourly AI-training project work          | Joblet-AI, "Senior Fullstack Engineer" (~15 h/week contractor, an AI training project); Crossing Hurdles, "Software Engineer \| $75/hr" | `ai_training` |
| 3. Benchmark and RL-environment engineering           | Joblet-AI, "Software Benchmark Engineer" (tasks and tests that grade AI coding agents)                                                  | `ai_training` |
| 4. A real job from the same intermediaries            | Joblet-AI, "Electron Software Engineer", full-time                                                                                      | its real kind |
| 5. A real product job that touches AI evaluation      | ElevenLabs, Vanta, Motional                                                                                                             | its real kind |

- **`ai_training` becomes an engineering role kind**, so the position picker offers it _(owner, option B)_.
  - Add it to `ENGINEERING_ROLE_KINDS` (seed data), and set `role_kinds.isEngineering` for it on existing databases. The web picker and the `profiles_check_codes` trigger accept only engineering kinds.
  - A user who wants gigs picks `ai_training` as their position (one position per profile).
- **The prompt says AI-training work is a software-engineering role** (`isSoftwareEngineeringRole: true`), for every kind 1–3, labeling included _(my call)_.
  - It has to agree with the kind's flag. Otherwise `validate.ts` marks the role unsure, and gigs land in review instead of being rejected.
- **Matching:** the position rule is unchanged. Every profile whose position isn't `ai_training` rejects these jobs on position, with no doubt and the existing reason.
- **Golden cases:** add about 6 real dev postings, one or two of each kind _(my call)_. They're reviewed in the label pass (Part 5).
- **Backfill:** reprocess only the jobs whose current decisions are qualified or review, about 760 jobs or roughly $28 _(my call)_. Rejected jobs stay as they are.

## Part 3: Unverified and `needsReview`

### Approaches considered

- **A. "Passed on a fact we weren't sure of" (chosen)** _(owner)_.
- **B.** A, plus unknown location or stack.
- **C.** Remove Unverified and `needsReview`.

### The rule

- **Unverified is true** only on a qualified match where some check rests on an **unsure** fact (`unsure: true`).
  - An `unknown` check (a fact the posting doesn't state) no longer counts.
  - `needsReview` no longer counts.
  - On dev data that's 148 of 438 qualified matches (34%), against 412 today.
- **The webhook payload keeps `unverified` with the new meaning.** Document it for webhook receivers.
- **`needsReview` stays an internal processor-quality number:**
  - reported in `db:analyze`;
  - it no longer feeds matching;
  - `engagement` is removed from its inputs (the matcher never reads engagement).
- **Re-decide:** bump `MATCHER_VERSION` and `db:rematch` existing decisions.

## Part 4: unknown stack

### Approaches considered

- **A.** Keep it: unknown passes.
- **B. Unknown goes to review (chosen)** _(owner)_.
- **C.** Unknown rejects.

### The rule

- **When the stack check is `unknown`**, in either of its cases, the match goes to **review**, never qualified:
  - "job lists no tech requirements to compare";
  - "job has no comparable main or must requirements".
  - The reason reads, in plain words: the posting names no technology we can compare with your stack.
  - **It applies to listings and post roles alike** _(my call)_.
  - On dev that's 53 qualified listings (24 + 29) and 6 qualified post roles. They become reviews, on top of 459 listing reviews.
- **Other checks still reject first:** a job that fails another check stays rejected.
- **Why it matters now:** with Part 3, an unknown no longer marks a match Unverified, so without this change these jobs would look fully verified.
- **Review needs a rule and a field** (`job_matches_review_reason`). The rule is `stack`; the builder picks the field name used for "no comparable stack".
- **Re-decide:** together with Part 3, under the same `MATCHER_VERSION` bump.

The processor's handling of `main` is not changed here. A posting that lists languages only as experience, or names no language, rightly has no main by the prompt's rule. The eval misses on main stack (#8826, #1393, #1568, #10365) are a prompt question, taken up after the baseline (Part 5).

## Part 5: the golden set and the eval baseline

- **The answer key** is the 82 listing cases in `apps/xjobs/src/modules/processor/golden/cases/`. Their labels are drafts from the career-hub import, marked `drafted`.
- **Taxonomy:** the current role vocabulary, including `platform_engineer`, `site_reliability_engineer`, `cloud_engineer` and `ai_training`.
- **New labels:** add `arrangement`, `contractType` and `isSoftwareEngineeringRole` to the cases, so the arrangement bar can be scored.
- **New cases:**
  - about 6 AI-training cases (Part 2);
  - a few for the unknown stack (Part 4);
  - a few hard cases for the pre-LLM check's word list, as eval inputs to watch, not bars _(my call)_.
- **Order** _(owner: the review happens after the eval)_:
  1. One `processor:eval` run on the current prompt and model, about $3.
  2. Where the model agrees with the label, the label is confirmed automatically (the posts-eval precedent).
  3. The owner reviews, in batches, with the posting quote next to each item _(scope: my call)_:
     - every existing `expected` label the eval disagrees with. The career-hub values count as truth in `score.ts` today, so this is how wrong ones surface;
     - every `drafted` key still `reviewed: false`, chiefly requirements on 81 cases;
     - the new `arrangement`, `contractType` and `isSoftwareEngineeringRole` labels. I draft them from each posting myself, independently of the model, and the owner sees only the cases where my reading and the model's disagree.
     - The `engagement` labels are dropped along with the fact (Part 6).
     - The size is known only after the first run.
  4. Re-run for the real baseline. No prompt change is judged before this baseline exists.
- **Open label calls**, taken up in the review _(my proposals)_:
  - **#10372**, a USD and a CAD range: label the salary in the job country's currency.
  - **#7824**, "eligible to work from France, Belgium or Spain": label both the three places and a work-authorization requirement.
- **The 16 openings that #90 gave a place** but left at `placeStrictness: unstated`: settle them in the same review.
- **Bars** stay as in `score.ts`: openingPlaces ≥ 95%, arrangement ≥ 97%, mainStack ≥ 90%, sure facts contradicted ≤ 2%.

## Part 6: cost per job

- **Prices** (list): Sonnet 5.5 $2 / $10 per MTok (cache read $0.10); Haiku 5.5 $0.10 / $0.50.
- **Fewer output tokens, now, on the current model:**
  - stop extracting `engagement`. It stays out of matching _(owner, slice 02)_, and it's unstated on 77% of jobs. Profiles keep their `engagements` field, so matching on engagement later would need the fact back;
  - keep quotes short;
  - drop fields no reader uses.
  - Measure output tokens and the bars on the eval.
- **Haiku 5.5 trial, gated by the eval:** after the baseline, run the golden set on `claude-haiku-5-5`. Switch if it passes every bar _(owner)_, and if its role-kind and seniority accuracy is within 2 points of Sonnet's _(my call)_. If it fails only on some facts, the fallback is Sonnet at lower effort, not two models.
- **Report cost per job** with each change. The baseline is $0.037.

## Part 7: the small items

- **Max-turns:** find why 2.4% of first attempts hit the 3-turn limit (likely the schema-fix loop inside `claude -p`) and fix the cause rather than raising the limit _(my call)_.
- **Vocabulary**, through `db:vocab` _(owner)_:
  - **Aliases** to codes we already have: CI/CD, CI/CD pipelines, GitLab CI/CD → `ci_cd` (or the existing code for GitLab CI, if there is one).
  - **New codes:** Databricks, SQL Server, Azure DevOps, Oracle, Helm, CloudFormation, PySpark, PowerShell, OpenTelemetry, Datadog, Power BI, BigQuery, MLflow, LlamaIndex, OpenShift, DynamoDB, ArgoCD, JUnit, Maven, Hibernate, Pulumi, AWS CDK. The bar is real technologies with about 90+ jobs on dev.
  - **Left out:**
    - near-universal tools: Git, GitHub, GitLab, Jira;
    - concepts: NoSQL, MLOps, OAuth 2.0, LLM APIs.
    - They stay out of the stack score, as today.
  - **Accepted effect:** profiles without the new technologies score lower on jobs that require them, so a few more stack rejections.

## Part 8: the `AND remote` keyword test

- **When:** after the owner tops up Apify, which is refusing runs with "Too many outstanding invoices" since 2026-11-25 19:00 UTC.
- **The test:** one search with and without `AND remote` in the keyword, the same place and window, about $0.40 _(owner)_. Compare the row counts and the share LinkedIn tags remote.
- **Watch the keyword limit:** our keyword is near its 319-character limit, so adding the word may split searches into more runs.
- **Decision after the test:** the owner decides whether to put the word in remote searches. Either way, the Part 1 check stays as a safety net.

## Measuring the slice

Before and after each part ships, on dev:

- the skipped share and skip reasons; a weekly audit sample;
- qualified matches per profile (they must not drop, except for AI-training gigs);
- the review share, from `db:match-shares` (it must stay the exception);
- the Unverified share among qualified matches;
- cost per job and processor spend per day;
- the eval bars.

## Left to the builder

- Column names for the skip reason and the check version; the exact command name.
- The field name for the "no comparable stack" review.
- How profile places resolve to countries: reuse the matcher's place and region code.
- Where the recheck sweep lives and how often it runs.
- The order of PRs, as long as Part 5's baseline comes before any prompt change in Parts 2 and 6.

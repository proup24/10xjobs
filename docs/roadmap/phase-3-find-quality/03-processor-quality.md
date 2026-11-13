# 03: Processor quality

## Problem

The processor's output on the first 60 jobs isn't reliable enough to match on, and its review flag is too noisy to show which jobs need a look.

- **`needsReview` is set on 59 of 60 jobs.**
  - It's true when any fact the matcher reads is `unsure`, a verification dropped a field, or any opening is `unsure`.
  - Openings built from the listing are `unsure` by construction, and `engagement` is `unsure` on 44 of 60.
  - So the flag fires on almost every job, and a job that really needs a look can't be told apart.
- **Facts the verifier dropped:** `engagement` on 29 jobs, `roleKind` on 3, `contractType` on 2, `seniority` and `isSoftwareEngineeringRole` on 1 each.
- **Facts marked `unsure`:** `junkFlags` on all 60, `seniority` on 42, `position` on 26, `isSoftwareEngineeringRole` on 16, `requiredLanguages` on 14, `arrangement` on 11.
- **No tech stack on 29 of 60.** The stack check is then `unknown`, and it can't reject.
- **No salary on 60 of 60,** although 836 of 4,048 LinkedIn jobs carry salary text.
- **Wrong places from the model.** It quoted "Lieu : Casablanca – Centre-ville" and still produced a Worldwide opening.
- **Cost:** about $0.0084 per job, eight times the collection price per job ($0.001).

The user is rebuilding processing and matching, so this slice feeds that rebuild rather than patching the current processor.

## From slice 02 (listing facts)

This slice runs right after 02 _(user)_. What 02 leaves it:

- **The prompt is description-only.** 02 removes the listing metadata block, the "listing as a last resort" opening rule and the listing parts of `resolve-facts`. This slice starts from that prompt.
- **The unsure rate now decides how long the review list is.** In 02, a job that would be rejected only on `unsure` facts goes to the user's review list instead. The list must stay the exception, not the norm _(user)_. The unsure values come from the model, not the listing (dev, first 60 jobs):
  - `seniority`: 41 of 60 unsure, all from the generator;
  - `engagement`: 44 of 60 unsure, 29 dropped;
  - `position`: 26 of 60;
  - `isSoftwareEngineeringRole`: 16;
  - `requiredLanguages`: 14;
  - `arrangement`: 11.
- **02's review-share measure** (the share of decided jobs that land in review, per rule) is this slice's target. Each prompt change should show it going down in `processor:eval` and on dev.
- **Out of matching until they're reliable:** `engagement` and `junkFlags`. 02 leaves them unread by the matcher _(user)_. This slice decides whether they come back, or whether `engagement` is worth extracting at all.
- **Contract type is description-only for matching.** LinkedIn's `employmentType` is display only after 02, so an unstated `contractType` stays unknown. On dev, 43 of 60 contract types came from LinkedIn, so the description's own coverage matters more now.
- **Salary:** 02 fills a silent description from LinkedIn's employer-provided salary. Whether descriptions state pay that the model misses (0 of 60 today) is still this slice's question.

## Prerequisites

Before this slice's brainstorm, dev needs a baseline on the description-only prompt:

1. **A working LLM provider.** OpenRouter credit is out. The processor has failed every call with 402 since about 2026-11-09. Interim slice [02b](02b-claude-models.md) moves the engine to `claude -p` first. The first Claude batch is harvestapi's, once Apify has credit again.
2. **The 60 processed jobs archived, not reprocessed.** 02b archives all 4,048 cheap_scraper jobs, the 60 included, and deletes their matches. There is nothing to reprocess before 2026-12-09. The baseline comes from the first harvestapi batch, processed on Claude, once Apify has credit.
3. **Measurements:**
   - `db:match-shares -- --days 7`, for the review share to bring down;
   - `processor:eval`, for the golden set on the description-only prompt.

## Left by slice 02, as built

- **No baseline yet.** On dev, every processed job still has a v2 extraction, and 02b archives them instead of reprocessing them (prerequisite 2). Before this slice's brainstorm:
  - process the first harvestapi batch on Claude;
  - then `db:match-shares -- --days 7`, which gives the review share to bring down;
  - then `processor:eval` on the description-only prompt.
- **Review share: position dominates the estimate.** Applying 02's rules to the 60 v2 jobs, about 7% of decisions land in review, almost all through the position rule.
  - The latent risk is seniority: 29 of 60 state a seniority marked `unsure`, so a profile with a narrow seniority range could send many jobs to review.
  - These numbers come from v2 confidences, which still saw LinkedIn's values, so v3 may differ.
- **Work-authorization requirements are AND-ed.** The prompt has no way to say "or", so "authorized to work in the US or Canada" can come out as two requirements and sure-reject a US citizen.
- **15 golden cases expect no place although the description names one:** 10317, 10372, 1546, 5524, 8262, 5036, 5052, 5148, 5797, 7824, 8235, 997, 392, 1748 and 8826. With description-only input, `processor:eval` may now count a correct place as wrong.
- **`needsReview` still feeds the Unverified badge,** and the matches page can't say why, because `match_details` doesn't return the flag.
- **An unsure whole `techStack` fact** makes every stack outcome unsure, which sends stack failures on that job to review. Dev had 0 of 60 like this.
- **Wrong-but-sure contract types now reject on their own.** Seen on dev:
  - "Fullstack Java/Angular - Sénior" tagged `internship/sure`;
  - "Quantitative Developer (Graduates…)" tagged `volunteer/sure`.
- **Posting language comes out `unknown` more often** after the stricter 0.06 margin. Watch the unknown rate on real postings.
- **Salary:** a job that states no salary, against a profile with a minimum, is `unknown` and marks the match Unverified. Most postings state no salary.

## Open questions

- What should `needsReview` mean: "a fact the matcher relies on is doubtful", or "a human should look"? Which facts count?
- Why does no stack come out on half the jobs: no stack in the text (non-engineering roles), the description cut short, or a vocabulary miss (terms `proposed`, not approved)?
- Is `engagement` worth extracting at all, given it's dropped or unsure on most jobs and no match rule reads it?
- Should a place the model produced be checked against its own quote by code: a city in the quote, but Worldwide in the output?
- Salary: are the text-only salaries parseable, or should they wait for listing salary (02)?
- Does the golden set (`processor:eval`) cover these cases? Without it, a rebuild can't show it improved anything.

## Suggested path

1. Break down the 60 by cause: for each `unsure`, dropped or missing fact, whether the text states it, the model missed it, or the verifier rejected a right answer.
2. Add the cases that failed to the golden set, Casablanca → Worldwide among them.
3. Redefine `needsReview` around the facts the matcher reads, after 02 removes listing openings from the prompt.
4. Fix the largest causes first. Measure each change with `processor:eval` and the cost per job.

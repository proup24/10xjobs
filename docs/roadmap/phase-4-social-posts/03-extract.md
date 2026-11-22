# 03: Extract

## Goal

A Claude step reads each prepared post and pulls out its facts: role title, stack, seniority, arrangement, location, company, the contact email and the apply link. A fact the post doesn't state stays empty. Nothing is guessed.

## What already exists (on `main`)

- The job-board processor: a Claude step through `claude -p` that turns a listing into a validated facts document, with a golden set and `processor:eval` to measure it (`apps/xjobs/src/modules/processor/README.md`).

## What slice 02 hands over

- A cleaned copy of each post that wasn't dropped, its author, and its links already sorted without Claude: email addresses, LinkedIn job links, Ashby or Greenhouse postings, other links.
- For a share, both the sharer's added text and the original post (text, author, date). The added text may hold the only contact email, or say the role is filled.
- Exact duplicates already merged, so each distinct post is extracted once.

## Decided (2026-11-21, slice 02 brainstorm)

- **Extract gives a "not hiring" verdict** _(user)_, the second line of defence behind Prepare's light filter. It also feeds the automatic silenced-author list: an author whose posts keep being judged not hiring is silenced engine-wide past a threshold, which slice 02's spec defines and this slice switches on.
- **Extract also gives an "aggregator / lead-gen" verdict** _(user, 2026-11-22, from labelling slice 02's sample)_. These posts say "we're hiring" but aren't a real opening. They have no clear employer, list many roles across companies or places, funnel readers into courses, training or placement, or send them to a WhatsApp or Telegram group. Examples are in slice 02's labelled sample (`apps/xjobs/src/modules/ingest/normalize/posts/sample/sample.json`, notes starting `owner:`): #16, #63, #81, #86 and #106 are labelled not hiring, and #11, #13 and #32 are labelled unsure. Cheap Prepare rules can't tell them apart, because posts the owner kept as hiring carry the same signals (role lists, group links), so this verdict belongs here. Its reason is recorded like any qualify decision, and it feeds automatic silencing like "not hiring": these authors post repeatedly.
- **The silenced check goes after the 7-day window.** Apply slice 02's `silencedPostJobSql` (`ingest/repositories/silenced-authors.repository.ts`) after the first-seen-within-7-days filter in the processor's scope, and check its query plan there.
- **How the author asks to apply is one of: email, external apply link, LinkedIn job board link, or "connect / DM me / comment"** _(user, from the social posts page decision in the README)_. The email kind is applied to automatically; the others are shown as matches to act on by hand.

## In scope

- Extraction for posts, including the facts only posts need: the contact email, how the author asks to be contacted (the four kinds above), and the company when the author isn't the employer.
- The "not hiring" verdict, with a reason, and switching on the automatic silenced-author adds.
- A post that announces several roles.
- A golden set of real posts and an eval, like the processor's.
- **Claude quota:** Prepare drops only near-certain junk, so most collected posts (about 500 a day for the owner's profile alone) reach this step. Quota is the owner's main worry, so this slice needs a guard, e.g. a daily cap on post extractions, and a measure of the calls a day costs.

## Out of scope

- Matching against profiles (slice 04).
- Writing the email (slice 05).

## Open questions

- Reuse the job-board processor with a post prompt, or a separate step? (See "Suggested direction" in the README.)
- Is the email address valid only when the post names it as the way to apply, or whenever an address appears? (Prepare notes every address; telling an apply address from "press: media@…" is this step's job.)
- How should a post naming several roles be represented: one job per role?
- Which bar on the golden set must Extract pass before slice 05 can send anything automatically?
- What happens to posts past the daily cap: queued for the next day, or oldest dropped?

# 03: Extract

## Goal

A Claude step reads each prepared post and pulls out its facts: role title, stack, seniority, arrangement, location, company, the contact email and the apply link. A fact the post doesn't state stays empty. Nothing is guessed.

## What already exists (on `main`)

- The job-board processor: a Claude step through `claude -p` that turns a listing into a validated facts document, with a golden set and `processor:eval` to measure it (`apps/xjobs/src/modules/processor/README.md`).

## In scope

- Extraction for posts, including the facts only posts need: the contact email, how the author asks to be contacted (email, DM, comment, link), and the company when the author isn't the employer.
- A post that announces several roles.
- A golden set of real posts and an eval, like the processor's.

## Out of scope

- Matching against profiles (slice 04).
- Writing the email (slice 05).

## Open questions

- Reuse the job-board processor with a post prompt, or a separate step? (See "Suggested direction" in the README.)
- Is a "not actually hiring" verdict here a second line of defence behind Prepare?
- Is the email address valid only when the post names it as the way to apply, or whenever an address appears?
- How should a post naming several roles be represented: one job per role?
- Which bar on the golden set must Extract pass before slice 05 can send anything automatically?

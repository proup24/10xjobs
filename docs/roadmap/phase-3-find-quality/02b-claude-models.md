# 02b: Models on Claude (interim)

## Problem

The processor has been down since about 2026-11-09. Its OpenRouter credit ran out, and every call since has failed with 402. Slice 03 can't start without a working processor (see its prerequisites). This interim slice replaces OpenRouter before 03.

## Decisions so far _(user, 2026-11-13)_

- **`claude -p` (Claude Code, headless) on the user's Claude subscription becomes the engine's permanent way of calling models.** This is not a stopgap until API credit returns. OpenRouter leaves the engine.
- **It runs on the hosted engine on Hetzner**, for every scheduled processor run. It doesn't run on a machine started by hand.
- **Same two-step processor shape, on Claude.** The generator extracts the facts, then the verifier checks them. Both steps run on Claude. Which model plays each role stays configuration.
- **Usage limits: pause and retry.** When Claude's usage limit is hit partway through a batch, the waiting jobs stay waiting. They are retried after the limit resets. They are not failed, and their attempts are not used up.
- **Old cheap_scraper jobs are archived, not processed.** The ~3,988 pending jobs collected through the old actor (cheap_scraper) must not be processed automatically by the first batch once Claude is live. Archive them, so they leave the processor's queue, before the switch.

## Open questions (for this slice's brainstorm)

- **Subscription terms and limits.** A Claude subscription is tied to one person's account. Does running a shared, multi-tenant engine on it fit its terms? What throughput do its limits allow per day, measured in jobs?
- **What survives.**
  - Which parts stay exactly as they are: the prompts, the description-only input, the strict extraction schema, quote checks, regeneration, `needsReview`, the golden set and `processor:eval`?
  - What replaces the verifier's Decisions API: one `claude -p` call per question, or one call answering a structured list?
  - How does `claude -p` return output that must validate against the strict JSON schema, and how is a malformed answer retried?
- **Budget and accounting.**
  - What replaces `PROCESSOR_DAILY_BUDGET_USD` and the per-job dollar pricing: a job count per window, a token count, or nothing?
  - How is cost or usage recorded per run, so slice 03 can still compare prompt changes?
- **The hosted engine.**
  - How is Claude Code installed in the engine image?
  - How is it logged in without SSH? A long-lived token from `claude setup-token`, as a secret in the deploy workflow?
  - What happens when that token expires?
- **Concurrency.** How many `claude -p` processes can run at once (`PROCESSOR_CONCURRENCY`), given the subscription's limits and the box's memory?
- **Isolation.** Each call must be a bare model call:
  - no tools;
  - no reading the engine's filesystem;
  - no project `CLAUDE.md` or settings picked up;
  - no session history carried between jobs.
- **Detecting the limit.** How does the engine tell "usage limit reached, resets at T" from other failures? Where does it park waiting jobs until T: a delayed BullMQ job, or a processor-wide pause?
- **Archiving the old jobs.**
  - Is it a new processing status (for example `archived`), or out-of-scope by channel or source?
  - Can they be un-archived later by hand?
  - Does `db:reprocess` skip them?
- **Reprocess order.** After the switch, how do the 60 processed jobs (slice 02's reprocess) and new harvestapi jobs get ahead of anything else? See slice 03's prerequisites.
- **Tests and eval.** How is `claude -p` faked in unit and e2e tests? Is `processor:eval` run against Claude once before the switch, to compare with DeepSeek and Jev on the golden set?

## Not in scope

- Prompt or schema changes for quality. Those are slice 03.
- Processing the old cheap_scraper backlog.
- Other model users outside the processor. None exist today; check during the brainstorm.

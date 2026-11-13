# 02b: Models on Claude (interim)

## Problem

The processor has been down since about 2026-11-09. Its OpenRouter credit ran out, and every call since has failed with 402. Slice 03 can't start without a working processor (see its prerequisites). This interim slice replaces OpenRouter before 03.

## Decisions so far _(user, 2026-11-13)_

- **`claude -p` (Claude Code, headless) on the user's Claude subscription becomes the engine's permanent way of calling models.** This is not a stopgap until API credit returns. OpenRouter leaves the engine.
- **It runs on the hosted engine on Hetzner**, for every scheduled processor run. It doesn't run on a machine started by hand.
- **Generator only, on Claude.** The processor has no verifier. One Claude call extracts the facts. The model is configuration (`PROCESSOR_EXTRACTION_MODEL`, Sonnet 5.5 to start).
- **Usage limits: pause and retry.** When Claude's usage limit is hit partway through a batch, the waiting jobs stay waiting. They are retried after the limit resets. They are not failed, and their attempts are not used up.
- **Old cheap_scraper jobs are archived, not processed.** All 4,048 jobs collected through the old actor (cheap_scraper) are archived with `db:archive-actor`, before the switch, so they leave the processor's queue. Their matches are deleted, and a new sighting un-archives a job.
- **Subscription for dogfooding only.** Before any other person gets an account, the engine moves to an Anthropic API key. The roadmap README records this gate.

## Status

Built. The design is `docs/superpowers/specs/2026-11-13-claude-models-design.md`. The first Claude batch is harvestapi's, once Apify has credit again.

## Open questions (resolved)

The brainstorm answered all of these; the answers are the Decisions of the design spec (`docs/superpowers/specs/2026-11-13-claude-models-design.md`). They stay here as the record of what was asked.

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
  - Can they be un-archived later by hand? _Resolved: no; only a newer ingest sighting un-archives a job._
  - Does `db:reprocess` skip them?
- **Reprocess order.** After the switch, how do the 60 processed jobs (slice 02's reprocess) and new harvestapi jobs get ahead of anything else? See slice 03's prerequisites. _Resolved: nothing is reprocessed. The 60 are archived with the other cheap_scraper jobs, and slice 03's baseline comes from the first harvestapi batch._
- **Tests and eval.** How is `claude -p` faked in unit and e2e tests? Is `processor:eval` run against Claude once before the switch, to compare with DeepSeek and Jev on the golden set?

## Not in scope

- Prompt or schema changes for quality. Those are slice 03.
- Processing the old cheap_scraper backlog.
- Other model users outside the processor. None exist today; check during the brainstorm.

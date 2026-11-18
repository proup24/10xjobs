# cheap_scraper at 1 GB: design (short)

Roadmap: slice 07, `docs/roadmap/phase-3-find-quality/07-trial-linkedin-actors.md`. Follows `2026-11-18-trial-linkedin-actors-design.md`.

## Intent

cheap_scraper's first trial tick (2026-11-18 15:00 UTC) cost $1.03 for 21 runs: $0.42 of start fees and $0.62 of rows. Its Apify start fee is $0.005 per GB of run memory, and it ran at its default 4 GB, so every run paid $0.02 before returning a row (each zero-row run on dev cost exactly $0.020). At 1 GB the start fee is $0.005, saving about $0.75 over a 50-search tick. The row price doesn't change.

## Goals

- cheap_scraper runs at 1024 MB.
- The run config can carry a memory size, so a later trial actor can set its own.

## Non-goals

- harvestapi, LinkedIn posts, Greenhouse and Ashby runs: unchanged, no memory sent (Apify uses each actor's default).
- The schedule, window, searches and caps.

## Approaches

- **Memory in the run config** (picked): an optional `memoryMbytes` on `ActorRunConfig`, set to 1024 in `LinkedinJobBoardCheapCollector.config` and passed to `actor.run`. `ApifyStartOptions.memoryMbytes` already exists and reaches Apify's `memory` option.
- Memory as a collector constant: works, but the next trial actor would repeat it, and the config is where its other run limits live.
- Changing the actor's default in the Apify Console: not possible for a public actor we don't own.

## Design

- `ActorRunConfig.memoryMbytes?: number`, documented as the run's memory in MB (Apify charges a start fee per GB for some actors); absent means the actor's default.
- `LinkedinJobBoardCheapCollector.config.memoryMbytes = 1024`, and `collect` passes `{ maxChargeUsd, memoryMbytes }`.
- The collector spec asserts the 1024 MB option.

## Rollout

1. Before turning the trial back on, the user runs cheap_scraper once in the Apify Console with Memory = 1024 MB and one of our search URLs, and checks that it returns jobs and finishes in normal time.
2. Merge, deploy. The trial stays off until the user switches it on.
3. First tick back on: zero-row cheap runs cost $0.005.

## Left to the builder

Nothing.

# 01: Actor sample

Status: done. Run on 2026-11-22 (Sunday window, $0.0884) and re-run on 2026-11-24 (weekday window, $0.1745). **Go, with valig as the `INDEED` actor** _(user, 2026-11-25)_. Results: [docs/actors/indeed-actor-sample.md](../../actors/indeed-actor-sample.md).

## Goal

Pick the Apify actor the `INDEED` channel is built on, from a small paid sample of 3–4 shortlisted actors run on the same searches, before any channel code is written _(user: "sample the actors first")_.

## Gate

This slice is a go/no-go gate for the phase _(user)_: if no actor gives full descriptions and a stable Indeed job id at a cost per qualified job not clearly worse than harvestapi's, the phase stops here. A missing apply link is not a stop.

## Why

Apify lists dozens of Indeed actors at very different prices ($0.03 to $5 per 1,000 results, 2026-11-22), and the price per result isn't the whole cost: cheap_scraper's LinkedIn trial taught us that a start fee per run can dominate (Phase 3 slice 07). The fields matter as much as the price: without the employer apply link, slice 05 can't prove duplicates.

## What exists

- `db:split-check` (Phase 3 slice 08): a paid, maintainer-only one-off with a `--dry-run` that prints the reserved spend, and a hard cap. The sample follows the same shape.
- `ApifyProvider` and its start options (`memoryMbytes`, charge limits), `collectors/providers/apify/`.
- Notes on actors kept in `docs/actors/`.

## In scope

- A shortlist of 3–4 actors, from Apify's store, checked on paper first: pricing (per result and per run start), input (keyword, country site, remote filter, `fromage`), maintenance state, and whether login cookies are needed (ruled out, like curious_coder).
- A script that runs each shortlisted actor on the same few searches (for example the owner's stack in US remote, UK remote and Morocco on-site, last 24 hours), under one reserved cap of about $1, `--dry-run` first. Raw results are kept for slice 04's mapper.
- A short written comparison per actor: rows returned, distinct jobs, overlap between actors, real cost per run and per 1,000 jobs, and field coverage:
  - employer apply link, resolved past Indeed's redirect (wanted, not decisive: most Indeed jobs are Easily apply and have none, _user_)
  - full description text
  - posted time (exact or relative)
  - company, place, remote flag, salary, job type
  - Indeed job key (`jk`), for repeat sightings
- The pick, recorded in `docs/actors/` with the reasons.

## Out of scope

- The channel itself (slice 03) and the ingest mapper (slice 04).
- Running two actors side by side on a schedule (possible later, as a trial channel).

## Verdict (2026-11-25)

- **Go** _(user)_. The gate passes for valig, curious_coder and kaix. memo23 fails on cost (2.8× harvestapi's cost per relevant job).
- **The pick: valig** _(user)_. curious_coder, which returns mostly the same jobs at about the same cost, is the candidate for a later trial channel.
- **Weekday volume:** valig found 81 relevant US remote jobs in 24 hours, curious_coder 73, both stopped by the 100-row cap. Harvestapi found 524 on 2026-11-23. UK remote (1) and Morocco on-site (4) stay thin.
- **Cost:** about $0.00017 per relevant job on valig, against harvestapi's $0.00152.
- **Dev overlap:** 1 proven and 1 likely per actor. The rest are jobs the other channels didn't bring.
- **Filters:** location `Remote` is the only remote search to trust. kaix's filter lost 100% again, and memo23's lost 58%.
- **For slice 03:** the US remote search needs a row cap above 100. The merged keyword lets more wrong jobs through on a weekday (78% relevant on valig's US rows), so the matcher carries the rest.

## Findings (2026-11-22 run)

- **Gate:** valig, kaix and curious_coder pass. memo23 fails on cost (2.7× harvestapi's cost per relevant job). Pick order: curious_coder, valig, kaix (provisional).
- **Volume is the open question:** at most 13 relevant US remote jobs in Indeed's 24-hour window (Saturday to Sunday), against harvestapi's 536 on 2026-11-19, a Thursday. Indeed itself ran out of results on every search.
- **Dev overlap is 0:** none of the sampled jobs is on dev.
- **Filters:** kaix's remote filter (rich mode) is not trusted (measured). It returned old on-site jobs near the proxy. Location `Remote` works on every actor.
- **Next (then):** a weekday re-run of the same 27 runs, with kaix's core remote searches on location `Remote`. It ran on 2026-11-24 (verdict above).

## Open questions

- ~~For the jobs that do link out, is resolving Indeed's redirect ourselves (one request per job) acceptable if the actor doesn't?~~ Not needed: valig and curious_coder return the resolved employer link on 78% of rows, memo23 on 87%. The rest point back to Indeed.
- ~~Does any actor charge a large per-run start fee?~~ No. The highest is memo23's $0.007. It dominates memo23's cost when a search returns few rows. The others are $0.0009 or less.
- ~~How do actors handle Indeed's result cap per search?~~ Indeed's ~1,000 cap wasn't reached. On the weekday, the US real keyword filled the run's own 100-row cap; slice 03 sets the cap per search.

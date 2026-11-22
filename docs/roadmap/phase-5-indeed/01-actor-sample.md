# 01: Actor sample

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

## Open questions

- For the jobs that do link out, is resolving Indeed's redirect ourselves (one request per job) acceptable if the actor doesn't?
- Does any actor charge a large per-run start fee? With 5+ markets and several searches per tick, that decides the cadence in slice 03.
- How do actors handle Indeed's result cap per search (pages of 15, often ~1,000 results max)?

# 07: Tech-hub markets

## Goal

Agree on the full list of Indeed main markets worldwide: the tech-hub countries in every region, not only the starting five _(user: "a separate session to nail down the tech hub countries in all regions worldwide")_.

## Why its own session

The starting list (US, Brazil, Poland, UK, Canada) came from where the user's applied LinkedIn jobs were listed. It misses regions LinkedIn underserves: Asia, and European countries such as the Netherlands where Indeed is used more than LinkedIn _(user)_. Each market adds a run per tick, so the list is a cost decision as much as a coverage one.

## What exists

- Slice 03's market list as data: adding a market is a row plus `db:regenerate`.
- Slice 06's per-market counts, once Indeed has run for a while.

## In scope

- A worldwide pass over regions (North America, Latin America, Europe, Middle East and Africa, Asia-Pacific), each with candidate countries, whether Indeed has a site there, and evidence that remote engineering roles open to the users' places are listed there.
- The agreed list and its order (what gets skipped first when the cap runs out).
- How a market is later dropped: a rule on slice 06's numbers.

## Out of scope

- Expanding a profile's regions into countries (ruled out in the phase decisions).

## Open questions

- Is a market's search language a problem (Japanese, German, Dutch postings)?
- Does every market run every tick, or do smaller markets run less often?

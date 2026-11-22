# 06: Channel compare report

## Goal

A read-only report that answers the keep-or-drop test: does Indeed add qualified jobs the user applies to, that the other channels didn't already bring _(user)_?

## What exists

- `db:actor-compare` (Phase 3 slices 07 and later): compares LinkedIn actors per Morocco day and in total, counting overlap only on cells both ran, with cost per qualified job, outcomes and decisions per group, and field coverage.
- `db:place-coverage`: jobs only one place finds, with their best match outcome.

## In scope

- Per channel (LinkedIn job board, Indeed, Greenhouse, Ashby; posts optional), over a period:
  - jobs, qualified jobs and applied jobs;
  - **jobs only that channel found**, with qualified and applied counts (the deciding numbers);
  - proven and likely overlap with each other channel, and lead time (who saw it first);
  - cost, and cost per qualified and per applied job.
- Per Indeed market: the same counts, so slice 07's list can be judged.
- Comparing channels fairly: they search differently (LinkedIn regions vs Indeed markets), so the report states what each channel searched in the period.

## Out of scope

- A web page for it (it's a maintainer script, like the other reports).
- Changing collection based on it.

## Open questions

- A new script or an extension of `db:actor-compare`?
- Which period is long enough to judge (the trial runs until the user decides)?
- Is "applied" counted per user or for the owner only during the trial?

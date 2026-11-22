# Phase 5: Indeed

Date: 2026-11-22
Status: brief (brainstormed 2026-11-22)

## Intent

10xjobs should be a multi-channel engine: more of the right jobs, from more places. Indeed is the next channel. Many jobs never reach LinkedIn, and some markets (the Netherlands, much of Asia) lean on Indeed more than LinkedIn _(user)_.

We don't assume Indeed is worth it. This phase has to prove what Indeed adds: which jobs only Indeed finds, where it overlaps with LinkedIn, Greenhouse and Ashby, and which Apify actor gives the best Indeed results _(user)_.

**Keep-or-drop test** _(user)_: Indeed stays if it adds qualified jobs the user applies to, that the other channels didn't already bring. Applied marks are the deciding number. Volume, overlap and cost per qualified job are supporting evidence.

The project's anti-goals apply in full. Indeed's keyword search is looser than LinkedIn's, so the wrong jobs must still be rejected with a reason, and duplicates must never hide a real second role.

## How this folder works

Same as Phases 1 to 4: each slice is a short brief covering the goal, what exists, what's in and out of scope, and the open questions. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs. Slices are built in order unless a brief says otherwise.

## Slices

| #   | Slice                                                    | Status |
| --- | -------------------------------------------------------- | ------ |
| 01  | [Actor sample](01-actor-sample.md)                       | Brief  |
| 02  | [Indeed switch](02-indeed-switch.md)                     | Brief  |
| 03  | [Collect](03-collect.md)                                 | Brief  |
| 04  | [Ingest, process and match](04-ingest-process-match.md)  | Brief  |
| 05  | [Cross-source duplicates](05-cross-source-duplicates.md) | Brief  |
| 06  | [Channel compare report](06-channel-compare.md)          | Brief  |
| 07  | [Tech-hub markets](07-tech-hub-markets.md)               | Brief  |

**Slice 01 is a go/no-go gate** _(user)_: if no shortlisted actor gives usable data at a sane cost, the phase stops before any channel code. Usable means full descriptions and a stable Indeed job id; sane means start fees that don't make cost per qualified job clearly worse than harvestapi's. A missing employer apply link is not a stop: most Indeed jobs are Easily apply and have none anyway _(user)_.

07 is its own session, held whenever the user wants; it needs only slice 03's market list to exist, and until then the starting five markets run.

## The pipeline

Indeed jobs are listings, so they take the LinkedIn job-board path, not Phase 4's post path _(user: "I see it working like the LinkedIn job board")_:

1. **Collect** (03): searches built from each published profile that has Indeed on, run on the hosted schedule through the chosen Apify actor, under a daily cap.
2. **Prepare** (04): ingest's Indeed mapper normalizes each item (clean description, company, place, posted time, salary, apply link) and dedupes repeat sightings.
3. **Extract** (04): the existing processor reads each job with `claude -p` and writes the same facts it writes for LinkedIn jobs.
4. **Match** (04): the existing matcher decides qualified, review or rejected, with a reason, against each profile, with the same rules.
5. **Show** (04, 05): Indeed matches appear in the existing matches view with an Indeed source label; likely duplicates of other channels' jobs are shown together.
6. **Judge** (06): a read-only report compares Indeed with the other channels.

## Decided

- **Runs alongside Phase 4, not after it** _(user)_. The two touch the same profile switch code, so slice 02 builds a shared per-profile channel switch that Phase 4's slice 04b reuses when it removes the post search allow-list; whichever lands first builds the shared part, and the other adopts it.
- **Phase 5 is Indeed** _(user)_. Apply moves to Phase 6, and Track and report to Phase 7.
- **Works like the LinkedIn job board** _(user)_: searches from the profile, scheduled collection, the same processor and matcher, matches in the existing view.
- **A per-profile "Search Indeed" switch in preferences, open to every user, with no allow-list env var** _(user: "like we did for LinkedIn social posts, without the user id env var")_. Off by default, attaches and detaches the profile's Indeed searches, and `db:regenerate` and `db:publish-drafts` respect it _(my proposal)_. Slice 02.
- **Places** _(user picked option C)_:
  - On-site and hybrid: the countries a profile names, on their Indeed country site (Morocco has one, ma.indeed.com).
  - Remote: one remote search per **main market**, for every profile with Indeed on, whatever regions the profile names. A remote job's listing country is rarely where the candidate lives: of the user's ~120 applied jobs (all from LinkedIn, dev, 2026-11-22), the largest shares were listed in the US (~26%) and Brazil (~15%).
  - **Starting main markets: US, Brazil, Poland, UK, Canada** _(user)_, about 60% of the user's applied jobs. More regions and countries (Asia, the Netherlands and other European countries where Indeed is stronger) come in slice 07, its own session _(user)_.
  - The market list is data the engine reads, not code, so adding a market is a row and a `db:regenerate` _(my proposal)_.
  - Regions a profile names are never expanded into country lists.
- **Duplicates: merge only on proof; group likely ones** _(user picked option C)_:
  - Proof is the same employer apply link or the same Ashby or Greenhouse posting: the existing `ats:` / `url:` job key. Those merge into one job, as today.
  - A likely duplicate (same company, title and country, no shared link) stays a separate job, but the matches view shows the pair together, e.g. "also on LinkedIn". Nothing is merged on a guess, so a second role with the same title is never hidden.
  - The report counts both proven and likely overlap. Slice 05.
- **Actor: sample first, then one channel built so a second actor slots in** _(user picked option C)_:
  - A one-off paid script runs 3–4 shortlisted Indeed actors on the same few searches, capped (about $1) and dry-run first, like `db:split-check`. Slice 01.
  - The winner becomes the `INDEED` channel. The channel is built the slice 07 (Phase 3) way, so a later Indeed actor can run beside it as a trial channel with only its channel value, input builder, output mapper and config.
  - The sample checks whether an actor returns the employer apply link, not only Indeed's redirect, because only that link proves a duplicate. It isn't decisive: most Indeed jobs are Easily apply with no employer link _(user)_, so most overlap will be counted as likely, not proven.
- **Indeed's newest date filter is the last 24 hours** (`fromage=1`; found 2026-11-22, from vendor docs). There is no one-hour window, so Indeed can't copy LinkedIn's hourly ticks; slice 03 settles the cadence and pays for repeat rows.

## Exit criteria

- A user can turn Indeed on or off per profile in preferences, with no allow-list.
- The hosted engine collects Indeed jobs for every profile with Indeed on, on a schedule and under a daily cap, through the actor slice 01 picked.
- Indeed jobs are processed and matched with the same rules and reasons as LinkedIn jobs, and qualified ones show in the matches view with an Indeed label. Rejected ones can be checked with their reasons.
- A job proven to be the same posting as another channel's is one job; a likely duplicate is shown beside its pair.
- The channel compare report answers the keep-or-drop test: qualified and applied jobs only Indeed found, proven and likely overlap per channel, cost per qualified job, per market.
- After a trial period the user decides to keep Indeed on or switch it off (the decision itself is outside the build).

## Out of scope for this phase

- Indeed's own "Easily apply" flow, or applying on Indeed at all (Phase 6 territory).
- Indeed company pages, salaries pages and reviews.
- Merging likely duplicates on a guess.
- Expanding a profile's regions into countries.
- Per-user spend shares (only invited users exist; revisit with Phase 4's slice 04b).
- Other new channels (Glassdoor, Wellfound, …): each would be its own phase or slice, and should reuse this phase's channel compare report.

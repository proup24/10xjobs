# 05: Cross-source duplicates

## Goal

The same role found by Indeed and another channel never shows as two unexplained jobs, and no real second role is hidden _(user picked "merge only on proof")_.

## Decided

- **Proven duplicates merge:** the same employer apply link or the same Ashby or Greenhouse posting, i.e. the existing `ats:` / `url:` job key. They become one job, and decisions and views move as today (`moveDecisions`, `moveViews`).
- **Likely duplicates are grouped, not merged:** same company, title and country, with no shared link. They stay separate jobs; the matches view shows them together, for example "also on LinkedIn".
- **Both kinds are counted** for the channel compare report (slice 06).

Most Indeed jobs are Easily apply and have no employer link _(user)_, so proof will be rare and likely-duplicate grouping carries most of this slice.

## What exists

- `linkJob` and merging by job key (`ingest/repositories/jobs.writer.ts`).
- Phase 3 slice 06 (one job per apply link): canonical apply URLs.
- The match reads return each job's distinct source channels.

## In scope

- Resolving the employer apply link for Indeed jobs, if slice 01's actor doesn't do it.
- A likely-duplicate rule and where it's stored (a link between two jobs, never a merge).
- Showing grouped jobs in the matches view, and what a user's decision on one does to the other (proposal: nothing, so each stays its own decision).
- Not limited to Indeed: the rule pairs jobs across any two channels.

## Out of scope

- Merging on a guess.

## Open questions

- How company names are compared across channels (Indeed's company names vs LinkedIn's).
- How close titles must be ("Senior Backend Engineer" vs "Sr. Backend Engineer (Node)").
- Time limit: is a job seen 60 days apart still a likely duplicate, or a repost?
- Does grouping apply to rejected jobs too?

# 04: Ingest and qualify

## Goal

An extracted post becomes a job and is decided against each published profile as qualified, review or rejected, with a reason. The web app shows them on the social posts page (slice 04a).

## What already exists (on `main`)

- The matcher, with its rules for position, seniority, location, stack, languages and work authorization, and a reason on every decision.
- The matches and rejected views in the web app, and job decisions (applied, not for me, expired).

## In scope

- Posts taking part in matching, with the same rules and reasons as listings.
- Only profiles with post search on are matched against posts (from slice 01).
- **Per-user blocked authors** _(user, 2026-11-21)_: a post by an author the user blocked is never a match for that user, with a recorded reason. The list itself and its page are slice 04a's.
- **A share of an old post:** Prepare records the original post's date; the matcher weighs it, the way the job board weighs listing age. Prepare never drops on age.
- A post and a listing for the same job, for example a post linking to an ATS posting or a LinkedIn job board listing: linked, never matched twice. Prepare already sorts these links out of the post.

## Out of scope

- The social posts page and the blocked-authors page (slice 04a).
- Sending email (slice 05).

## Open questions

- Do posts need any rule of their own, for example a stricter one, because a qualified post sends an email with no human step?
- How are facts a post often leaves out (seniority, arrangement, place) treated? Today an unknown fact never rejects, which is risky when a match sends an email automatically.
- **A post linking a job board listing or an ATS posting** (from the slice 02 brainstorm): social posts have their own page, so joining the post into the existing job would pull it off that page. Show it on the social posts page and mark the job-board copy as the same job, or keep only one of the two?
- How old may a shared post's original be before it stops qualifying?

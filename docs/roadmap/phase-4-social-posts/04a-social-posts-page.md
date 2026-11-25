# 04a: Social posts page

## Goal

Social post matches have their own page in the web app, apart from job-board matches, and each user can block authors they never want to see or email.

## Why

Decided in the slice 02 brainstorm _(user, 2026-11-21)_: matches are separated by source, starting with social posts. Posts carry what listings don't (the author, the original post, how to apply), and the ones with an email are applied to automatically, so they need a view of their own.

## What already exists (on `main`)

- One matches view and a rejected view for every source, and job decisions (applied, not for me, expired).
- Preferences pages per profile, built from `components/ui` per `apps/web/DESIGN.md`.

## In scope

- **The matches page gets sub-pages when post search is on** _(user, 2026-11-25, slice 04 brainstorm)_: one for job-board listings, one for social posts, never mixed. Slice 04 hides post matches from today's views until this slice adds the posts sub-page.
- **The social posts sub-page**, with two views _(user)_:
  - **Matches:** every post match the user acts on by hand: "connect / DM me / comment" posts (with links to the post and the author), external apply links, and links to a LinkedIn job board listing.
  - ~~Applied~~ _(replaced 2026-11-25, slice 04 brainstorm)_: an emailed post is an `applied` decision and shows in the existing **Applications** page, not in a tab of its own.
- Each post match shows its facts, the original post (and for a share, the sharer's text), the author, how to apply, and why it matched.
- **A Junk tab** next to Matches and Disqualified _(user, 2026-11-22, slice 03 brainstorm)_: the posts Extract ruled not hiring or junk, with the verdict and its reason, from the user's own searches. The owner watches it to confirm the junk.
- **A review list** for posts whose verdict Extract was unsure of _(user, 2026-11-22)_: not a match, never emailed, like the job board's review outcome.
- Job-board matches stay in today's view, without post matches.
- **Blocked authors, per user** _(user)_: in preferences, the user adds and removes authors (by LinkedIn profile link) for all their profiles. Owned by the user and isolated by RLS. Slice 04 makes it stop matches; slice 05 makes it stop emails.

## Out of scope

- Prepare's drop review and silenced authors (slice 02, owner only).
- Sending email and the record of sent emails (slice 05).
- Separating other sources (job board, ATS) into their own pages: later, after this one.

## Open questions

- Does the Junk tab also show Prepare's drops, which today only the owner sees?

- Where the social posts page sits in the app's navigation, and what it shows before post search is on.
- Can a user block an author straight from a post match, besides the preferences page?
- What Applications shows for an emailable post before slice 05 ships, and before Gmail is connected: "would have emailed"?
- How a post linked to a job-board listing or another post (slice 04's linked group) is shown: "also on the job board", "also posted by …". Post match webhooks: whether they exist and what they carry (slice 04 keeps webhooks listing-only).

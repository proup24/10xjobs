# 04a: Social posts page

## Goal

Social post matches have their own page in the web app, apart from job-board matches, and each user can block authors they never want to see or email.

## Why

Decided in the slice 02 brainstorm _(user, 2026-11-21)_: matches are separated by source, starting with social posts. Posts carry what listings don't (the author, the original post, how to apply), and the ones with an email are applied to automatically, so they need a view of their own.

## What already exists (on `main`)

- One matches view and a rejected view for every source, and job decisions (applied, not for me, expired).
- Preferences pages per profile, built from `components/ui` per `apps/web/DESIGN.md`.

## In scope

- **The social posts page**, with two views _(user)_:
  - **Matches:** every post match the user acts on by hand: "connect / DM me / comment" posts (with links to the post and the author), external apply links, and links to a LinkedIn job board listing.
  - **Applied:** posts with a stated email, applied to automatically. They never show under Matches. Slice 05 fills it; this slice lays it out.
- Each post match shows its facts, the original post (and for a share, the sharer's text), the author, how to apply, and why it matched.
- Job-board matches stay in today's view, without post matches.
- **Blocked authors, per user** _(user)_: in preferences, the user adds and removes authors (by LinkedIn profile link) for all their profiles. Owned by the user and isolated by RLS. Slice 04 makes it stop matches; slice 05 makes it stop emails.

## Out of scope

- Prepare's drop review and silenced authors (slice 02, owner only).
- Sending email and the record of sent emails (slice 05).
- Separating other sources (job board, ATS) into their own pages: later, after this one.

## Open questions

- Where the social posts page sits in the app's navigation, and what it shows before post search is on.
- Can a user block an author straight from a post match, besides the preferences page?
- What the Applied view shows before slice 05 ships, and before Gmail is connected: "would have emailed"?

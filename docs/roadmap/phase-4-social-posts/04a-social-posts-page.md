# 04a: Social posts page

Status: built; the deploy waits on slice 04's. Spec: [posts page design](../../superpowers/specs/2026-11-27-posts-page-design.md). Built in five PRs: `feat/posts-page-db` (PR A), `feat/posts-page-ui` (PR B), `feat/posts-page-rescues` (PR C), `feat/posts-page-blocked` (PR D) and `feat/posts-page-webhooks` (PR E); swap the branch names for PR numbers once opened.

## Goal

Social post matches have their own page in the web app, apart from job-board matches, and each user can block authors they never want to see or email.

## Why

Decided in the slice 02 brainstorm _(user, 2026-11-21)_: matches are separated by source, starting with social posts. Posts carry what listings don't (the author, the original post, how to apply), and the ones with an email are applied to automatically, so they need a view of their own.

Design: [docs/superpowers/specs/2026-11-27-posts-page-design.md](../../superpowers/specs/2026-11-27-posts-page-design.md).

## What already exists (on `main`)

- One matches view (Matches and Review lists) for every source, and job decisions (applied, not for me, expired). No view of rejected matches.
- Preferences pages per profile, built from `components/ui` per `apps/web/DESIGN.md`.
- Slice 04: post roles decided for profiles with post search on, hidden from the web app and webhooks; `blocked_authors` with its rule; linked groups and shared decisions.

## In scope

- **The matches page gets sub-pages when post search is on** _(user, 2026-11-25, slice 04 brainstorm)_: Job board and Social posts, never mixed.
- **Social posts has four tabs, for every user** _(user, 2026-11-27)_: Matches, Review (holds the unsure-verdict posts), Disqualified (rejected post roles with their reasons; social posts only) and Junk (posts Extract ruled not hiring or junk, from the user's own searches).
  - ~~Applied~~ _(replaced 2026-11-25, slice 04 brainstorm)_: an emailed post is an `applied` decision and shows in the existing **Applications** page, not in a tab of its own.
- **Rescue** _(user, 2026-11-27)_: from Junk or Disqualified, a post goes into the rescuer's Matches only, by hand, never re-decided and never emailed, and files a report the owner reads.
- **Email pending** _(user, 2026-11-27)_: an emailable qualified post shows in Matches with this badge until it is actually sent, before and after slice 05.
- Each post shows its facts, the original post (and for a share, the sharer's text), the author, how to apply, why it matched, and its linked copies.
- **Blocked authors, per user** _(user)_: in Preferences and from a post. Slice 04 makes it stop matches; slice 05 makes it stop emails.
- **Post webhooks** _(user, 2026-11-27)_: post matches go to the user's webhook, marked as social posts; an emailable one is held until its email settles (slice 05).
- Slice 04's listing-only filters lifted where posts now show.

## Out of scope

- Prepare's drops review and silenced authors (slice 02, owner only).
- Sending email and the record of sent emails (slice 05).
- Separating other sources (job board, ATS) into their own pages: later, after this one.

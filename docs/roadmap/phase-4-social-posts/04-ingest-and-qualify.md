# 04: Ingest and qualify

## Goal

An extracted post becomes a job and is decided against each published profile as qualified, review or rejected, with a reason. Post matches show in the web app next to listings.

## What already exists (on `main`)

- The matcher, with its rules for position, seniority, location, stack, languages and work authorization, and a reason on every decision.
- The matches and rejected views in the web app, and job decisions (applied, not for me, expired).

## In scope

- Posts taking part in matching, with the same rules and reasons as listings.
- Showing post matches in the web app: the post's facts, the original post, the author, the contact email, and why it matched.
- A post and a listing for the same job, for example a post linking to an ATS posting: linked or merged, never matched twice.

## Out of scope

- Sending email (slice 05).

## Open questions

- Do posts need any rule of their own, for example a stricter one, because a qualified post sends an email with no human step?
- How are facts a post often leaves out (seniority, arrangement, place) treated? Today an unknown fact never rejects, which is risky when a match sends an email automatically.
- How does the web app mark a post match as one that was emailed, or would be?

# 01: Collect

## Goal

Hiring posts for every published profile are collected on the hosted schedule and stored as raw items, at a known and capped cost.

## What already exists (on `main`)

- A query builder for posts: `hiring <title> <stack> <seniority> [remote] [place]` (`queries/channels/linkedin_posts.builder.ts`).
- A collector on `harvestapi/linkedin-post-search`, capped at $0.75 a run and 100 posts per search, and a `worker-linkedin-posts` worker.
- Raw storage and a basic normalizer for posts (`mapLinkedinPost`): post text, posting URL, date, and the author kept separate from the employer.
- None of it has run on `10xjobs-dev`: there are no post batches there (checked 2026-11-19).

## In scope

- Turning post collection on for the hosted engine.
- Checking that the searches find the right posts: real hiring posts for the profile's roles, not job seekers, courses or noise. Tuning the search words if not.
- Cost: what a day of post collection costs per profile, and a cap.

## Out of scope

- Filtering or understanding posts (slices 02 and 03).

## Open questions

- Is `harvestapi/linkedin-post-search` the right actor, or is there a better or cheaper one?
- How far back does each run look, and how often should it run? Hiring posts go stale fast.
- Does the current search phrase find enough posts, and the right ones? Do posts in other languages ("on recrute", "wir suchen") need their own searches?
- Do reposts and the same post found by several searches need anything at this stage, or is that Prepare's job?

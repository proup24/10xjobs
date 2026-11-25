# 02: Prepare

Status: built. Spec: [posts prepare design](../../superpowers/specs/2026-11-21-posts-prepare-design.md). Built in PRs #108, #110 and #116.

## Goal

Clean each raw post and drop the ones that clearly aren't hiring, with cheap rules, before any Claude call. Every dropped post keeps a reason, so a wrong drop can be found and fixed.

## Why

Post search is noisy. Many results are people looking for work, "we're hiring" brand posts with no role, course and bootcamp ads, or reposts. Sending all of them to Claude costs money, and nothing useful comes back.

## In scope

- Cleaning: the post text in a usable form (hashtags, mentions, emoji, "see more" noise), the links in it, and the author.
- Merging duplicates: the same post found by several searches or runs, and reposts or shares of the same post.
- A pre-filter that drops posts that aren't hiring, each with a recorded reason.
- A way to see what was dropped and why.

## Out of scope

- Pulling facts out of the post (slice 03).
- Deciding whether a post fits a profile (slice 04).

## Open questions

- Which signals are safe to drop on without a Claude call? Missing the right posts is an anti-goal, so the filter should lean toward letting posts through.
- Is a repost a new post (new date, new reach) or the same one?
- Should a post with no email and no apply link still go to Extract, so it can still show up as a match in the web app?
- How is the filter's quality checked: a labelled sample of real posts from slice 01?

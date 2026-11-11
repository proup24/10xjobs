# 08: Match on languages

## Goal

A job is matched against the languages the user speaks, two ways _(user)_: the languages the posting **requires**, and the language the posting is **written in**. A job written in German, or one that asks for fluent French, shouldn't reach a user who speaks neither.

## What already exists (on `main`)

- `Profile.languages`: `[{ lang, level }]`, ISO 639-1 codes with `native`, `fluent` or `working`, at least one.
- The v2 extraction's `requiredLanguages` fact: `[{ lang, level, quote }]` with the same codes and levels.
- No extraction field for the language a posting is written in.
- The matcher's open checks list, `MATCHER_VERSION` and `db:rematch` (the matching spec).

## In scope

- **Required languages rule:** each required language is checked against the profile's languages and levels. Not stated: `unknown`, never `fail`.
- **Posting language rule:** the posting's language is found, and a posting written in a language the user doesn't speak is a `fail` or an `unknown`; the spec decides which, with "missing the right jobs" in mind (an English-speaking team can write a local-language ad).
- **Finding the posting language:** a new extraction field from the processor (a schema version bump and `db:reprocess`), or a cheap detector over the description text in the engine. The spec decides; one source either way.
- A `MATCHER_VERSION` bump and a rematch of recent jobs.
- Unit tests per rule, including every `unknown` path, and golden cases.

## Out of scope

- Translating postings.
- Languages in the UI beyond the check's reason (slice 04 shows it).

## Locked

- A fact the job doesn't state never rejects on its own (the matching spec's anti-goal).
- Rules are pure functions in `apps/xjobs/src/modules/matcher/rules/`, like the existing four.
- Every check stores the job's value, the profile's value and a readable reason.

## For the slice spec

- How levels compare (does `working` satisfy a `fluent` requirement? Default going in: no, `native` ≥ `fluent` ≥ `working`).
- Whether a requirement stated as "a plus" counts. Default going in: it doesn't reject.
- What a posting written in two languages means.

## Done when

Recent jobs are re-decided with both language rules, a German-only posting or a fluent-French requirement rejects a profile without them, with a readable reason, and a posting that states nothing about languages is unaffected.

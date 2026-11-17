# 05: Posting language for close languages

Found 2026-11-17 on `10xjobs-dev`. Nothing is specced yet; this brief is the starting point for the brainstorm and spec.

## Problem

A posting written entirely in Spanish qualified for a profile that doesn't speak Spanish. The posting-language rule should have rejected it. Instead it said `unknown` ("posting language not detected with confidence"), and `unknown` never rejects.

Example: job `01a1e588-3689-726e-93cd-e1ac57953e55`, "Programador Junior" at Lesvexa.

- The description is about 1,600 characters of clean Spanish. Its line breaks were lost upstream, so the detector sees one paragraph of 1,573 characters plus a 29-character closing line ("¡Queremos conocer tu talento!").
- Its match is `qualified`:
  - `postingLanguage` is `unknown`.
  - `languages` passes ("job requires no language"). That is correct, because the posting never says Spanish is required, so the processor's `requiredLanguages` is null.
- The posting-language rule is the only one meant to catch this, and it didn't.

## Why the detector gave up

The detector is `detectPostingLanguages` in `apps/xjobs/src/modules/facts/rules/posting-language.ts`, using `franc` 6.2.0, which is pinned. It judges each paragraph on its own and drops a paragraph when the runner-up scores within `MIN_MARGIN = 0.06` of the winner.

On this description, `francAll` gives these scores:

| Language   | Score | With the detector's `only` list (Galician excluded) |
| ---------- | ----- | --------------------------------------------------- |
| Spanish    | 1     | 1                                                   |
| Galician   | 0.988 | excluded                                            |
| Catalan    | 0.972 | 0.972 (runner-up)                                   |
| Portuguese | 0.972 | 0.972                                               |

The margin over Catalan is 0.028, below 0.06, so the only real paragraph is dropped. The 29-character line is under franc's `minLength` and comes back `und`. Less than 200 characters are left detected, so the result is `{ codes: [], confident: false }`.

The margin was raised to 0.06 on purpose in `f719b73` (2026-11-12, "keep mixed-language and close-language postings from a sure posting-language rejection"). The commit's own measurements:

- a paragraph mixing French and English sentences scores the two languages within 0.004 to 0.056;
- a bare list of tool names scores its top two within 0.002.

The same commit stopped detecting Galician, because franc reads European Portuguese as Galician and would have rejected a Portuguese speaker. It also counts `no`/`nb`/`nn` as one language, and `hr`/`sr`/`bs` as one.

The catch: close relatives score within the margin even on long, clean, single-language text. The guard against mixed paragraphs also throws away clear Spanish. Portuguese, Catalan and Italian probably behave the same, and so may Czech/Slovak, Danish/Norwegian/Swedish, and Malay/Indonesian. This hasn't been measured.

## Size on dev (2026-11-17, matcher version 7, one profile)

| `postingLanguage` outcome | Count | Note                                                                                 |
| ------------------------- | ----- | ------------------------------------------------------------------------------------ |
| pass                      | 945   |                                                                                      |
| fail, Spanish             | 68    | Spanish is detected fine on other postings, probably with shorter, varied paragraphs |
| fail, other               | 51    |                                                                                      |
| unknown                   | 113   | none under 200 characters among qualified or rejected                                |

A keyword search of the 113 `unknown` descriptions for `desarrollador|buscamos|estamos|ofrecemos|experiencia|conocimientos` finds 5 that look Spanish:

| Match now                 | Title                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| qualified (wrong)         | Programador Junior                                                                  |
| rejected (on other rules) | Ingeniero DevOps; Data Engineer DataStage; Desarrollador senior Java; Data Engineer |

The search only looks for Spanish words, so it can't find Portuguese, Italian or other languages hiding in the same 113.

## Open questions

- **Close-relative margin.** When the runner-up is a close relative of the winner (Spanish/Catalan/Portuguese/Galician, and so on), should the margin be measured against the nearest _unrelated_ language instead? Or should the margin scale with paragraph length, since long text is more reliable? Either way, a paragraph mixing French and English must still be dropped.
- **Sure-rejection safety.** The anti-goal is missing the right jobs. A Portuguese speaker must not be rejected because franc called a Portuguese posting Spanish or Catalan. Options:
  - Report a close-relative call as "one of {es, ca, pt}" and pass if the user speaks any of them.
  - Fail only when the user speaks none of the language's close relatives.
- **Lost line breaks.** The description's paragraph breaks were lost upstream ("JUNIOREn LESVEXA", "reales.Buscamos"), and the text has literal `\n\n` near its end. Is this the LinkedIn source, `descriptionText` normalization, or the HTML-to-text step? It also defeats the detector's "judge each paragraph" design, because a whole posting becomes one paragraph. Worth checking separately.
- **Which other pairs fail?** Measure on a labelled set before choosing thresholds: a Spanish, Portuguese, Catalan, Italian, Czech, Slovak and Scandinavian posting each, plus the existing mixed French/English and tool-list fixtures.

## Suggested path

1. Build fixtures:
   - this description (line breaks lost, as stored);
   - the same text with its breaks restored;
   - one long clean posting per close-language group above;
   - the mixed-paragraph and tool-list cases behind `f719b73`.
2. Record franc's scores for each fixture and pick a rule that detects every clean single-language fixture while still dropping the mixed ones.
3. Decide how a close-relative call is matched against the user's languages, so a speaker of any close relative is never surely rejected.
4. Bump `FACTS_VERSION` (`apps/xjobs/src/modules/facts/config/facts.config.ts`, now 3). The detector's header comment requires it, because detected languages change. Then rebuild facts and run `db:rematch -- --all`.
5. On dev, check:
   - Job `01a1e588-3689-726e-93cd-e1ac57953e55` moves to rejected with "posting is written in es, which you don't speak".
   - The `unknown` count drops.
   - No new posting-language failure for a language the user speaks.

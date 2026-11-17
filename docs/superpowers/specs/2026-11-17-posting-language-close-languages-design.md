# Posting language for close languages: design

Approved 2026-11-17. Brief: `docs/roadmap/phase-3-find-quality/05-posting-language-close-languages.md`.

## Intent

The posting-language rule should reject a posting written in a language the user doesn't speak, as with Lesvexa's "Programador Junior" (job `01a1e588-3689-726e-93cd-e1ac57953e55`, clean Spanish, came back `unknown`). It must never surely reject someone who speaks the posting's language. Missing the right jobs is the anti-goal.

**Language match is exact.** Catalan isn't Spanish, and Danish isn't Norwegian. Norwegian `no`/`nb`/`nn` is the only exception, because those codes are one language split across the vocabulary.

## What the measurements showed

All measured with franc 6.2.0 and the detector's `only` list. The scripts were throwaway.

- **Long text squeezes franc's margins.**
  - Lesvexa as stored is one 1,602-character paragraph: Spanish beats Catalan and Portuguese by 0.028.
  - Split into sentences, or rebuilt from its HTML, every piece is Spanish by 0.07 to 0.32.
  - A margin that scales with length can't work. Long text would need a smaller margin, and the mixed French/English paragraph (0.026 at 309 characters) falls inside the range of clean close pairs.
- **Results on clean ~500-character paragraphs:**
  - Clear: es, pt (PT and BR), it, ro, fr, cs, sk, pl, sv, de, en.
  - Within 0.06 of the runner-up: ca (vs es, 0.046), da (vs nb, 0.039), nb (vs da, 0.018), nl (vs af, 0.039), id (vs ms, 0.015), and hr/sr/bs (0.001).
  - Malay is read as Indonesian.
- **Results on single sentences:**
  - Malay is read as Indonesian every time, once by a 0.10 margin.
  - hr/sr/bs winners are arbitrary, with margins of 0.00 to 0.03.
  - Danish sentences are sometimes read as Norwegian (margin 0.03), and one Czech sentence as Slovak (0.04).
  - Each wrong winner above is either inside the margin or comes from a pair that is never sure.
- **hr/sr/bs today:** the matcher treats them as one language, but the detector drops every Croatian paragraph first. Croatian postings are never detected.
- **Lost line breaks** come from the LinkedIn actor's own `descriptionText`. `harvest-job.mapper.ts` prefers it over our `htmlToPlainText`. About 105 of the 1,196 dev jobs with HTML block structure have flat or nearly flat text.

## Approaches considered

1. **Margin against the nearest unrelated language, with close relatives passing each other.** Rejected: you ruled the match must be exact.
2. **Margin scaled with length.** Rejected: see the first measurement above.
3. **Fix line breaks in the normalizer only.** Rejected for this slice. It fixes Lesvexa but none of the close pairs. It also changes the text the processor reads, so about 1,200 jobs would go back through the LLM.
4. **Chosen: judge sentences, and let the detector report a close call when it can't separate close relatives.** The matcher keeps languages exact and turns a close call into `unknown` for a speaker of one member.

## Design

### Detector (`facts/rules/posting-language.ts`)

- **Sentence pieces.** After today's paragraph split, cut each paragraph into whole-sentence pieces.
  - Split on `.`, `!` or `?`, followed by optional space and then a capital letter, `¡`/`¿` or an emoji, so flattened text like `reales.Buscamos` splits too.
  - Join a sentence under 50 characters to its neighbour.
  - Each piece is judged on its own. `MIN_PARAGRAPH = 50` and `MIN_MARGIN = 0.06` stay the same.
- **Close-relative groups:** {da, nb, nn}, {id, ms}, {hr, sr, bs}, {cs, sk}, {ca, es}, {nl, af}. Galician stays excluded, as today.
- **Each piece gets one of three calls:**
  - **Sure:** the winner leads every other language by at least the margin. The result is its exact code.
  - **Close call:** the winner leads its group members by less than the margin, but leads every language outside its group by at least the margin. The result is the set of its group members that score within the margin, including the winner.
  - **Dropped:** anything else.
- **Never-sure groups:** pairs franc gets wrong even with a margin are always a close call, never sure. On current measurements that is {id, ms} and {hr, sr, bs}. The fixtures decide the final list.
- **Shares, as today:** count characters per sure code and per close-call group. Keep each one holding at least 25% of the detected characters. Keep the 200-character floors.
- **Result:** `{ codes: string[], closeCalls: string[][], confident: boolean }`.
  - `codes` holds the sure codes.
  - `closeCalls` holds the kept close-call sets.
  - It is confident when the detected characters reach 200. Close-call pieces count toward that.

### Matcher (`matcher/rules/posting-language.ts`)

The family map keeps only `no`/`nb`/`nn`. The `hr`/`sr`/`bs` merge goes.

| Situation                                                    | Outcome | Reason                                                             |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------------------ |
| not confident, or nothing detected                           | unknown | as today                                                           |
| the profile speaks a code in `codes`                         | pass    | as today                                                           |
| otherwise, the profile speaks a member of a `closeCalls` set | unknown | "posting is in one of da, nb; can't tell which" (wording: builder) |
| otherwise                                                    | fail    | names every detected code and set                                  |

### Facts schema

Add `closeCalls` to `postingLanguages` in `facts/schema/facts.ts`. The bump below rebuilds old facts, so the builder decides whether the field is required or defaults to empty.

### Effects to expect

- Lesvexa: every sentence is sure Spanish, so a profile without Spanish fails.
- An alternating French/English paragraph gives `codes: [fr, en]` instead of unknown. That's safe, because a speaker of either passes.
- A tool list stays dropped (margin 0.001).
- Croatian, Danish, Norwegian, Malay, Indonesian, Czech, Slovak and Catalan postings are now detected. Each is sure or a close call.

## Tests and fixtures

Detector specs:

- Lesvexa as stored (flat) and with its breaks restored.
- One clean posting each: es, pt-PT, pt-BR, ca, it, cs, sk, da, nb, sv, nl, id, ms, hr.
- The existing mixed French/English and tool-list cases.

Each fixture asserts its call: sure code, close-call set, or dropped. The rules the fixtures must hold:

- No clean fixture is ever surely called a different language.
- The Malay fixture never yields a sure `id` without `ms`.

Matcher specs cover each row of the table, including:

- A Danish speaker on a {da, nb} close call gets unknown.
- A Croatian speaker on a sure `sr` fails.

## Rollout

1. `FACTS_VERSION` 3→4 (the detector header requires it). `MATCHER_VERSION` 7→8 (the matcher rule changes).
2. The match sweep rebuilds facts older than `FACTS_VERSION` (`matcher.repository.ts`). Then run `db:rematch -- --all`.
3. On dev, check:
   - Lesvexa is rejected with "posting is written in es, which you don't speak".
   - The 113 `unknown` drop.
   - No new posting-language failure for a language the user speaks.
   - The other four Spanish jobs in the brief now show `es`.

## Non-goals

- **Fixing the actor's flattened `descriptionText` in the normalizer.** Log it as its own roadmap item: it changes processor input and costs LLM reprocessing.
- **Upgrading franc or adding a second detector.**

## Left to the builder

- The exact sentence-split regex and how short sentences join.
- The final never-sure list, from fixture scores.
- The close-call reason wording.
- Whether `closeCalls` is required or defaults to empty.

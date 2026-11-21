# More searchable technologies

Date: 2026-11-21
Status: approved 2026-11-21
Size: small change

## Intent

A technology is searched only if `TECHNOLOGY_TERMS` (`libs/database/src/enums/technology-terms.ts`) gives it a search wording. 98 of the 164 tech tags have none. Most of those are concepts left out on purpose (Frontend, SaaS, Testing): searching them would match far too much. But some are concrete names that postings use and that return plenty of results, so leaving them out misses jobs. The owner noticed this when adding Claude Code to a published profile changed no searches.

Rule _(user)_: a keyword that returns a good amount of results is worth searching.

## Goals

These 17 tags become searchable _(user)_. All already exist in the vocabulary; only search wording is added.

| Tag           | Search wording                                               |
| ------------- | ------------------------------------------------------------ |
| `llm`         | `llm`, `llms` (_my call_: LinkedIn may not match the plural) |
| `rag`         | `rag`                                                        |
| `claude_code` | `claude code`                                                |
| `claude`      | `claude`                                                     |
| `openai`      | `openai`                                                     |
| `langgraph`   | `langgraph`                                                  |
| `ios`         | `ios`                                                        |
| `android`     | `android`                                                    |
| `wordpress`   | `wordpress`                                                  |
| `sap`         | `sap`                                                        |
| `salesforce`  | `salesforce`                                                 |
| `servicenow`  | `servicenow`                                                 |
| `shopify`     | `shopify`                                                    |
| `stripe`      | `stripe`                                                     |
| `playwright`  | `playwright`                                                 |
| `cypress`     | `cypress`                                                    |
| `supabase`    | `supabase`                                                   |

Effects:

- A profile that lists one of these searches for it: in LinkedIn job-board searches, next to its role words, and in post searches when post search is on. Both read `SEARCH_SPELLINGS`.
- The web stack picker shows them as searchable. `isSearchableTech` reads the same list.
- Profiles that list none of them are unchanged.

## Non-goals

- Concepts stay unsearched.
- Also considered and dropped _(user)_: ChromaDB (too rare), SEO (mostly marketing roles), Bedrock and MCP (ambiguous without longer wording), HTML and CSS (in almost every web posting).
- No per-profile opt-in, and no searching without role words.

## Anti-goals

- A term that pulls in non-engineering jobs. Role words limit this, and the per-term volume check below catches it.
- A profile's searches splitting into many more LinkedIn runs, which costs Apify spend against the daily budget. The packer splits only when the keyword limit is hit. Check this on the dev profiles after regenerating.

## Approaches

- **Add the terms to the existing list _(picked)_.** One table, which the job board, post searches and the web all read. Smallest change, matches how every other searchable tech works.
- Per-profile opt-in, or searching a term without role words: each is a bigger change, and neither serves the rule better.

## Rollout

1. `QUERY_SEARCH_RECIPE_VERSION` goes from 13 to 14. `search-spellings.ts` says any spelling change bumps it, and existing builders' hashes change.
2. After the engine deploys, run `db:regenerate` on dev, with `POST_SEARCH_USERS` set where it runs, so existing profiles move to the new searches. The edit sync doesn't do this: a code change moves no profile's `matchVersion`.
3. Measure volume with `db:spellings --check-totals`. It is maintainer-only and paid (at most $0.10 per run); run `--dry-run` first. Drop any term that returns too few results, with another version bump.

## Left to the builder

- Tests: the spellings, the packer and post-word specs that list searchable terms, and the web value-list `searchable` flag.
- Whether `docs/actors/linkedin-region-test.md` or the roadmap needs a note.

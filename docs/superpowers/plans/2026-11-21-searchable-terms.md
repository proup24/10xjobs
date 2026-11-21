# More Searchable Technologies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 17 existing tech tags get search wording, so profiles that list them search LinkedIn for them.

**Architecture:** Add entries to `TECHNOLOGY_TERMS`. The job-board builders, post searches (`SEARCH_SPELLINGS`) and the web's `isSearchableTech` all read that list. Add one spelling override for `llm`, and bump `QUERY_SEARCH_RECIPE_VERSION` because existing builder hashes change.

**Tech Stack:** TypeScript, Vitest, Nx.

**Spec:** `docs/superpowers/specs/2026-11-21-searchable-terms-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

## Global Constraints

- New `TECHNOLOGY_TERMS` entries, tag → term:
  - `llm` → `llm`
  - `rag` → `rag`
  - `claude_code` → `claude code`
  - `claude` → `claude`
  - `openai` → `openai`
  - `langgraph` → `langgraph`
  - `ios` → `ios`
  - `android` → `android`
  - `wordpress` → `wordpress`
  - `sap` → `sap`
  - `salesforce` → `salesforce`
  - `servicenow` → `servicenow`
  - `shopify` → `shopify`
  - `stripe` → `stripe`
  - `playwright` → `playwright`
  - `cypress` → `cypress`
  - `supabase` → `supabase`
- `SEARCH_SPELLINGS` override: `llm: ['llm', 'llms']`.
- `QUERY_SEARCH_RECIPE_VERSION`: 13 → 14.
- Not searchable, unchanged: `chromadb`, `seo`, `bedrock`, `mcp`, `html`, `css`, and every concept tag (`saas`, `fullstack`, `testing`, …).
- Work in worktree `/home/lab/apps/10xjobs/.worktrees/searchable-terms` on `feat/searchable-terms`. Push only with `git push -u origin feat/searchable-terms`, and open the PR with `gh pr create --base main`.

## Review Focus

1. A two-word term (`claude code`) must be searched as a phrase, never as `claude AND code`. Test in Task 1 (`searches claude code as one phrase`).
2. A profile with both `claude` and `claude_code`: both spellings stay, and neither is lost or duplicated. Test in Task 1 (`keeps claude and claude code apart`).
3. A profile whose packed LinkedIn keyword now exceeds the limit splits into more sets, and no technology is dropped. The packer's existing specs cover it; check the dev profiles after `db:regenerate` (rollout).
4. Post searches stay within `POST_MAX_OPERATORS` (5) when `llm` brings two spellings. The existing post-recipe specs cover the split; add `llm` to one.
5. The web stack picker marks the new tags searchable and still marks `seo` as not searchable. Test in Task 1.

---

### Task 1: Search wording for the 17 tags

**Files:**

- Modify: `libs/database/src/enums/technology-terms.ts` (17 entries; keep the file's grouping order)
- Modify: `apps/xjobs/src/modules/queries/builders/search-spellings.ts` (`OVERRIDES` gains `llm`)
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts` (version 14)
- Test: `libs/database/src/seeds/vocab/seed-data.spec.ts`, `apps/xjobs/src/modules/queries/builders/search-spellings.spec.ts`, `apps/xjobs/src/modules/queries/builders/recipe.spec.ts` (13 → 14), `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.spec.ts` (or the job-board keyword spec that already checks quoting), `apps/xjobs/src/modules/queries/posts/recipes.spec.ts`, `apps/web/src/lib/setup/value-lists.spec.ts` (create the case if the file has none)

**Interfaces:**

- Produces: `isSearchableTech(code)` is true for the 17 tags; `searchSpellings('llm')` returns `['llm', 'llms']`; `QUERY_SEARCH_RECIPE_VERSION === 14`.

- [ ] **Step 1: Write the failing tests**
  - `seed-data.spec.ts`, `the agreed tags are searchable and the dropped ones are not`: `isSearchableTech` is true for each of the 17 codes and false for `chromadb`, `seo`, `bedrock`, `mcp`, `html`, `css`.
  - `search-spellings.spec.ts`:
    - `lists both spellings of llm`: `searchSpellings('llm')` equals `['llm', 'llms']`.
    - `uses the plain term for claude code`: `searchSpellings('claude_code')` equals `['claude code']`.
  - Job-board keyword spec:
    - `searches claude code as one phrase`: a combination with `claude_code` yields a keyword containing `"claude code"`, quoted the way the builder quotes multi-word terms (check how `spring boot` or `github actions` is written today and assert the same form).
    - `keeps claude and claude code apart`: a combination with `claude` and `claude_code` contains each spelling exactly once.
  - `posts/recipes.spec.ts`, `llm's two spellings count toward the operator limit`: a post-search profile with `llm` plus enough other techs to cross 5 operators splits into groups, each `postKeywordFits`, and `llm` and `llms` land in the same group.
  - `recipe.spec.ts`: the existing assertions become `14`.
  - Web, `marks the new tags searchable`: the value lists built from techs `claude_code` and `seo` give `searchable: true` and `false` respectively.
- [ ] **Step 2: Run** from `apps/xjobs`: `CI=1 npx vitest run src/modules/queries`. From `libs/database`: `CI=1 npx vitest run src/seeds`. From `apps/web`: `CI=1 npx vitest run src/lib/setup`. Expected: FAIL (terms missing, version 13).
- [ ] **Step 3: Implement** the 17 entries, the `llm` override and the version bump.
- [ ] **Step 4: Run** the three commands again and expect PASS. Then run `npx nx run-many -t lint typecheck -p xjobs database web`, and the full engine (`CI=1 npx vitest run` in `apps/xjobs`) and web suites once. Known unrelated engine failures: 2 `VocabRepository` (`bun`) cases and 2 `webhooks.postgres.spec.ts` "merge root" cases (Postgres specs run only with `PROCESSOR_TEST_DATABASE_URL`).
- [ ] **Step 5: Commit** `feat(queries): 17 more searchable technologies, recipe version 14`.
- [ ] **Step 6: PR.** Push and open it, with this rollout in the body:
  1. After the engine deploys, run `pnpm --filter @xjobs/xjobs db:regenerate` on dev, with `XJOBS_ALLOW_REMOTE_DB=1` and `POST_SEARCH_USERS` set.
  2. Check the dev profiles' builder counts per channel before and after. `9074f82b…` lists `claude_code`, so it gains it. Watch for extra split sets, which mean extra Apify runs.
  3. Measure volume a week after regenerating: `pnpm --filter @xjobs/xjobs db:spellings -- --days 7` reports, per searched technology, how many collected jobs the processor tagged with it and which spellings earn their place. `--check-totals` only prices *suggested* spellings, not these terms. Drop a term that brings in almost nothing, with another version bump.

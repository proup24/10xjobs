# Preferences: engine switch and final names

Phase 1, a slice between 06 and 07. Date: 2026-11-07.

Binding spec: [Preferences and eligibility schema](2026-11-05-preferences-and-eligibility-design.md). Plan: [Preferences and eligibility](../plans/2026-11-05-preferences-and-eligibility.md), "Step 2: Switch" (Tasks 7–11, including 10a) and "Step 3: Remove" (Tasks 12–13). This spec changes who builds steps 2 and 3 and how the change reaches the shared dev database. It reopens no other decision.

## Intent

Slice 07 (guided setup UI) writes profiles straight through `supabase-js`, so it has to be built against the final column names (`locations`, `languages`), and the old columns must be gone. That waits on step 2 (the engine stops reading the old columns), which was the teammate's and hasn't started. **We take over steps 2 and 3 ourselves** so slice 07 can start _(user's decision)_.

## Scope

**Tasks 7–13 as the plan writes them, with nothing trimmed** _(my call)_. Strictly, slice 07 needs only the final names. The rest can't be dropped without reopening a locked decision:

- Task 12 deletes the `Position` and `Technology` enums. Fifteen engine files import them (`modules/users`, `modules/queries`, the processor's `rules/validate.ts`), so Tasks 7, 8 and 10 have to land first.
- Task 9 (publishing needs eligibility), Task 10's four authorization kinds and Task 10a (the engine's resume endpoints go) are locked by the binding spec and the resume storage spec.

**Additions** to the plan:

- **Clearing dev profiles moves from PR C to PR B** _(user's decision)_. See "The shared dev database".
- **Owners.** Steps 2 and 3 are both built by the user (with Claude). The plan's "the teammate" labels on step 2 change to the user.
- **`QuerySearchBuilder.technologies` becomes `String[]` in Task 7 (PR B)** _(my call)_. The plan misses it. It is typed by the `Technology` enum, so Task 12 couldn't delete that enum otherwise. Only the engine writes this table, so it gets no code-check trigger. Its values don't change, so builder hashes are unaffected.
- **No `db:reprocess` in this slice** _(my call)_. Narrowing `requirements[].kind` affects only new extractions. Jobs already processed in dev may keep other kinds. Phase 2 qualify is the first reader of that field, so its spec reprocesses (or treats an unknown kind as unsure) before comparing. This avoids an OpenRouter bill for dev data now.

**Plan corrections**, to make while writing the PRs, not decisions:

- The enums live in `libs/database/src/enums` (with `enums.spec.ts`). `apps/xjobs/src/common/enums` only re-exports them. Task 12's deletes point there, and `libs/database/src/seeds/vocab/seed-data.spec.ts` (imports `Position`) is in its edit list.
- The generated types are at `libs/database/src/supabase/database.types.ts`, not the web-app path the plan names.
- Task 10a and its plan text exist only on PR #17's branch until #17 merges. PR B picks them up from `main`.

**Deferred:** nothing in the binding spec. A publish button in the web app stays deferred until the engine deploys, as the roadmap's open item already recommends. That isn't part of this slice.

## PRs

Two PRs, in order _(my call)_:

1. **PR B, `feat/preferences-engine-switch`:** Tasks 7–11 and the dev-profile cleanup. It carries this spec, the plan edits and the roadmap edits. B changes code and adds a cleanup, but drops no column, so it can be reverted on its own.
2. **PR C, `feat/preferences-remove-legacy`:** Tasks 12–13, branched from `main` after B merges. This is the destructive migration: it drops columns, renames, makes columns required and deletes the enums.

One PR would reach the final names a review cycle sooner, but its diff would mix the engine rewrite with an irreversible migration. Slice 07 needs both either way.

**PR B also waits for PR #17 (resume storage) to merge** _(my call)_. Task 10a removes the engine's resume upload, and until #17 merges, that endpoint is the only way to upload a resume. If #17 is still open when Tasks 7–10 are done, B waits for it. Task 10a doesn't move to another PR.

## Handover to the teammate

The teammate is told, not asked _(user's decision)_. They have no pending work in these areas (confirmed by the user). Before PR B's first commit, the user sends this notice:

> We're building steps 2 and 3 of the preferences and eligibility plan ourselves (PRs B and C), so slice 07 can start. Until PR C merges, please don't edit:
>
> - `apps/xjobs/src/modules/users`
> - `apps/xjobs/src/modules/queries` (all of it)
> - in `modules/processor`: `rules/validate.ts`, `schema/shared.ts`, `repositories/vocab.repository.ts`, `testing/`, `services/fact-assembler.service.ts`
> - `apps/xjobs/src/modules/storage/services/` and `storage/testing/`
> - `apps/xjobs/src/common/enums`, `libs/database/src/enums` and `libs/database/src/seeds/vocab`
> - `apps/xjobs-e2e/src/xjobs/users.spec.ts`
> - `libs/database/src/contract/contract.prisma` and new migrations
>
> Collection, ingest and the actor mappers are yours as usual. What changes for you once these merge:
>
> - Profiles hold codes and places, not enums and free text.
> - Query recipe v11. Search wording maps are keyed by code string, and only techs that have search wording are searched.
> - The processor reads engineering role kinds from `role_kinds.isEngineering`, and authorization kinds are limited to the four.
> - The engine's resume endpoints are gone. A profile's whole storage folder is deleted with it.
> - Publishing needs the user's residence and sponsorship answer.
> - Every dev profile without the new fields is deleted when B reaches the shared dev database.
> - `query_search_builders.technologies` becomes plain text codes (same values).
> - The `Technology`, `Position`, `Region` and `Language` enums are deleted in C.

The list is wider than `modules/users` because the resume storage spec's rule (two people never edit `modules/users` at the same time) also covers the other folders these PRs rewrite _(my call)_.

The freeze lifts when PR C merges, and the user tells the teammate.

## The shared dev database

`.github/workflows/dev-database.yml` migrates and seeds the shared dev database every time CI passes on `main`. So each merge reaches that database at once, with no manual step.

- **PR B's migration deletes every profile with null `places`, `spokenLanguages` or `contractTypes`** _(user's decision)_. Those profiles were created through the old endpoints and can't produce v11 searches, because `placeTexts` throws on a missing place. The user confirmed nothing is published there, so no live search depends on them. Local databases get the same cleanup, and a local published profile also loses its builder links through the cascade.
- **Resume files of deleted profiles may be orphaned.** A migration can't remove Storage objects. This is dev data only, so it's accepted _(my call)_.
- **After B is on `main`**, the user runs `db:regenerate` once against the shared dev database (with `XJOBS_ALLOW_REMOTE_DB=1`). With no published profiles, it only retires the v10 builders. Running it is a step in PR B's description, not something Claude does.
- PR C's cleanup (Task 12) stays as a safety net and should find nothing to delete.

## Risks

- **Query generation from codes and places.** Three things must hold:
  - A city's search text is "name, country label".
  - A label with no LinkedIn geoId falls back to its lowercased text and isn't dropped (Review Focus 4).
  - A concept tag such as `saas` is never sent as a keyword (Review Focus 3).

  `expand.scenarios.spec.ts` and the `channels.spec.ts` geoId cases must pass with the fixtures switched to string codes, without loosening any expected output.

- **The processor.** Tightening `requirements[].kind` to four values can make extraction fail where the model returned another kind. `processor:eval` must score no worse than on `main` (Task 10, Step 4). It calls OpenRouter, so the user runs it with their key and pastes the result into PR B.
- **Published profiles and `db:regenerate`.** Covered above. Locally, run it after migrating to check that it completes on the new fields.
- **The e2e suite isn't in CI.** `ci.yml` runs lint, test, build, typecheck and the db tests only. Task 7 rewrites the profile endpoints e2e covers, and Task 10a removes resume tests, so `npx nx e2e xjobs-e2e` runs by hand before B and again before C, and each PR description states that it passed.
- **Generated database types.** CI fails if `libs/database/src/supabase/database.types.ts` differs from `pnpm db:types`. Regenerate them in both PRs.

## Roadmap docs, updated in PR B

- `docs/roadmap/phase-1-accounts-and-preferences/README.md`: the slice table gains a row for this slice, linking this spec and depending on 04–06. Slice 07 then depends on it.
- `07-guided-setup-ui.md`: the "Starts after" line names this slice and its spec.

## Done when

- `Profile.locations` and `Profile.languages` are the final columns on `main`, and the old `country`, `city`, `languages` and `locations` columns and the four enums are gone.
- Nothing in `apps/xjobs` reads an old column or imports a removed enum (the greps in Tasks 11 and 12 come back clean).
- Each PR is green in CI, including the db tests, and states in its description that e2e and `processor:eval` (B) were run by hand.
- The teammate has been told when the freeze starts and when it ends.

# Query search — Design

Date: 2026-10-29
Status: draft

## Intent

Phase 1 collects jobs from LinkedIn (through Apify), Ashby and Greenhouse. Before anything can be collected, the engine needs to know _what to search for_. A **query search builder** is that answer: one deterministic search recipe for one channel, derived from a published job-seeker profile.

Query search builders are shared, not owned. Two users who want the same search share one row. A user whose combination nobody else has gets their own rows. Each row has a hash, so the same recipe is never stored twice.

This serves the roadmap's anti-goal of "missing the right jobs". Each profile expands into every combination it covers, so no position, region or arrangement the user asked for goes unsearched. Generation is deterministic and needs no AI, so it is cheap, testable and explainable.

## Goals, non-goals, anti-goals

**Goals**

- An `importance` rating on each profile skill, used to pick which technologies drive searches.
- A `state` on profiles (`draft`, `published`) and endpoints to publish and unpublish a profile.
- On publish, generate every query search builder the profile needs, for every channel, and insert only the ones that don't already exist.
- A `query_search` module (folder `query-search/`) with the same layout as the other modules, including one query builder per channel.
- A read-only endpoint to list a workspace's query search builders.

**Non-goals**

- The channels module: calling Ashby, Greenhouse or Apify, scheduling, scraping. `Channel` is only an enum here.
- A table linking profiles to query search builders, or analytics on query search builders. That is a separate tracking table, planned for later.
- Deleting, editing or retiring query search builders. Query search builders are immutable and only grow. Stale query search builders (from a dropped position or an unpublished profile) are accepted until the tracking table exists, and there is no `active` flag.
- AI-generated keywords.

**Anti-goals**

- Duplicate query search builders, whether from re-publishing or from two users with overlapping profiles.
- Non-deterministic output: the same profile must always produce the same rows and hashes.
- Query search builders tied to a user. They must stay shareable recipes.

## Constraints

Same as [workspaces and users](./2026-10-29-workspaces-and-users-design.md): Prisma 8 contract in `apps/xjobs/src/database/contract.prisma` with a generated migration under `database/migrations/app/`, PSL text enums, camelCase columns, snake_case plural tables, the `Timestamps` mixin, `uuid(7)` ids, and a workspaceId on every record. CI has no database, so unit tests run against in-memory fakes in `testing/`. Every response goes through the existing success and error envelope, and every route needs Basic auth.

## Data model

### New enums (contract and `src/common/enums/`)

- `Channel`: `LINKEDIN_JOB_BOARD`, `LINKEDIN_POSTS`, `GREEN_HOUSE`, `ASHBY` (the user's spelling).
- `ProfileState`: `draft`, `published`.

### profiles: new columns

| field       | type                            | notes                                |
| ----------- | ------------------------------- | ------------------------------------ |
| state       | `ProfileState`, default `draft` | existing rows migrate to `draft`     |
| publishedAt | Timestamptz?                    | set on publish, cleared on unpublish |

### profile_skills: new column

| field      | type             | notes                                                                                                |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| importance | Int, default `5` | 0–10, `@@check`. How much this technology should drive searches. `0` means never use it in a search. |

The `PUT …/profile` tech stack items gain an optional `importance` (0–10, default 5). The profile view returns it, and the stack sort becomes importance, then preference, then mastery. Existing rows migrate to 5.

### query_search_builder

| field          | type                       | notes                                                                                                                                     |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| workspaceId    | Uuid → workspaces, cascade |                                                                                                                                           |
| channel        | `Channel`                  |                                                                                                                                           |
| locationRegion | `Region`                   | one region per row                                                                                                                        |
| country        | String?                    | ISO alpha-2 from the profile; set only on `onsite` and `hybrid` rows, null otherwise                                                      |
| city           | String?                    | the profile's city, if any; set only on `onsite` and `hybrid` rows                                                                        |
| technologies   | `Technology[]`             | the technology set this row searches for, in rank order; empty when the profile has no skill with importance > 0                          |
| experience     | `Seniority`                | the profile's seniority                                                                                                                   |
| type           | `Arrangement`              | one arrangement per row                                                                                                                   |
| keywords       | String[]                   | deterministic, built by the channel's builder, sorted and lowercased                                                                      |
| version        | Int                        | recipe version (`QUERY_SEARCH_RECIPE_VERSION` constant, starts at 1), bumped whenever the keyword mapping or a builder changes its output |
| params         | jsonb                      | the channel's own fields (see Builders), keys in a fixed order                                                                            |
| hash           | String                     | hex SHA-256 of the canonical recipe, see below                                                                                            |

`@@unique([workspaceId, hash])`, `@@index([workspaceId, channel])`. Query search builders have no `userId` or `profileId`.

## Generation

> **Superseded (2026-10-31):** the expansion rules below (top-3 technology sets, onsite/hybrid per region, `unstated` recipes) are replaced by [2026-10-31-query-search-generate-design.md](2026-10-31-query-search-generate-design.md).

On publish, the profile expands into the cross product:

```
channels (all 4) × positions × regions × arrangements × technology sets, with the profile's single seniority
```

**Top technologies** are the profile's skills with `importance > 0`, deduplicated by technology (a technology listed under two domains counts once, with its highest importance), sorted by importance, then preference, then mastery, then the technology's enum name to break ties.

**Technology sets** built from the top 3 (T1, T2, T3), 5 in total:

- `[T1]`, `[T2]`, `[T3]`: one row per technology, the broad searches.
- `[T1, T2]`: the top 2 together.
- `[T1, T2, T3]`: the top 3 together, the most precise search.

With fewer qualifying skills, only the sets that exist are generated and duplicates collapse: 2 skills give `[T1]`, `[T2]`, `[T1, T2]`; 1 skill gives `[T1]`. With none, one row with an empty set is generated per combination.

The arrangement applies to every selected region. On `remote` rows the region is the location. On `onsite` and `hybrid` rows the builder uses the profile's country (and city, when set) as the location, and the region is stored as part of the recipe.

For each combination, the channel's builder returns `{ keywords, params }`. The row's hash is SHA-256 over a canonical JSON string with fixed key order: `{ version, channel, locationRegion, country, city, experience, technologies, type, keywords, params }`. `workspaceId` is not part of the hash. The unique key includes it.

The service then inserts the rows whose hash is not already in the workspace. Concurrent publishes that race on the same hash must not fail: a unique violation on `(workspaceId, hash)` counts as "already exists".

Example: 2 positions × 2 regions × 2 arrangements × 5 technology sets × 4 channels gives 160 recipes. A first publish inserts all 160. Publishing again inserts 0. Another user in the workspace who shares everything except one new position inserts only that position's 80.

### Builders

`query-search/builders/` holds a `ChannelQueryBuilder` interface (`channel`, `build(combination) → { keywords, params }`) and one implementation per channel, registered through a map keyed by `Channel`. Builders are pure functions with no I/O.

A shared **keyword mapping** turns enums into terms:

- `Position` → title phrases, e.g. `backend_engineer` → `["backend engineer", "backend developer"]`, `site_reliability_engineer` → `["site reliability engineer", "sre"]`. Every position has an entry, and a unit test fails if one is missing.
- `Seniority` → a level word (`senior`, `staff`, …). `unstated` maps to nothing.
- `Arrangement` → `remote`, `hybrid`, `on-site`. `unstated` maps to nothing.
- `Technology` → a search term, e.g. `nodejs` → `node.js`, `csharp` → `c#`, `react_native` → `react native`, `github_actions` → `github actions`. Every technology has an entry, and a unit test fails if one is missing.

Every channel's keywords combine all three: the seniority word, the position title phrase and the technology terms of the set, e.g. `senior backend engineer nestjs` or `senior backend engineer nestjs typescript`.

Per channel:

- **LINKEDIN_JOB_BOARD**: keywords are seniority + title phrase + the set's technologies. Params hold the LinkedIn job-search filters: experience level and work type codes from seniority and arrangement, plus the location (region, or country/city for on-site and hybrid).
- **LINKEDIN_POSTS**: keywords are hiring phrases, e.g. `hiring senior backend engineer nestjs`, with the arrangement word added when it is known. Params hold the location label.
- **GREEN_HOUSE** and **ASHBY**: these public APIs list one company's board and offer no keyword search. So the query search builder is a **filter** applied to fetched postings: keywords are the seniority word, title phrases and technology terms to match against the posting, and params hold the location terms for the region and a remote flag from the arrangement.

If a profile lists `unstated` next to real arrangements (e.g. `[remote, unstated]`), `unstated` is dropped from the expansion, since the real values already cover it. It only produces rows when it is the only arrangement.

`unstated` seniority or arrangement means "don't filter on it". The row still stores `unstated`, and the builder leaves that filter out.

## API

| method | path                                                           |                                                               |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/workspaces/:workspaceId/users/:userId/profile/publish`   | sets `published`, generates query search builders, idempotent |
| POST   | `/api/workspaces/:workspaceId/users/:userId/profile/unpublish` | sets `draft`, leaves query search builders alone              |
| GET    | `/api/workspaces/:workspaceId/query-search?channel=`           | list, optional channel filter, no pagination yet              |

Publish returns the profile view plus `querySearches: { created, existing }` counts. Both state endpoints return 404 when the user or profile doesn't exist in the workspace. The profile view and response DTO gain `state` and `publishedAt`. Every route gets Swagger and envelope decorators, as the existing controllers do.

`PUT …/profile` does not change `state` and does not generate query search builders. To pick up edits, the user publishes again.

Order on publish: generate query search builders first, then set the state. If generation fails, the profile stays as it was. Because publishing is idempotent, retrying is safe.

## Code layout

```
apps/xjobs/src/modules/query-search/
  builders/      channel-query.builder.ts, keywords.ts, one file per channel, specs next to them
  controllers/   query-search.controller.ts
  dto/           query-search-builder.response.dto.ts, list-query-search.query.dto.ts
  repositories/  query-search.repository.ts (abstract + Prisma)
  services/      query-search.service.ts (+ spec)
  testing/       fakes.ts
  types/         query-search.types.ts, index.ts
  query-search.module.ts, index.ts
```

- `QuerySearchModule` exports `QuerySearchService`. `UsersModule` imports it, and `ProfilesService.publish` calls `QuerySearchService.generate(workspaceId, input)`. `input` is a plain type (positions, regions, arrangements, seniority, country, city, skills with importance/preference/mastery), so the query search builders module never imports users.
- `QuerySearchModule` is registered in `AppModule`.
- Unit tests cover: determinism (same input, same hashes), cross-product size, dedupe across two publishes and two overlapping profiles, `unstated` handling, top-technology selection, tie-breaking and the 5 technology sets (including the 0, 1 and 2 skill cases), the keyword mapping covering every `Position` and `Technology`, and the publish/unpublish state transitions.

## Left to the builder

- Exact phrase lists in the keyword mapping, beyond covering every position.
- Exact LinkedIn filter codes and param key names per channel. They will be revisited when the channels module consumes them.
- How the insert-if-missing is done (`ON CONFLICT DO NOTHING` if the ORM supports it, otherwise look up then create, catching the unique violation).
- DTO class names.

## Calls I made (not confirmed by the user)

- `experience` stores `Seniority`, not years. `type` stores `Arrangement`, not `Engagement`. Engagement is not part of the recipe.
- A `version` column, included in the hash, so a builder change produces new rows that the channels module can tell apart from stale ones.
- `unstated` is dropped when real arrangements are also listed. `unstated` seniority adds no level word.
- Technology sets with fewer than 3 qualifying skills: only the sets that exist, no padding. `importance` defaults to 5, and 0 excludes a technology from searches.
- The hash and uniqueness are per workspace.
- States are `draft` and `published`. Unpublish leaves query search builders in place. `PUT` doesn't change state.
- `publishedAt` column, the list endpoint, and the `{ created, existing }` counts on publish.
- Greenhouse and Ashby query search builders are post-fetch filters, because those APIs have no search.

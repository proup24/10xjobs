# Search segments for channel collection

Date: 2026-10-31. Builds on `2026-10-31-channel-collection-jobs-design.md`. Ports collection behaviour from the sibling `career-hub` repo (`src/collect/**`).

## Intent

A channel job currently starts one Apify run per query search builder. That is expensive, and the run's settings come from a static `channelConfig`. Instead, each channel job groups its active builders into **search segments** and runs Apify once per segment. Apify gets only what the builders carry. Collection only collects and ingests; matching against profiles is a later phase.

## Goals

- Group the builders into segments. A segment is up to **10** active builders on one channel that share the same `domain` and `type` (arrangement). On-site and hybrid builders are grouped by `country` and `city`; remote builders by `locationRegion`.
- One Apify run per segment. The input is built only from each member's `keyword` and `params`.
- Each result is matched back to the member builder that found it and ingested against that builder (`queryId`).
- Each builder keeps a look-back cursor, and a segment searches only the window it has not yet covered.
- Every segment run is saved with its members, window, cost, per-query counts, truncation, cap and error.
- The static `channelConfig` in `modules/collectors/config` is removed. The remaining operational settings move to each channel's job config.

## Non-goals

- Matching or qualifying jobs, and any profile- or user-specific fields in the Apify input.
- Monthly budget enforcement. Spend is recorded, not yet capped per month.
- Gap records for outages longer than the maximum window. These are logged only.

## Anti-goals

- Losing attribution. Every ingested job must be tied to the builder whose query found it.
- Moving a builder's cursor past a window that was not actually searched, for example after a failed run or ingest.
- One segment's failure stopping the channel's other segments.

## Decisions

Decided by the user:

- **The segment key.** Up to 10 queries per channel × domain × type. On-site and hybrid are grouped by city; remote by the selected region.
- **Apify input.** Apify takes only the builders' params. Profile and user data is not used in collection.
- **Saving segments.** Segments are recomputed on every run and saved as part of each run's record. There is no standing segment table.
- **Run records.** There is a stable segment identity, a look-back window per segment, and a record of every segment run.

Builder's calls:

1. **Segment building is a pure function.** `buildSegments(builders)` groups by key: `channel|domain|type|country|city` for on-site and hybrid, and `channel|domain|type|locationRegion` for remote. It sorts each group by builder `hash` and cuts it into chunks of 10. A segment's `hash` is the sha256 of its key plus its ordered member ids. The same builders always give the same segments.
2. **Cursor per builder.** A new nullable column `QuerySearchBuilder.coveredUntil` holds it.
   - The window ends at the run's start time.
   - It starts at the oldest `coveredUntil` among the members, minus a 15-minute overlap. A member with no cursor counts as 24 hours ago.
   - The window is capped at 24 hours. When the cap cuts it short, a warning is logged.
   - After a member's results are ingested successfully, its `coveredUntil` is set to the window end. Members whose collection or ingest failed keep their old cursor.
3. **Run record table** `search_segment_runs` (`SearchSegmentRun`):
   - `id`, `channel`, `segmentKey`, `segmentHash`, `queryIds Uuid[]`;
   - `windowStart`, `windowEnd`, `startedAt`, `finishedAt`;
   - `status` (`succeeded` | `partial` | `failed`);
   - `fetched`, `costMicroUsd` (nullable), `capped`, `truncatedQueryIds Uuid[]`;
   - `perQuery Jsonb` (`{ [queryId]: { returned, inserted, updated, duplicate, invalid, error? } }`);
   - `error String?`.

   It is indexed on `(channel, startedAt)`. `partial` means the Apify run succeeded but at least one member's ingest failed.

4. **Channel config replaces `channelConfig`.** `channelJobsConfig[channel]` gains:
   - `actor`
   - `maxRunChargeUsd`
   - `window: { initialHours: 24, overlapMinutes: 15, maximumHours: 24 }`
   - `segmentSize: 10`
   - a channel-specific `collect` block:
     - LinkedIn job board: `maxRowsPerUrl`
     - posts: `maxPostsPerQuery`
     - Greenhouse and Ashby: `site`, `suffix`, `maxPagesPerQuery`, `fetch`

   The values are carried over from today's `channelConfig`. `modules/collectors/config` is deleted.

5. **Collector contract.** `collect(segment: SegmentSearch, config): Promise<SegmentResult>`.
   - `SegmentSearch = { channel; window: { since; until }; queries: { id; keyword; params }[] }`.
   - `SegmentResult = { jobsByQuery: Map<queryId, CollectedJob[]>; fetched; costUsd: number | null; capped; truncatedQueryIds; error: string | null }`.

   Each collector works as follows (ported from career-hub):
   - **LinkedIn job board:** one `bebity/linkedin-jobs-scraper` run. `startUrls` holds one URL per member, built from `linkedinJobSearchUrl(keyword, params)` plus `sortBy=DD&f_TPR=r<window seconds>`. Results are matched back by `scrapingInfo.inputUrl`. A member is truncated when it scanned `maxRowsPerUrl` or more.
   - **LinkedIn posts:** one `harvestapi/linkedin-post-search` run with `searchQueries` (one per member), `postedLimitDate: since`, `sortBy: 'date'` and `maxPosts`. Results are matched back by `item.query.search`. A member is truncated when it returned `maxPostsPerQuery` or more.
   - **Greenhouse and Ashby:** one `apify/google-search-scraper` run with one query per member, joined by newlines, and `quickDateRange: h<ceil(window hours)>`. Hits are matched back by `searchQuery.term`, then postings are fetched as today.
   - **All channels:** a result that matches no member is counted in `fetched` and dropped with a warning. `capped` means the cost is at least 95% of `maxRunChargeUsd`, per career-hub's charge-cap ratio.

6. **Cost.** `ApifyActorProvider.run` returns `{ items, costUsd }`, where `costUsd` is the run's `usageTotalUsd`, or null when Apify doesn't report it. There is no settle loop in this step.
7. **Code layout.**
   - **`modules/segments`** (new, `SearchSegmentsModule`): `buildSegments`, `segmentWindow`, and `SearchSegmentsRepository`, which handles `recordRun` and `advanceCursors(queryIds, until)`.
   - **`CollectionJob.run()`:**
     1. load active builders (queries module);
     2. build the segments;
     3. for each segment, work out the window, collect, ingest per member, advance the cursors of members that succeeded, and record the run.

     A failure in one segment is logged and the rest still run. The job fails only when every segment failed.

   - **The worker and scheduler** stay as they are.

## Testing

- **`buildSegments`:** the grouping key (city for on-site and hybrid, region for remote, domain and type kept apart), chunks of 10 (25 builders give 10, 10 and 5), stable order and hash, and different channels never mixed.
- **`segmentWindow`:** no cursors gives 24 hours; the oldest cursor minus the overlap; the 24-hour cap.
- **Each collector:** the single-run input for a 3-member segment, matching results back to each member, truncation, the charge cap, and an unmatched result being dropped.
- **`CollectionJob.run`:** one collect per segment; ingest per member with its own `queryId`; only successful members' cursors advance; a run is recorded with the right status; one segment failing doesn't stop the others; and the job fails only when all segments fail.
- **Repository:** Prisma `recordRun` and `advanceCursors` against the contract (typecheck), and fakes for the unit tests.

## Left to the builder

File names, log wording, and the exact shape of `perQuery` beyond the fields listed.

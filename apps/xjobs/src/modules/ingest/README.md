# Ingest

`IngestModule` stores shared, normalized source observations in PostgreSQL. Import it into a collection orchestrator and inject `IngestService`:

```ts
const result = await ingest.ingest({
  queryId: lookupQuery.id,
  channel: collector.channel,
  observedAt: fetchedAt, // Preserve this timestamp when retrying the same batch.
  items: collection.jobs,
});
```

Items follow the `CollectedJob` collector contract (`collectors/types/collector.ts`): `source`, `sourceJobId`, canonical `url`, `applyUrl`, `title`, `company`, `location`, `postedAt` (ISO 8601 UTC) with `postedAtPrecision`, plain-text `description`, `contact`, the `search` query that found it, and `raw`. An item whose `source` does not match the lookup query's channel is rejected. A blank or sentinel `sourceJobId`, `title` or `company` is stored as null. The service accepts untrusted items so it can report malformed entries individually. No scheduler or collector is invoked by ingestion. Collection orchestration is not currently implemented in xjobs; this module exposes the service for that integration.

## Storage

- `raw_jobs`: normalized job/post, original JSON, normalization version, source identity, first/last observation times. No user/profile owner.
- `raw_job_identities`: unique channel-scoped source-ID and canonical-URL aliases. Native ATS source-ID aliases include their organization/board, since tenant identity matters.
- `raw_job_query_hits`: aggregate attribution per `(queryId, rawJobId)`, with observation range and latest observed URL/rank. Existing query-builder rows are the lookup references; their current ownership model is unchanged.
- `ats_posting_identities`: exact provider/organization-or-board/posting identity shared by associated observations. Cross-channel records remain separate.

Posts keep the full content as description, a display title, and separate author fields. They do not claim the author is the employer. ATS HTML is converted to plain text while original markup remains in `raw`. Missing optional facts are null. No AI extraction or qualification runs here.

## Deduplication and retry

Source ID is primary; a validated source URL supplies fallback identity. URL-only jobs can acquire source IDs later. If ID and URL aliases identify different rows, the item fails with an identity conflict. Company/title equality never merges jobs.

Each accepted item commits its job, aliases, ATS association and query hit atomically. Database constraints, row locks and up to three transaction retries handle uniqueness/deadlock/serialization races. A newer observation replaces the content snapshot (including clearing absent optional fields); older/equal observations cannot overwrite it. Identity enrichment and attribution can still be added by stale observations. First/last seen use minimum/maximum times.

Batches have at most 1000 items. The report contains `inserted`, `updated`, `duplicate`, `invalid`, distinct accepted `jobIds`, and indexed validation/conflict errors. A newer snapshot counts as updated even if its content is unchanged. Invalid items do not stop siblings. Infrastructure failures propagate; replay the original batch with the same timestamp to recover previously committed items safely.

## Migration prerequisite

The additive `20261031T0001_ingest_raw_jobs` migration starts from the pre-ingest contract `e77655c24b187fa1c73badde5327bccea57ba3fabd4e6283986afd4ef4cc422e` and creates four tables, indexes and constraints. It does not change existing ownership or delete data.

**Existing migration history predates the repository's workspace-to-profile schema change.** A database still on that older schema needs the separate data-preserving ownership migration before this ingest migration can apply. Do not reset a populated database or mark an incompatible schema as current. The matching pre-ingest snapshot is included to make the prerequisite explicit. This change does not provide the missing ownership migration.

The ingest migration was exercised against an isolated PostgreSQL database initialized to the pre-ingest contract, using the repository's normal migration command. No external database was modified.

## Verification

```sh
pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest
pnpm exec tsc -p apps/xjobs/tsconfig.app.json --noEmit
```

PostgreSQL tests additionally require `INGEST_TEST_DATABASE_URL` pointing to a disposable database named `ingest_test` at `127.0.0.1`, already initialized/migrated to the current contract. These tests **truncate test tables and users**. They skip when the variable is absent, and reject other host/database names. Tests never call paid collectors.

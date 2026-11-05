# Lookup-query job ingestion

Status: **superseded** by `2026-10-31-ingest-raw-storage-design.md` (ingest stores untouched batches; the normalized `raw_jobs` storage below was removed). Originally approved by the user and implemented. Verification and migration prerequisite are recorded in the implementation plan and module README.

## Intent and ownership

The ingest module validates and stores fetched jobs/posts in a shared structured `raw_jobs` store. Collection is attributed to lookup queries, not users or profiles. A job discovered by several queries has one source record and several query-hit associations.

This supersedes the profile-owned collected-item storage in the earlier hourly collection design. Existing user/profile query-generation behavior is outside this change: ingest references an existing QuerySearchBuilder row as its lookup query, but does not copy its user/profile ownership onto jobs. Globally redesigning query generation or introducing shared query recipes is a separate task. Deleting a query may remove its hit associations, but must not delete shared jobs.

## Approaches

1. Source identity first (selected): deduplicate a channel's repeated observations; preserve distinct channel records and associate exact ATS identities.
2. Merge across channels: one job across sources, requiring conflict resolution and risking loss of source evidence. Not selected.

Company/title equality is never a deduplication rule. No semantic or fuzzy matching is included.

## Module boundary

Nest `IngestModule` provides an internal service accepting a lookup query ID, observation timestamp, and fetched items. Resolve the channel from the stored query and reject a mismatched batch. The module owns validation, normalization, identity resolution, persistence and the batch report. It does not fetch remote content, run paid collectors, schedule work, infer job details with AI, qualify jobs, or expose a public read API.

Keep channel-specific mapping in pure normalizers. Integrate the current collector output through a typed input adapter and retain its `raw` payload; missing upstream data remains null. Do not claim that existing collectors provide fields they currently omit. A service-level integration is sufficient until collection orchestration exists.

## Stored structure

`RawJob` contains:

- UUID primary key; channel; kind (`job` or `post`).
- Nullable external source ID; validated canonical source URL; optional application URL.
- Nullable title, company, location and publication timestamp; nullable publication precision (`hour` or `day`).
- Plain-text description; separate nullable author name and author URL for posts; optional contact name and URL.
- Original JSON payload; normalization version; firstSeenAt and lastSeenAt.
- Optional ATS association containing provider, tenant key (Ashby organization or Greenhouse board), and posting ID.

Post text is stored as description; a shortened first meaningful line can serve as its display title. An author must not become the employer. Unknown company data is null, rather than `Unknown`. Preserve original HTML in raw when deriving plain text. Do not infer salary, employment terms or other facts from prose in this stage.

`RawJobQueryHit` records query ID, raw-job ID, firstSeenAt, lastSeenAt, and optional latest observed URL/rank. Unique `(queryId, rawJobId)` preserves attribution across repeated collection. This is an aggregate hit record, not an immutable run history.

The implementation may represent the ATS association as a separate canonical-identity table. Its identity is `(provider, tenantKey, postingId)`. Different channel records can reference it without being merged.

## Identity and updates

Within a channel, a valid external ID is primary. When unavailable, a validated canonical URL identifies the record. Use channel-scoped identity aliases with unique `(channel, identityType, identityValue)` constraints so URL-only observations can later acquire an external ID without creating a second job.

Canonicalization uses source-specific, conservative rules: normalize supported host/path forms, remove fragments and known tracking parameters, retain query parameters that identify a posting. Never equate URLs merely by title or arbitrary path stripping. Missing/blank IDs and literal `undefined`/`null` are not identities. Unsupported or malformed source URLs are invalid.

Resolve ID and URL aliases transactionally. If they identify different existing records, report an identity conflict and leave both unchanged; do not silently merge. Likewise reject an attempt to attach a different explicit source ID to a record already holding one. Exact ATS URL parsing establishes associations only; no network lookups or fuzzy matching.

FirstSeenAt is the earliest accepted observation and lastSeenAt the latest. Refresh normalized content and raw payload only for newer observations; an equal or older timestamp may add query attribution but cannot overwrite newer content. A newly received item is a snapshot, so absent optional fields become null when that snapshot wins.

Database uniqueness and bounded retry on concurrent alias/upsert conflicts must make repeated or concurrent ingestion idempotent. Apply job, aliases, ATS association and query hit changes in one transaction per item. This allows valid items to survive malformed siblings.

## Validation and reporting

Validate batch query existence and timestamp before writes. Validate each item independently, including identity, nonempty content and JSON-serializable raw payload. Use explicit nullable fields rather than coercing arbitrary objects into strings.

Return inserted, updated, duplicate and invalid counts, accepted job IDs, and per-item validation/conflict reasons. An existing record receiving newer content is updated; a replay/stale observation is duplicate even if it adds query attribution. Infrastructure failures propagate for retry rather than being mislabeled as invalid data; previously committed items remain safe to replay. Do not log full payloads or descriptions.

## Implementation and verification

Use the existing NestJS, PostgreSQL Prisma contract/repository patterns and test runner. Add an additive migration and generated contract artifacts; do not apply migrations to an unspecified external database. Existing query tables and their ownership are not rewritten.

Verify normalizers using local fixtures for all four channels. Verify source identity, URL fallback/promotion, concurrent duplicate ingestion, query attribution across different profiles' queries, ATS association without cross-channel merging, identity conflicts, malformed item isolation, HTML/text handling and timestamp ordering. Test database uniqueness and transaction behavior against an isolated PostgreSQL instance where available. Automated tests must not call paid actors.

Builder-owned details: file organization, internal DTO names, safe HTML-to-text utility selection, bounded batch size, and transaction retry count. Record any inability to run database integration tests explicitly.

# 04: Ingest, process and match

## Goal

Every collected Indeed job is normalized, has its facts extracted by the existing processor, and is decided against each profile by the existing matcher, with the same rules and reasons as LinkedIn jobs. Qualified ones appear in the matches view with an Indeed label; rejected ones can be checked with their reasons.

This is the "prepare" and "extract" of the request: for listings, preparing is ingest's normalize step, and extracting is the processor.

## What exists

- Ingest mappers per actor (`ingest/normalize/mappers/`), `normalize.ts`, `merge.ts` (field precedence across sources), `job-key.ts` (`ats:` / `url:` keys when an employer apply link is known), raw items unique per `(channel, sourceKey)`, sightings per batch.
- The processor hand-off only for `PROCESSOR_CHANNELS` (`processor/config/processor.config.ts`, `infrastructure/jobs/steps/ingest/processor.ts`).
- The matcher, which is channel-blind once a job has an extraction.
- The web's source labels and filter (`apps/web/src/lib/matches/sources.ts`, `group.ts`).

## In scope

- The Indeed ingest mapper for the chosen actor: source key from Indeed's job key, description cleaned to text, company, place and country code, remote flag, salary, posted time (exact or relative), employer apply link when known.
- Job key: `ats:` / `url:` when the employer apply link is known, else an Indeed fallback key. Indeed's own apply or redirect URL is never a proof key.
- Merge precedence: where Indeed ranks against LinkedIn, Greenhouse and Ashby when one job has several sources. Proposal: below the ATS public APIs and harvestapi, above the trial actors.
- `INDEED` added to the processor and matcher channels, and to every channel `switch` and `Record`.
- The source label and filter entry in the web app.
- The non-remote leak rules (Phase 3 slice 09) treat Indeed's remote flag like LinkedIn's tag: the description wins when it states an arrangement.
- Indeed's "not remote" maps to untagged (no `workplaceType`), never to `onsite` or `hybrid`, so the pre-pipeline check of Phase 3 slice 03 (skips a listing only when its tag is `hybrid` or `onsite` in a country) never skips an Indeed job.

## Out of scope

- Likely-duplicate grouping (slice 05).
- Processor prompt or matcher rule changes. If Indeed jobs show a new failure pattern, it becomes its own slice.

## Open questions

- Claude quota: Indeed may add many jobs to process on the owner's subscription. Does it need a pre-filter before Claude (for example clearly non-engineering titles), and if so, which drops are safe given "missing the right jobs" is an anti-goal?
- ~~Indeed's descriptions are often HTML fragments; is the existing text cleaner enough?~~ Yes: `htmlToPlainText` gave a full description on 100% of rows on every actor (slice 01).
- Does `db:archive-actor` work for Indeed actors unchanged?

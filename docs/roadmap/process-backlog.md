# Process and Match backlog

Behaviour the old normalized ingest had, removed when ingest became raw storage (`docs/superpowers/specs/2026-10-31-ingest-raw-storage-design.md`). Process and Match must cover it again, from `raw_item_versions`. The old code is in git history: see the commit `refactor(ingest): drop normalized raw_jobs storage`, and the files `modules/ingest/utils/normalize.ts`, `modules/ingest/repositories/ingest.repository.ts` and the collectors' `toJob` mappers before `feat(jobs): collection stores raw batches and hands them to ingest`.

## Process (field extraction)

Covered for the LinkedIn job board by the processor (`apps/xjobs/src/modules/processor/README.md`): the validated extraction document holds arrangement, seniority, role kind, contract type, engagement, locations, tech tags and salary, stated or `null`/`unstated`, never guessed. Still open: LinkedIn posts, and Ashby and Greenhouse jobs that have no LinkedIn job board source, which the processor does not see.

- LinkedIn job board fields (the facts in the extraction are covered by the processor; the field mapping below belongs to ingest normalization): `id`/`jobId`, `url`/`link`/`jobUrl`, `applyUrl`, `title`, `companyName`/`company`, `location`, `publishedAt`/`postedAt` with hour or day precision, `descriptionHtml`/`description` converted to plain text, and the poster as a contact (`posterFullName`, `posterProfileUrl`).
- LinkedIn posts: the post body (`content`/`text`/`description`) as the description; its first meaningful line as a display title; the author kept separate from the employer (company is unknown, never the author); `article.link` as an apply link.
- Ashby postings: `title`, `locationName`, `publishedDate`, `descriptionHtml`. The board slug is not a company name.
- Greenhouse postings: `title`, `company_name`, `location.name`, `first_published`, `absolute_url`. `content` is entity-encoded HTML, so decode it once before converting it to text.
- Missing facts stay null. Salary, employment terms and similar are never inferred from prose without the LLM step that owns them.

## Match (identity across sources)

- ATS cross-linking: a LinkedIn job or post whose apply link names an Ashby posting (`jobs.ashbyhq.com/<org>/<uuid>`) or a Greenhouse job (`/<board>/jobs/<id>`, `/embed/job_app?for=&token=`, on the EU hosts too) is the same posting as the Ashby/Greenhouse record. Link them; do not merge the records.
- URL canonicalization for application links: drop the fragment and the `utm_*`, `trk*` and `gh_src` parameters.
- Never deduplicate on company and title equality alone.

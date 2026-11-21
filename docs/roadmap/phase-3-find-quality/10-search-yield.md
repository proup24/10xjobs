# 10: Search yield: bloated and weak searches

Found 2026-11-18 on `10xjobs-dev`. These findings came out of the review but haven't been discussed with the user yet. Their brainstorm comes first.

## What dev shows (2026-11-16 12:00 to 2026-11-17 17:00 UTC, 19 ticks, $2.33)

All 50 searches share one keyword, built from one profile:

`("tech lead" OR "technical lead" OR architect OR architecte OR developer OR développeur OR engineer OR engineering OR ingénieur OR programmer) AND ("nest.js" OR "next.js" OR "node.js" OR "react native" OR aws OR nestjs OR nextjs OR nodejs OR postgresql OR react OR typescript)`

| Search                     | Jobs | Qualified | Share of spend |
| -------------------------- | ---- | --------- | -------------- |
| US, mid-senior, remote     | 754  | 33        | 67%            |
| Europe, mid-senior, remote | 443  | 27        | 20%            |
| LATAM, mid-senior, remote  | 339  | 36        | 12%            |
| The other 47               | ~700 | 18        | ~1%            |

- **The keyword matches too wide.** 85% of rejections fail on position. Only 389 of 2,236 jobs were full-stack, and all 114 qualified jobs were among them. "engineer AND aws" catches backend, data, DevOps, AI and platform jobs.
- **Possibly missed right jobs.** 99 backend jobs and 70 frontend jobs had TypeScript, Node or React as their main stack. All were rejected on position. Whether a full-stack profile wants them is a profile question, not a search one.
- **Bulk posters.** EY posted 810 rows across two hours on 11-17, which cost $0.87 (37% of the two days). The same-tick split re-ran the cut-off search, so its first 100 rows were paid twice.
- **Weak searches.** 30 searches average under one job per run. They cost almost nothing, because charges are per row.
- **Paid rows LinkedIn doesn't tag remote (moved from [slice 09](09-non-remote-leak.md)).** 17% of raw rows from the remote searches had no workplace tag (538 rows, 405 of them EY's bulk posting). Likely cause: LinkedIn's forced AI job search drops the workplace filter (curious_coder's input schema, August 2026; unconfirmed for harvestapi). Slice 09 handles these jobs in matching, so the open part is cost only.
- **Coverage gap (accepted earlier).** Collection stops at 21:00 Morocco time, which is 16:00 ET. US postings are about 40% of rows, and the US afternoon is never collected. This was accepted in [slice 01](01-linkedin-source-data.md) _(user)_; revisit it with these numbers.

## Open questions

- Should the role side of the keyword follow the profile's position more closely (for example "full stack", "fullstack"), or stay broad and leave the position check to the matcher?
- Should a bulk poster be capped per company per run, or excluded? cheap_scraper has `companyExclude`; harvestapi has no such filter.
- Do backend or frontend jobs on the profile's main stack belong to a full-stack profile?
- Is the evening US gap worth more ticks, given the $6 daily cap?
- Does harvestapi's workplace filter still work? Test first: the same search with and without the remote filter, 100 rows each, run twice (about $0.40). The same rows both ways means LinkedIn ignores the filter. The result decides whether untagged rows are cut by company, by tag, or accepted as a cost.

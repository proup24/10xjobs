# Phase 4 slice 01: Collect LinkedIn hiring posts

Date: 2026-11-20
Status: draft
Roadmap brief: [docs/roadmap/phase-4-social-posts/01-collect.md](../../roadmap/phase-4-social-posts/01-collect.md)

## Intent

Many engineering roles are announced only in LinkedIn posts. Phase 4 finds those posts, qualifies them and emails the author automatically, so collection has to find the right posts without paying for a flood of the wrong ones. This slice collects hiring posts for every profile whose owner turned post search on, on the hosted schedule, and stores them as raw items at a known, capped daily cost. Cleaning, extraction, matching and email are slices 02 to 05.

## Goals

- Profiles have a post search switch, off by default for every profile (including existing ones). Only profiles with it on get post searches.
- Post searches are built from the profile's position, languages and technologies (and, for English, whether it wants remote), and merged across profiles the way the LinkedIn job board merges its searches.
- Collection runs hourly, every day, and each run looks back to where the last successful run ended (at most 24 hours), so nothing posted in between is missed.
- Spend is capped by one daily budget for the posts channel.
- The actor's silent failures are detected and never recorded as "nothing new".

## Non-goals

- Cleaning, pre-filtering or normalizing posts (slice 02). This slice stores raw posts only.
- Extracting facts, matching, showing posts in the web app, or emails (slices 03 to 05).
- Seniority in post searches. The matcher judges it.
- Trying another Apify actor. harvestapi stays; a trial can come later if its failures or price become a problem.
- Fixing the job board's React spelling gap (see "Side finding").

## Anti-goals

- Paying for posts that can never fit: searches that read nothing like a real post, or an uncapped day.
- Missing posts silently: a failed actor run recorded as an empty success, or a window skipped and never caught up within 24 hours.
- Running post searches for a profile whose owner never turned post search on.

## Decided

Marked _(user)_ where the owner decided, _(proposal)_ where it was my proposal and the owner accepted it without changing it, and _(evidence)_ where the paid probes of 2026-11-20 settled it.

### Starting point

- **The existing post collection code is deleted and rebuilt** _(user)_: `queries/channels/linkedin_posts.builder.ts`, `collectors/providers/linkedin-posts.collector.ts`, `collectors/providers/mappers/linkedin-posts.mapper.ts`, the post normalizer `mapLinkedinPost` and the posts wiring in the collection service and worker. It never ran on `10xjobs-dev`.
- **Kept:** the `linkedin_posts` channel name and enum value, and the shared machinery the job board uses: query search builders and recipes, segments, segment runs, windows (`coveredUntil`), claims, batches, raw storage, the daily budget and the schedules.

### The switch

- **A boolean on `profiles`** (e.g. `postSearch`, default `false`), owned by the user and covered by the profile's RLS policies like its other columns _(user: per-profile, off by default; column shape is my proposal)_.
- **It is the one setting that can change after a profile is published** _(proposal)_. Published profiles are otherwise immutable (`ProfilesService.getDraftOrThrow`). Existing profiles start off, so the owner's published profile needs this to be turned on.
- **Turning it on** attaches that profile's post search builders at once (a draft gets them when published). **Turning it off** detaches them at once; builders other profiles share keep running for those profiles. Posts already collected stay in raw storage. Job-board builders are never touched by the switch _(proposal)_.
- **A switch on the profile page in the web app** (`apps/web/src/app/(app)/preferences/profiles/[profileId]`), built from `components/ui` and theme tokens per `apps/web/DESIGN.md`, calling a new engine endpoint _(proposal)_.
- **Only allow-listed users can turn it on, for now** _(user)_. An engine setting, `POST_SEARCH_USERS`, lists the Supabase user ids allowed (empty by default, so nobody); it starts with only the owner _(setting name and ids are my call)_. The web app shows the switch only to listed users, and the engine refuses the change (403) for anyone else. Builders are generated, and kept by `db:regenerate`, only for profiles whose post search is on **and** whose owner is listed, so removing a user from the list and regenerating detaches their post builders. It opens to everyone later, once the cost per profile is known and the budget is raised.
- **Slice 04 must honour it:** only profiles with post search on are matched against posts. This slice records the switch; the matcher change is slice 04's.

### Search shape

LinkedIn post search, through `harvestapi/linkedin-post-search`, has no filters for place, arrangement or seniority, so what the job board puts in filters becomes words _(user)_. Its query rules, found in the probes _(evidence)_:

- **At most 5 boolean operators** (`OR`/`AND`/`NOT`) per query. A 6th makes the actor log `Too many boolean operators in the search query (max 5 OR/AND/NOT operators)` and return nothing, while the run still reports success. Spaces between words are not operators.
- **Every plain word must appear** in the post (a made-up word returned 0).
- **Dots inside a word are ignored:** `nodejs` and `"node.js"` found the same 390 posts in 24 hours, as did `nextjs` and `"next.js"`, and `reactjs` and `"react.js"` (14 of 15 shared).
- **A shorter word never matches a longer one:** `node` shared 0 of 15 posts with `nodejs`; `react` shared 2 of 15 with `"react.js"`. So `react` misses many React posts.
- **Accents make no difference** (`développeur` and `developpeur` returned the same posts).
- Each result echoes the search that found it in `query.search`, so several searches can share one run.

**No place words in any search, and no arrangement words except `remote` in English** _(user)_. Location and arrangement are judged later, in Prepare (slice 02) and the matcher (slice 04). The probes showed place words fail: `hiring developer morocco` found 20 posts a week and 0 with any technology; city lists don't scale to large countries (the US needs dozens of cities, and population misses tech hubs like San Francisco and Seattle); and place names differ per language.

Each search has one of two forms:

**English, for profiles with at least one remote place:** `hiring (<position words>) (<spellings>) remote`

```
hiring (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs) remote
```

**Other languages (French for now), for any arrangement:** `<hiring word> (<position words>) (<spellings>)`

```
recrute (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs)
```

- **English keeps `remote`** _(user, from evidence)_. Over the same 40 minutes, the English search with `remote` found 12 posts and without it about 50. All 12 were in the 50, and the extra 38 were almost all on-site or hybrid jobs in India and Pakistan. That's about $0.86 a day against $3.60 for the owner's main search.
- **English on-site and hybrid get no post search** _(user)_. The job board still covers them. An English-only profile with no remote place gets no post searches at all, and the switch's help text says so _(my call)_.
- **Other languages have no arrangement word** _(user, from evidence)_. `recrute … remote` found 0 posts in 24 hours, and `recrute …` without it found 15. French volume is small enough to take everything, which also covers French-language on-site posts, e.g. in Morocco.
- **One search per position × language × technology group**, plus remote-or-not for English _(user)_. Different positions never merge, even with overlapping stacks; the overlap costs only the rare post naming both positions.
- **Every technology the profile lists is searched** _(user)_, packed into groups that fit the operator limit with the position words. With 2 position words (1 operator), a group holds up to 5 spellings. A profile with more spellings gets more searches.
- **Spellings:** one per distinct word, with spellings that differ only by dots merged, built from the job board's `SEARCH_SPELLINGS` _(evidence)_. React becomes `react` + `reactjs` (2 slots), and `nodejs`, `nextjs` and `nestjs` are one each. A technology whose words already contain a chosen spelling as a whole word is dropped, e.g. React Native when React is searched, because every "React Native" post contains the word "react" _(proposal)_. The posts spelling list is separate from the job board's, so the job board is unchanged.
- **Languages:** English, plus each profile language that has a hiring word _(proposal)_. Each language gets its own searches rather than an OR across languages. **Only English and French ship** _(my call after review)_: they are the only ones the probes tested, and the only published profile uses them. A profile language without a hiring word adds no post searches. Spanish and German are added later, after a probe of their hiring words.
- **Hiring words per language,** in a hand-kept table next to `role-words.ts`; a change bumps the recipe version _(proposal)_: en `hiring`, fr `recrute`. Both were tested.
- **Position words** per position, at most 2 terms (1 operator), language-neutral (French posts say "full stack" too) _(proposal)_. E.g. `fullstack_engineer` → `fullstack`, `"full stack"`; `backend_engineer` → `backend`, `"back end"`; `frontend_engineer` → `frontend`, `"front end"`. The builder fills in the rest of `POSITION_TITLES` under the same rule.
- **No seniority words** _(proposal)_.

For the owner's profile (full stack; en + fr; typescript, nodejs, react, react native, nextjs, nestjs, aws, postgresql; remote in 13 places; on-site and hybrid in Morocco) this gives 4 searches, about $1 a day:

```
1. hiring (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs) remote
2. hiring (fullstack OR "full stack") (nestjs OR aws OR postgresql) remote
3. recrute (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs)
4. recrute (fullstack OR "full stack") (nestjs OR aws OR postgresql)
```

### Merging (approach 1)

- **At publish (or when the switch is turned on)**, each profile gets its own post builders, one per search above, each already packed to fit the operator limit, attached through `QuerySearchService.generate` like job-board builders (shared by hash, counted per profile).
- **At each tick**, builders sharing a segment key are grouped: `linkedin_posts|<language>|<position>`, where English is always the remote form. Whole builders are merged when their combined spellings still fit the operator limit, and a group is halved when it doesn't, as `fitChunks` does for the job board in `segments/services/segments.ts`. Places and arrangements never split a group, so profiles with the same position and language share every search.
- **A segment is one actor run with up to 10 merged searches** in `searchQueries`. Posts are credited back to builders through `query.search`, to every member of the merged search (as the job board credits listings).

### Cadence, window and budget

- **Hourly, every day, 24 runs a day** _(user: option A)_: Morocco time, `0 * * * *`.
- **Window:** from the builder's `coveredUntil` (minus a small overlap, my call: 5 minutes) to the tick, at most 24 hours; a never-collected builder looks back 24 hours. Passed to the actor as `postedLimitDate`, which the probe showed it honours, with `sortBy: date` _(proposal)_.
- **No limit on posts per search** _(user)_: `maxPosts: 0` (everything in the window).
- **One daily budget for the posts channel** _(user)_, counted per Morocco day like the job board's: `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`, default `1.50`. The existing daily budget check in `CollectionService.dailyBudget` is extended to this channel (today it covers only job-board channels) _(proposal)_.
- **Each run's Apify charge limit is what's left of today's budget** _(proposal)_, replacing the fixed `maxRunChargeUsd: 0.75`, so one large run can't overshoot the day. When Apify stops a run at its limit, the posts it returned are kept and the searches it didn't finish are marked failed, so they are retried next tick. When the budget is used up, the rest of the day's segments are skipped with the existing "daily budget reached" warning.

- **Known limit of the budget:** segments run in sorted key order each tick, so when a day's budget runs out, the keys that sort last are the ones skipped. Acceptable while volume is small; if it starts happening daily, the tick should rotate its starting segment _(my call after review)_.

### Failures

- **"No available resource" is a failure** _(evidence)_. The actor logs `Error scraping item#… : No available resource` when its own LinkedIn access pool runs out, returns 0 posts for that search, and reports the run as `SUCCEEDED`. In the probes it hit 2 of 3 parallel runs once, stopped two runs after their first page of 50 posts, and in the last probe hit every one of 5 attempts (one returned nothing, the others partial results). It's frequent enough that this check is essential, and harvestapi's reliability is a risk to watch in the rollout. The collector reads the run's log after each run and marks every search with such an error failed. A failed search's `coveredUntil` doesn't advance, so the next tick covers its window.
- **Too many operators is a failure too** (same log check). The builder never produces such a query; the check catches regressions.
- The detection is tied to log wording the actor can change, so the parser is a small tested function with the exact strings above, and a run whose log can't be read counts as failed _(proposal)_.

### Storage

- **Raw posts only.** Each run's posts go into a batch and raw storage as today, with the search that found each one. Nothing is normalized into `jobs` in this slice; ingest must accept a posts batch without a normalizer and create no job rows _(proposal)_. Slice 02 adds cleaning.
- Reposts and the same post found by several searches are stored as they come; Prepare (slice 02) deduplicates.

## Approaches

1. **Posts plugged into the job board's machinery** _(user: chosen)_. Per-profile post builders packed at publish; segments merge whole builders by key at each tick and halve groups that don't fit. Posts add only their own key, operator check, query text and failure check. It reuses windows, claims, segment runs, failure handling, the budget and schedules. The cost: two profiles whose groups don't fit together keep separate searches, so posts matching a shared word (e.g. `react`) are fetched and paid twice. For profiles with the same position that's a minority of posts, and it can be measured once collection runs.
2. **Spelling-level repacking at each tick.** All spellings in a group are pooled and repacked into the fewest searches, and each builder is linked to every merged search holding one of its spellings. Fewest duplicates, but a builder's window, failure and crediting depend on several searches at once: new many-to-many logic in the most delicate part of collection, to save a small share of duplicates. It can be built later inside approach 1's structure if duplicates turn out large.
3. **A separate posts pipeline** with its own planner, collector and run tracking. A clean slate, but it duplicates windows, claims, budget and failure handling, which then drift apart, against the roadmap's warning.

## Constraints

- LinkedIn data only through Apify; harvestapi needs no LinkedIn cookies.
- The hosted engine's Apify account (paid, `$19` monthly limit) is shared with the job board, which alone reaches the limit around 2026-11-30. Post collection is about $1 a day for the owner's profile, almost all from search 1, so the owner needs to raise the Apify limit before turning post search on on the hosted engine.
- Schedules register only with `XJOBS_RUN_SCHEDULES=1` (hosted engine).
- The Prisma contract is the only schema source; the migration ref hash in `app/refs/db.json` must advance or the migration never applies.
- Any change to search words, tables or packing bumps `QUERY_SEARCH_RECIPE_VERSION`. Regeneration (`db:regenerate`) must attach post builders only to profiles with post search on.

## Probe evidence (2026-11-20, free Apify account)

About $1.20 across about 45 runs. Volumes are the actor's reported totals for 24 hours unless noted. **Totals near 390 are LinkedIn's result ceiling, not real volume** (broad searches kept reporting 388 to 394); the timed comparisons below are the reliable measure.

| Search                                                                            | Posts     | Notes                                                    |
| --------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `hiring (developer OR engineer) (react OR typescript OR nodejs OR nextjs) remote` | 394       | Mostly real hiring; heavy India and job-aggregator noise |
| `hiring react remote`                                                             | 247       | Same quality without role words                          |
| `hiring fullstack remote`                                                         | 169       | Good, plus job digests                                   |
| `hiring developer morocco`                                                        | 20 a week | About half relevant                                      |
| `recrute (developpeur OR ingenieur) maroc`                                        | 11 a week | One industrial post, reposted 7 times                    |
| any Morocco search with a technology                                              | 0         |                                                          |
| `recrute (fullstack OR "full stack") (…5 techs) remote`                           | 0         | French posts don't say "remote"                          |
| `recrute (fullstack OR "full stack") (…5 techs)`                                  | 15        |                                                          |

Technologies only versus position plus technologies, over the same 31 minutes: the technologies-only search returned 46 posts and the position one 12. 11 of the 12 were also in the 46, and the 46 added no fitting post (about 30 were Java, Salesforce, Oracle and similar roles). The position search's noise is mostly job seekers, which Prepare can drop cheaply. At its rate, the owner's search 1 sees about 20 to 25 posts an hour.

With and without `remote` (English, position plus 5 technologies), over the same 40 minutes: 12 posts with it, about 50 without. All 12 were in the 50; the extra 38 were almost all on-site or hybrid jobs in India and Pakistan, about 4 of them remote-ish. About $0.86 against $3.60 a day.

Price: $0.002 a post and $0.001 a run on the free account; the paid account may be cheaper per post.

## Side finding (not in this slice)

The job board's `SEARCH_SPELLINGS` has no `reactjs` / `react.js` for React. If LinkedIn job search treats words like post search does, job-board React searches miss listings that say only "React.js". Worth checking with `db:spellings` separately.

## Left to the builder

- The exact column, endpoint and web component names for the switch.
- Position words for the positions not listed above, under the 2-term rule.
- How the segment key and operator check plug into `segmentKey`, `planSegments` and `fitChunks` without changing job-board behaviour.
- How a run's log is read and parsed for failures, and how a partly failed run records which searches advanced.
- How ingest stores a posts batch without creating jobs.

## Rollout check on dev

After deploy, with the owner's post search turned on and the Apify limit raised:

- The owner's profile has the 4 post builders above, and a profile with post search off has none.
- Over the first full day: 24 ticks ran, posts batches landed in raw storage, spend stayed within the budget, and any "No available resource" search was marked failed and covered by a later tick.
- A sample of 30 stored posts read by hand: most are real hiring posts for the profile's roles.
- Turning the switch off removes the owner's post builders, and the next tick runs no post search for them.

## Open for later slices

- **Slice 04:** only profiles with post search on are matched against posts.
- **Slice 05:** whether turning post search on is also consent for the automatic emails, or emails get their own switch.

# harvestapi/linkedin-post-search

The LinkedIn post search actor. Mapper: `apps/xjobs/src/modules/ingest/normalize/posts/payload.ts` (`readPostPayload`, the only place that knows these field names). Fixtures: `apps/xjobs/src/modules/ingest/normalize/posts/fixtures/` (real payloads, committed as collected).

This page describes all 520 `LINKEDIN_POSTS` raw items on dev as of 2026-11-22, using each item's latest version. Some items have more than one version, for 647 versions in all.

## Output

Each item is one post. `type` is always `"post"`. `query` is the search that found it (`search`, `page`, `sortBy`, `postedLimit`).

| Field                                                | Shape                                                                                                                   | Present       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| `id`, `entityId`                                     | Activity id as a string. The two are always equal.                                                                      | 520           |
| `linkedinUrl`                                        | Post link. See "Group posts" for the one exception.                                                                     | 520           |
| `shareUrn`, `shareLinkedinUrl`                       | `urn:li:share:…` (424), `urn:li:ugcPost:…` (35) or `urn:li:groupPost:…` (61), and a `/feed/update/<urn>` link           | 520           |
| `content`                                            | Full post text, never empty                                                                                             | 520           |
| `contentAttributes[]`                                | `{type, start, length, textLink, hyperlink, profile?, company?}` spans over `content`                                   | 442 non-empty |
| `postedAt`                                           | `{date (ISO), timestamp (ms), postedAgoText, postedAgoShort}`                                                           | 520           |
| `author`                                             | See "Author"                                                                                                            | 520           |
| `header`                                             | `{text}`. `text` is null except on group posts, which also carry `linkedinUrl`.                                         | 520 (61 text) |
| `postImages[]`                                       | `{url, width, height}`                                                                                                  | 74 non-empty  |
| `article`                                            | Link preview: `{link, title, subtitle, linkLabel, description (always null), image ({url, width, height} or null)}`     | 79            |
| `document`                                           | PDF or carousel: `{title, totalPageCount, transcribedDocumentUrl, manifestUrl, manifest, coverPages[]}`                 | 8             |
| `postVideo`                                          | `{videoUrl, thumbnailUrl}`                                                                                              | 7             |
| `job`                                                | Attached LinkedIn job: `{title, subtitle ("Job by <company>…"), location, linkedinUrl, logoUrl, buttonText, buttonTip}` | 5             |
| `showcase`                                           | "Open to work" card: `{title ("<name> is open to work"), subtitle, link, ctaLink, ctaTitle, picture}`                   | 17            |
| `repost`, `repostId`                                 | The shared original, nested. See "Shares and reposts".                                                                  | 2             |
| `engagement`                                         | `{id, likes, comments, shares, reactions[{type, count}]}`                                                               | 520           |
| `socialContent`                                      | `{shareUrl, trustInterventionBanner (always null), hideSendAction?, hideShareAction?}`                                  | 520           |
| `comments`, `commentIds`, `reactions`, `reactionIds` | Always empty arrays                                                                                                     | 520           |

There is no language field, no `urn`, `url` or `postUrl` at the top level, and no headline other than `author.info`.

## Author

`author.type` is `"profile"` (347) or `"company"` (173). Nothing else appears.

- A profile has `publicIdentifier` (the `/in/<slug>`, all 347), `profileId` and `id` (the `ACoAA…` member id), `urn` (numeric), `name`, `info` (the headline), `linkedinUrl`, `avatar` (`{url, width, height}` or null), `website`, `websiteLabel`. `universalName` is always null.
- A company has `universalName` (the `/company/<slug>`, all 173), `companyId`, `id` and `urn` (all the same numeric id), `name`, `info` (the follower count, e.g. "27,311 followers"), `linkedinUrl` (`/company/<slug>/posts`), `avatar`, `website`, `websiteLabel`. `publicIdentifier` is always null.

Fixture: `company-author.json`.

## Shares and reposts

A share with added text carries `repost` (an object) and `repostId` (the original's id, equal to `repost.id`). The outer `content` is the sharer's own text, and it is never empty. 2 of 520 posts are shares. Both of them carry their original nested.

`repost` has the same shape as a top-level post, minus `type`, `query`, `reactions`, `commentIds` and `reactionIds`:

- id: `repost.id` and `repost.entityId`; link: `repost.linkedinUrl`; `repost.shareUrn`
- text: `repost.content` (full, not truncated)
- author: `repost.author`, the same shape as above (one profile and one company)
- date: `repost.postedAt.date`
- attachments: `repost.postImages` (1 share), `repost.document` (1 share). No `repost.article` occurred, but the field is likely the same as the top-level one.

The original's attachments stay nested: in both shares the outer `postImages` is empty and the outer `document` is absent while `repost.postImages` and `repost.document` hold the original's. Neither share has a top-level `article`. So a top-level `article` (or `job`) on a share belongs to the sharer, and only `repost.article` and `repost.job` are the original's. The mapper reads the nested object exactly as a post scraped alone (`readOriginal` in `payload.ts`), so a share keys like its original.

No plain repost (a repost without added text) occurs among the 520 posts. Neither does a share whose outer text is empty. The search probably returns only posts with matching text. So there is no `repost.json` fixture. The two shared originals never appear as items of their own.

Fixture: `share.json` (a profile resharing their own earlier post, with an image on the original).

## Text and links

- `content` is never empty and never cut. Lengths run from 147 to 2,999 characters (LinkedIn's limit is 3,000). No post ends in "…see more". One post ends in "…", which is the author's own text.
- Links in `content` are mostly LinkedIn short links (`https://lnkd.in/…`). `contentAttributes` with `type: "TEXT_LINK"` repeat each linked span. `textLink` holds the same short URL (or a `mailto:`, or a word LinkedIn auto-linked, such as `http://ASP.NET`). It does not expand short links. `PROFILE_MENTION` and `COMPANY_NAME` spans carry `hyperlink` (a linkedin.com URL) and a `profile` or `company` object.
- `article.link` is usually not in the text (77 of 79). It is the real target, such as a job page on remoteyeah.com, jobs.micro1.ai or jobs.ashbyhq.com, or a portfolio.

## Attached jobs

`job.linkedinUrl` is `https://www.linkedin.com/jobs/view/<id>/?refId=…&trackingId=…`. The `refId` and `trackingId` change between scrapes of one post (both posts with two versions show two different values), so the mapper reads the link as `https://www.linkedin.com/jobs/view/<id>/`. `buttonText` and `buttonTip` are always "View job".

## Group posts

61 posts were made in LinkedIn groups. Their `header.text` is "New post in <group name>". Their `linkedinUrl` is `/feed/update/urn:li:groupPost:<groupId>-<postId>` and does not contain `id`. `header.linkedinUrl` holds the activity link with `id`.

## Image-only posts

None. 74 posts have images, and all of them have at least 147 characters of text. There is no `image-only.json` fixture.

## Versions

Between consecutive versions of one item, `query` changes most often (124 of 127 pairs), then `socialContent`, `postedAt` (only the "ago" texts; `date` never changes) and `engagement`. `content` changed in 2 pairs (edited posts).

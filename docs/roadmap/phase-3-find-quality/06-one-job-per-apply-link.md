# 06: One job per apply link

Found 2026-11-17 on `10xjobs-dev`. Nothing is specced yet; this brief is the starting point for the brainstorm and spec.

## Problem

A user opened a qualified BairesDev job to apply, and the site said they had already applied. The list showed it as a different job from one they had already marked applied, so they nearly applied twice.

The rule the user wants: **jobs that share an apply link are one job.** Merge them, and keep a note that they were merged. Where the merged postings differ (title, description, place or other details), the UI should say so, so the user can tell a merged job from a single posting.

## The rule today, and why

The ingest spec (`docs/superpowers/specs/2026-11-01-ingest-normalized-jobs-design.md`) first keyed a LinkedIn job by its canonical apply URL. It was revised the same day (normalizer version 2) to **apply URL plus exact title**: `url:<canonical>|<exact title>` (`apps/xjobs/src/modules/ingest/normalize/job-key.ts:88`).

The reason it gives: on some job boards (Paylocity, UKG, SuccessFactors) the identifier in the URL names the company's listing page, not the role, so one URL can serve several different roles. The title kept them apart. The side effect is that copies of one ad posted under different titles never merge.

Other parts of the key are unchanged by this slice:

- `ats:` keys (Ashby, Greenhouse) already name the posting.
- `linkedin-job:` is the fallback when there is no usable apply URL.
- The canonical URL strips tracking parameters (`utm_*`, `trk*` and so on) and sorts the rest.

## What dev shows (2026-11-17)

Live jobs with a `url:` key, grouped by the URL part alone: 4 groups, 19 jobs, 15 of them extra copies. In every group the titles differ.

| Company   | Copies | Apply link                                                                                  | Titles                                                                                                                                                                                                                            |
| --------- | ------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hired     | 9      | `tnl2.jometer.com/v2/job?jx=…BEAMJCTE…&jz=…`                                                | AWS Cloud Engineer; Cloud Engineer; Cloud Infrastructure Engineer; Cloud Operations Engineer; Cloud Platform Engineer; Cloud Solutions Engineer; DevOps Engineer; Google Cloud Engineer; Infrastructure Engineer (all "(Remote)") |
| Hired     | 6      | `tnl2.jometer.com/v2/job?jx=…CAAMJCTE…&jz=…`                                                | Contract Software Developer; Freelance Software Developer; Freelance Software Engineer; Software Developer; Software Development Engineer; Software Engineer (all "(Remote)")                                                     |
| BairesDev | 2      | `applicants.bairesdev.com/job/615/287041/apply`                                             | Desarrollador Front-End (Angular) - Trabajo Remoto; Front-End Developer (Angular) - Remote Work (both Colombia)                                                                                                                   |
| Scopic    | 2      | `scopicsoftware.zohorecruit.com/jobs/Careers/741923000044254139/Remote-Solutions-Architect` | Remote Solutions Architect; Solutions Architect - Remote Position                                                                                                                                                                 |

The Hired groups are one ad posted under many keyword titles. Kept apart, each copy is processed and matched on its own, which costs processor spend and puts repeat jobs in front of the user.

## The case that started it (not caught by the link)

Job `01a1e589-0fc7-7674-a69d-2438256345f4` is BairesDev "Full Stack Developer (React + Node) - Remote Work", qualified, with apply link `applicants.bairesdev.com/job/111/282841/apply`.

- No other job on dev has that link, with or without its query string.
- The user had already marked applied "Staff Software Engineer (Full Stack) - Remote Work" (`01a1e5f5-e5d9-7642-9c49-e9e2a60a739a`), whose link is `applicants.bairesdev.com/job/111/287470/apply`.
- The user confirmed that both links take you to the same page on BairesDev's site.

So the links differ, but they land on the same application. BairesDev links look like `/job/<group>/<posting>/apply`, and every Node.js posting seen is under group `111`. Whether a same-group link always lands on one page, and whether it redirects or the page simply matches, is unconfirmed. A rule that compares the stored link text can't merge this case. It needs either the link's final destination (fetching it) or per-site knowledge.

## Open questions

- **Listing-page boards.** Dropping the title from the key would wrongly merge different roles behind one listing URL on the boards that caused the 2026-11-01 revision (Paylocity, UKG, SuccessFactors). Keep a title split only for a known list of such hosts? Or require the identifier to look like a posting id?
- **Same page, different link** (the BairesDev `111` case):
  - Follow redirects at ingest and key on the final URL? That costs one request per new link, and some sites block bots.
  - Or add a per-host rule for BairesDev?
  - Or leave it to the user's decisions: when you mark a job applied, flag other jobs with the same company and a close title?
- **What a merged job shows.** Which posting's title, description, place and salary become the job's? How does the UI show that its sources differ, for example "posted 9 times under different titles" with each one listed?
- **The note.** The ingest model already keeps every raw source linked to its normalized job, and marks a job left with no sources as `merged` with `mergedIntoId`. Is that enough to show "merged from N postings", or does the job need a stored summary of what differs?
- **Existing decisions.** If two jobs merge and the user had decided on one (applied, not for me, a review choice), the decision should carry over to the merged job. What if they decided differently on each?
- **Places.** Copies of one ad often name different cities (the Sii Poland case in the ingest spec). After merging, the job's openings should be the union of its copies' places, and the matcher already reads several openings.

## Suggested path

1. Change the `url:` key to the canonical URL alone, except on a short list of listing-page hosts that keep the title. Bump `NORMALIZER_VERSION`, then run `db:renormalize`. The existing move-and-mark-`merged` logic handles the regrouping.
2. On a merged job, keep each source's title, place and description reachable, and record whether they differ.
3. In the web app, mark a job that merged postings with different details, and list the postings.
4. Carry decisions and review choices from merged-away jobs to the job they merged into.
5. Decide separately whether the same-page-different-link case (BairesDev `111`) is worth fetching redirects for. Measure first: how many apply links on dev redirect to a URL that another job already has.
6. On dev, check:
   - The 4 groups above become 4 jobs.
   - The Angular pair shows both titles.
   - Processor jobs-per-day drops by the duplicates.
   - No two different roles behind one listing URL got merged.

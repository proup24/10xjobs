# Residence check for strict job locations

Date: 2026-11-17
Status: approved 2026-11-17

## Problem

A profile's locations list does two jobs: it decides where the channels search, and it decides which jobs pass the location check. Listing a place to search it also accepts jobs that only hire people living there.

Example: job `01a1e54f-03ac-741f-9509-d23497358c7e` ("Full Stack Developer", Solvex Solutions) says "Location: 100% Remote opportunity (All over UK)". The processor read it correctly as one opening `{ ["remote"], [country GB], label }`. The user lives in Morocco but lists the `UK` region under remote to search there, so the job qualified. A Moroccan resident cannot take it.

The account already stores where the user lives (`users.residenceCountry`) and their work authorizations (`work_authorizations`). The location rule never reads them.

## Goal

A remote job whose description ties it to places qualifies only users who live in one of those places. Users keep searching wherever their locations list says.

## Non-goals

- A new preference field. Residence and authorizations already exist _(user)_.
- Using LinkedIn's location field for this check. LinkedIn's place alone never triggers it; a LinkedIn-only place keeps today's behaviour against the locations list _(user)_.
- Spotting cross-listings (one posting listed under several countries). Not needed once LinkedIn's place is out of scope.
- The processor reading "Work from anywhere" in a benefits list as a perk (LawnStarter case). A separate prompt fix.
- Onsite and hybrid openings. Their place is the office, and the onsite and hybrid lists already mean "I would work there", relocation included.

## Anti-goals

- Rejecting jobs open to the user because of a LinkedIn location or a passing mention of a place.
- Rejecting users who have not set a residence.

## Approaches

- **In the location rule (chosen).** `checkArrangement` in `apps/xjobs/src/modules/matcher/rules/location.ts` already sees each opening's strictness and `placesSource`, and `MatchProfile.eligibility` already carries residence and authorizations. The check stays per opening, so "any one opening fits" keeps working, and a rejection's reason shows under the location rule.
- **As a residency requirement in the facts, judged by the work-authorization rule (rejected).** That rule counts citizenship as meeting residency, it loses the per-opening logic ("Costa Rica remote, or Toronto hybrid"), and the reason would show under work authorization, which makes wrong rejections harder to find.
- **Cross-listing union in facts, matcher, or ingest merge (dropped).** Answered a question the user then took out of scope (LinkedIn places never trigger the check).

## Design

### When the check applies

For an opening checked under the `remote` arrangement, the residence check applies when all of these hold:

- `placesSource` is `description`.
- `placeStrictness` is `label` or `limit` (a location line, a title place, or limiting words). Treating `label` as strict is the user's call. Reversed 2026-11-20 for extractions from 2026-11-20 14:50 UTC on: only `limit` binds, see 2026-11-20-non-remote-leak-design.md.
- The user has at least one home place (below).

It does not apply to `mention` or `unstated` openings, to openings whose places came from LinkedIn, or to the `hybrid` and `onsite` arrangements.

### Home places

A user's home places are `residenceCountry` plus the place of each `residency` authorization. Citizenship and work permits do not count: "based in Europe" is about where someone lives, and those already count in the work-authorization rule. _(Claude's call, agreed in the conversation.)_

A user with no home places keeps today's behaviour. On dev that is 4 of 5 users.

### How a place is judged

The remote arrangement passes when the existing check against the locations list passes **and** a home place falls inside at least one of the opening's places:

| Job place      | Home place fits when                                                  |
| -------------- | --------------------------------------------------------------------- |
| worldwide      | always                                                                |
| country        | it is that country                                                    |
| region         | it is one of the region's countries (`region_countries`)              |
| city           | it is the city's country (a remote job does not need the city itself) |
| several places | any one fits                                                          |

When the index cannot place a region or city (an unknown code, a city with no country), the residence check is `unknown`, not `fail`, so the job goes to review. The existing `overlaps` and `PlaceIndex` in `rules/places.ts` already compute country sets; the builder should reuse them.

The existing time-zone check is unchanged and still runs after the place check.

Expected results:

| Resident of    | "Remote US" | "Remote (US, Canada)" | "Remote Europe" | "Remote EU" | "Remote EMEA" | "Berlin / Full-Remote" |
| -------------- | ----------- | --------------------- | --------------- | ----------- | ------------- | ---------------------- |
| Morocco        | fail        | fail                  | fail            | fail        | pass          | fail                   |
| Germany        | fail        | fail                  | pass            | pass        | pass          | pass                   |
| United States  | pass        | pass                  | fail            | fail        | fail          | fail                   |
| United Kingdom | fail        | fail                  | pass            | fail        | pass          | fail                   |

### Sureness

A residence failure on an opening with `confidence: unsure` rests on `openings`, as a place failure does today (`openingUnsure`), so it marks the decision unverified, not a sure reject.

### Reason and detail

A failure says why, so wrong rejections can be found. Example: `job location (remote in GB, stated in the description) requires living there; you live in MA`. The per-opening `detail` gains the home places used and whether the residence check decided the outcome.

### Matcher inputs

The residence and authorizations now affect the location outcome. The matcher already rematches when eligibility changes (`eligibilityVersion`, bumped by triggers on `work_authorizations` and `residenceCountry`, and stored on each match), so a user who sets or changes their residence gets their location decisions redone with no new wiring.

### Rollout

1. Bump `MATCHER_VERSION` (6 to 7) in `apps/xjobs/src/modules/matcher/config/matcher.config.ts`.
2. After merge and deploy, run `pnpm --filter @xjobs/xjobs db:rematch -- --all` on dev.
3. Compare with `db:match-shares`: the user's qualified matches from description-stated foreign places should move to rejected, LinkedIn-only ones should stay, and the review share should not grow noticeably.

## Left to the builder

- Function names and where the home-place helper lives.
- Exact reason wording, within the example's shape.
- Tests: the table above as unit cases in `location.spec.ts`, plus the no-residence, LinkedIn-only, `mention`, unknown-region and hybrid/onsite cases.

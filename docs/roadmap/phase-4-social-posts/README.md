# Phase 4: Social posts

Date: 2026-11-19
Status: slice 01 built

## Intent

Many engineering roles are announced only in LinkedIn posts ("We're hiring a senior React engineer, send your CV to …"), never on a job board. This phase finds those posts for each published profile, qualifies them like listings, and emails the author from the user's Gmail with the profile's resume attached, with no human step in between.

Because nothing is reviewed before sending, precision matters more here than anywhere else. A wrong email can't be unsent and goes out under the user's name. The project's anti-goals apply in full: don't email about the wrong jobs, don't miss the right posts, and never spam post authors.

## How this folder works

Same as Phases 1 to 3: each slice is a short brief covering the goal, what exists, what's in and out of scope, and the open questions. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs. The slices are built in order; each one depends on the one before.

## Slices

| #   | Slice                                          | Status                                                                     |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| 01  | [Collect](01-collect.md)                       | Built ([spec](../../superpowers/specs/2026-11-20-posts-collect-design.md)) |
| 02  | [Prepare](02-prepare.md)                       | Brief                                                                      |
| 03  | [Extract](03-extract.md)                       | Brief                                                                      |
| 04  | [Ingest and qualify](04-ingest-and-qualify.md) | Brief                                                                      |
| 05  | [Send email](05-send-email.md)                 | Brief                                                                      |

## The pipeline

1. **Collect:** search LinkedIn posts for each published profile, on the hosted schedule.
2. **Prepare:** clean each raw post and pre-filter out posts that aren't hiring, with cheap rules, before any Claude call.
3. **Extract:** a Claude step reads each remaining post and pulls out its facts: role, stack, seniority, arrangement, location, company, contact email, apply link.
4. **Ingest and qualify:** the extracted post is decided against each profile as qualified, review or rejected, with a reason, and shown in the web app.
5. **Send email:** a qualified post with a contact email gets an email from the user's Gmail.

## Decided

- **Phase 4 is social posts with automatic emails** _(user)_. Tailored resumes and form filling, previously in Phase 4 "Apply", move to a later phase.
- **Fully automatic sending** _(user)_: when a post is qualified and states a contact email, the email is sent with no approval step. This replaces the roadmap's earlier default that nothing goes out without the user approving it.
- **Prepare is cleaning and a pre-filter; Extract is a Claude step that pulls out the facts** _(user)_.
- **Apify spend grows with post collection; the owner tops up credit when needed** _(user)_.
- **Email v1 is a template,** based on the owner's example (below). Personalization per post comes later _(user)_.
- **Safeguards for automatic sending** _(my proposal, agreed in the brainstorm; slice 05 settles the details)_:
  - Only a clean `qualified` decision sends. A `review` decision, or a post with no role found, never does.
  - The address must be stated in the post. It's never guessed from the author or company. A post that asks for a DM or a comment instead gets no email.
  - At most one email per user to an address and per post, even across several profiles or reposts.
  - A daily cap per user and a global kill switch.
  - Every sent email is visible to the user with its content, time and match reason.
  - No connected Gmail or no resume: nothing is sent.

## The owner's example email

Subject: `Application to Full Stack Engineer (Typescript + React + Node.js)`

```
Hi there,

Reaching out regarding the Full Stack Engineer (Typescript + React + Node.js) position you posted on LinkedIn.

The role aligns with my expertise as a developer and with what I'm looking for.

I have attached my resume to this email, find me on LinkedIn and feel free to connect.

I'd love to chat with you and your team about the role!

Best,
Souhail
```

## Suggested direction (not decided)

Posts join the existing job pipeline rather than getting a separate one: a prepared post becomes a job record like a listing, Extract writes the same facts the job-board processor does (plus contact fields), and the existing matcher qualifies it with the same rules and reasons. A separate post pipeline would duplicate every matching rule and let them drift. Slices 03 and 04 confirm or reject this in their brainstorms.

## Exit criteria

- The hosted engine collects, prepares, extracts and qualifies LinkedIn hiring posts for every published profile on a schedule.
- Qualified posts appear in the web app with their facts, the original post and why they matched; posts dropped by Prepare or rejected by the matcher can be checked with their reasons.
- A user can connect their Gmail and edit their email template.
- A qualified post with a stated contact email gets exactly one email from the user's Gmail with their resume attached, within the safeguards above, and the user can see it.

## Out of scope for this phase

- Claude-written personalization for each email (after v1).
- Replying to, following up on or tracking responses to emails (Phase 5 territory).
- DMs, comments or connection requests on LinkedIn.
- Tailored resumes and application forms.

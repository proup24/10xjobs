# 05: Send email

## Goal

A post that qualifies for a profile and states a contact email gets one email from the user's Gmail, with the profile's resume attached and no human step. The user can see every email sent.

## What already exists (on `main`)

- One resume PDF per profile, stored privately, meant to be "sent with applications as it is" (Phase 1 slice 06).
- Match webhooks: the engine already acts on new matches for a user.

## Decided

- Fully automatic: a qualified post with a stated contact email is sent with no approval step _(user)_.
- Email v1 is a template based on the owner's example (see the README): subject `Application to {role}`, the role filled in from Extract, the user's name and LinkedIn URL. Personalization per post comes later _(user)_.
- The safeguards in the README's "Decided" list _(agreed in the brainstorm)_.
- **One email per user per address and role, not per address** _(user, 2026-11-21)_: an address that heard about one role can still get an email about a later, different role at the same company; a repost of the same role gets none. Slice 02 merges only exact duplicate posts, so a lightly edited repost reaches this slice as a new post, and this rule is what stops the second email.
- **An emailed post is an `applied` decision and shows in Applications**, never under Matches _(user, 2026-11-25, slice 04 brainstorm; replaces the Applied tab)_.
- **At most one email per linked group** _(user, 2026-11-25)_: slice 04 links posts and listings that share a job key. The first qualified role in a group is emailed; no email goes out for a group the user already applied to, through a listing or another post.
- **Missing facts don't hold a post back** _(user, 2026-11-25)_: a qualified but unverified post is emailed like any qualified one.
- **A post by an author the user blocked is never emailed** (the per-user list from slice 04a) _(user)_.

- **Gate** _(user, 2026-11-22, slice 03)_: nothing is sent automatically until slice 03's post eval passes its bars on the current prompt, schema and model: no not-hiring or junk post comes out hiring with a contact email, the contact email is exact on every hiring post, and at least 95% of hiring posts come out hiring.
- **Never for an unsure verdict** _(user, 2026-11-22)_: a role job whose post verdict is unsure is never emailed, whatever its match outcome.
- **One email per post per user**, naming the role that matched, when a post names several roles (slice 03 makes one job per role).

## In scope

- Connecting a user's Gmail, with permission only to send.
- The user's email template, editable in the web app.
- Sending, with the safeguards: clean `qualified` only, the address stated in the post, one email per address and role, no email to a blocked author, a daily cap, a kill switch, no Gmail or no resume means nothing sent.
- A record of every email sent, visible to the user in Applications.

## Out of scope

- Claude-written personalization.
- Follow-ups, replies and tracking responses.

## Open questions

- Gmail permission and Google's app verification: what invite-only allows, and what wider access would need.
- What the user sees before Gmail is connected: "would have emailed" in Applications?
- How "same role" is told from "new role" for one address: which of Extract's facts (company, role title) must match, and what happens when one is missing?
- How many different roles may one address hear about from one user before it counts as spamming that recruiter?
- The daily cap: how many, and per user or per profile?
- Beyond blocked authors (slice 04a), does a user need to block an address or company, or to pause sending?
- Should the template be per user or per profile?
- How long after a post appears is it still worth emailing?
- Can this slice split into two sessions: connecting Gmail and the template, then sending?

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
- **Emailed posts show under Applied on the social posts page** (slice 04a), never under Matches _(user)_.
- **A post by an author the user blocked is never emailed** (the per-user list from slice 04a) _(user)_.

## In scope

- Connecting a user's Gmail, with permission only to send.
- The user's email template, editable in the web app.
- Sending, with the safeguards: clean `qualified` only, the address stated in the post, one email per address and role, no email to a blocked author, a daily cap, a kill switch, no Gmail or no resume means nothing sent.
- A record of every email sent, visible to the user under Applied on the social posts page.

## Out of scope

- Claude-written personalization.
- Follow-ups, replies and tracking responses.

## Open questions

- Gmail permission and Google's app verification: what invite-only allows, and what wider access would need.
- What the user sees before Gmail is connected: "would have emailed" under Applied?
- How "same role" is told from "new role" for one address: which of Extract's facts (company, role title) must match, and what happens when one is missing?
- How many different roles may one address hear about from one user before it counts as spamming that recruiter?
- The daily cap: how many, and per user or per profile?
- Beyond blocked authors (slice 04a), does a user need to block an address or company, or to pause sending?
- Should the template be per user or per profile?
- How long after a post appears is it still worth emailing?
- Can this slice split into two sessions: connecting Gmail and the template, then sending?

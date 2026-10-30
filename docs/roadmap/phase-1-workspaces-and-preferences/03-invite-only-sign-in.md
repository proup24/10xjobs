# 03: Invite-only sign-in

## Goal

Only invited people can get in, and they sign in by email with no password.

## In scope

- Public sign-up turned off in Supabase Auth.
- An admin invite path. It can start as a small script or the Supabase dashboard, and an admin page can come with the UI slices.
- Email sign-in: each email carries both a magic link and a 6-digit code (my call), so it works whether the user clicks or types.
- A production email sender connected to Supabase Auth, since the built-in mailer only allows a few emails an hour.
- Minimal sign-in and sign-out pages and session handling in Next.js. Signed-out users can't reach app pages.

## Out of scope

- Google or any other OAuth.
- A waitlist, or users inviting others.
- Passwords.

## Locked

- Invite-only, no waitlist, admin-only invites.
- Magic link or one-time code. No Google auth.

## For the slice spec

- Which email provider (Resend, Postmark or similar). The maintainer sets up this account.
- Whether an invite expires, can be revoked, or is tied to one email address.
- What a non-invited email sees when it tries to sign in: a neutral message that doesn't confirm whether the address is known.
- Session length, and how sign-in links are protected against expired or reused links.
- Email templates and sender domain.

## Done when

An invited email can sign in with either the link or the code and lands in their workspace. A non-invited email can't create an account, and signed-out requests can't reach app pages or data.

# Phase 1, slice 03: Invite-only sign-in

Status: draft, 2026-11-03. Implements
[03-invite-only-sign-in.md](../../roadmap/phase-1-accounts-and-preferences/03-invite-only-sign-in.md)
under the decisions in the
[Phase 1 README](../../roadmap/phase-1-accounts-and-preferences/README.md).
Builds on the
[accounts and isolation spec](2026-11-03-accounts-and-isolation-design.md)
(the sign-up trigger, RLS on every table, and the service-role key as the
admin's credential).

## Intent

Only people the maintainer invites can get into the hosted app, and they get
in by email with no password. The flow is meant to stay simple:

1. The admin invites an email. The app sends that person an invite email.
2. They open it and either click the link or type the 6-digit code.
3. They're signed in. A first-time user lands on setup (a placeholder until
   slice 07). A returning user lands on the signed-in home.
4. Later visits go through the sign-in page: type an email, get a fresh link
   and code.

Registration happens only through an invite email. The sign-in page never
creates an account.

## Goals

- Public sign-up is off, locally and in production.
- An admin script invites, re-sends, blocks and unblocks users.
- Every invite and sign-in email carries both a link and a 6-digit code.
- Production email goes through a dedicated Gmail account over SMTP.
- A session lasts at most 7 days from sign-in, after which the user has to
  sign in again.
- Signed-out users can't reach app pages, and they get no data, since RLS
  already returns nothing without a session.

## Non-goals

- Google or any other OAuth. Passwords.
- A waitlist, or users inviting others.
- An admin page (it may come with the UI slices).
- The guided setup itself (slice 07). This slice only routes first-time users
  to a placeholder.
- User-initiated account deletion (Phase 1 locks removal as a manual admin
  task).

## Anti-goals

- **Any path that creates an account without an invite**, including the sign-in
  page, a direct call to Supabase Auth with the publishable key, or a magic
  link for an unknown email.
- **The sign-in page revealing whether an email is known.** Accepted, pending,
  blocked and unknown emails all get the same message and roughly the same
  response time from our page. (Supabase Auth's own API, called directly, does
  tell them apart; see Known gaps.)
- **A session that outlives 7 days from sign-in**, even for a user who stays
  active.
- **A blocked user signing in, or their data being deleted** by the block.

## Decisions (agreed with the user)

| Question                     | Decision                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| How people register          | Only by an invite email the app sends. The admin runs the invite; the sign-in page never creates an account.                                      |
| What an email contains       | Both a magic link and a 6-digit code, for invites and for sign-ins.                                                                               |
| Email sender                 | Gmail SMTP from a new Gmail account made only for 10xjobs, connected to Supabase Auth. Swapping to Resend or Postmark later is a settings change. |
| Session length               | 7 days counted from sign-in, not from last activity. Everyone re-enters a code weekly.                                                            |
| Taking someone's access away | A block that keeps their data. Deleting the account stays the separate, manual admin task it already is.                                          |
| After first sign-in          | A first-time user goes to profile and preferences setup (slice 07; a placeholder here).                                                           |

## Shape

### 1. Supabase Auth settings

Set in `supabase/config.toml` for local, and mirrored by hand in the Supabase
Cloud dashboard for production. Slice 09 owns the production checklist; this
slice writes down the values.

- `auth.enable_signup = false`, so only users that already exist in Auth can
  get a link or code.
- Email OTP length 6. Link and code validity: 24 hours (`otp_expiry = 86400`,
  Supabase's maximum). Invites use the same setting, so an invite also expires
  after 24 hours.
- At most one email per address every 60 seconds (`max_frequency = "60s"`).
- `site_url` and `additional_redirect_urls` point at the web app (local:
  `http://localhost:3001`; production: the Vercel domain, set in slice 09).
- Custom email templates for **invite** and **magic link**, kept in
  `supabase/templates/` and referenced from `config.toml`. Production gets the
  same HTML pasted into the dashboard.
- SMTP: production only. Locally, the Supabase CLI's built-in mail catcher
  (Inbucket/Mailpit) receives every email, so no Gmail credentials are needed
  for development. The Gmail address and app password live only in the
  Supabase Cloud dashboard (and in an untracked `.env*` file if a script needs
  them); they never go in git.
- The custom-SMTP email rate limit is raised enough for invites plus weekly
  sign-ins (for example 30 an hour). The exact number is the builder's call.

### 2. Admin script

A command-line script run by the maintainer with the service-role key, the
admin credential slice 02 settled on. It reads the key from the environment
the same way the other scripts do (see `scripts/supabase-env.sh`).

- `invite <email>`: calls `auth.admin.inviteUserByEmail`. This creates the Auth
  user (and, through slice 02's trigger, the `public.users` row) and sends the
  invite email. If the user exists but has never accepted, it sends the invite
  again with a fresh link and code (this is the only way back in for someone
  whose invite expired; see section 4). If the user has already signed in,
  Supabase answers `email_exists` and the script says "already signed up" and
  changes nothing. `enable_signup = false` doesn't block admin invites.
- `block <email>`: bans the Auth user indefinitely through the admin API
  (`ban_duration`). Their rows stay untouched. A banned user can't verify a
  code or link (Supabase returns `user_banned`) or refresh a session. They can
  still receive a sign-in email if they ask for one, because Supabase doesn't
  check bans before sending; the code just won't work.
- `unblock <email>`: lifts the ban.
- `list` (my call): prints each user's email, whether they've accepted, when
  they last signed in, and whether they're blocked. It makes the other commands
  usable without the dashboard.

Every command prints what it did in one line and exits non-zero on failure.

### 3. Email templates

Plain and text-first, from "10xjobs". Each template shows:

- one line saying what this is ("You've been invited to 10xjobs" or "Your
  10xjobs sign-in code"),
- the 6-digit code (`{{ .Token }}`) large and easy to copy,
- a button with the link, built from `{{ .TokenHash }}` and pointing at the
  app's own `/auth/confirm` route (not `{{ .ConfirmationURL }}`), so a link
  works even when it's opened on a different device or browser from the one
  that asked for it,
- a line saying the link and code expire in 24 hours and work once,
- a line saying to ignore the email if it wasn't expected.

### 4. Web app pages and session handling (`apps/web`)

**Pages**

- `/sign-in`: an email field. Submitting runs a **server action** (never the
  browser client) that calls `signInWithOtp` with `shouldCreateUser: false`.
  Whatever Supabase answers (sent, unknown email `otp_disabled`, unaccepted
  invite `signup_disabled`, rate limit `over_email_send_rate_limit`, or any
  other error), the action logs the real outcome server-side and returns the
  same thing: "If this email is invited, a code is on its way." It pads every
  response to a fixed minimum time (my call: about 1.5 seconds) so a known
  email, which waits on the SMTP send, isn't noticeably slower. The page then
  shows a 6-digit code field and a "send a new code" button with a 60-second
  countdown. The rate-limit error only happens for known emails, so it gets
  the same message, not a "try again shortly" one. A small line under the
  message reads "Invited but your invite expired? Ask for a new invite."
- Code entry runs a server action that calls `verifyOtp` with the email, the
  code and `type: 'email'`. That one call accepts both invite codes and
  sign-in codes (Supabase checks the invite token first), so no separate
  `'invite'` branch is needed. A wrong, expired or used code, or a banned user,
  shows "That code didn't work. Check it or send a new one."
- `/auth/confirm`: a route handler that takes `token_hash` and `type` from the
  link, calls `verifyOtp`, and redirects. On failure (expired, already used,
  malformed, banned) it sends the user to `/sign-in` with a plain "That link
  has expired or was already used" message and the email field ready.
- **Expired invites.** An invitee who never accepted can't get a code from
  `/sign-in`: with sign-up off, Supabase treats them as a new sign-up and sends
  nothing. Their way back is the admin re-running `invite`. The web app can't
  do this itself, since the service-role key stays out of `apps/web`
  (`no-service-role.spec.ts`).
- Sign-out: a button on signed-in pages that ends the session and returns to
  `/sign-in`.
- `/setup`: placeholder for first-time users. Slice 07 replaces it.
- `/` (signed-in home): a minimal page showing the user's email and sign-out.

**Where users land after signing in**

A user with no profiles goes to `/setup`; anyone else goes to `/` (my call: it
needs no new schema, and slice 07 can refine what "setup unfinished" means).

**Protecting pages**

The existing `proxy.ts` already refreshes the session on every request. It
also:

- sends any request for an app page without a valid session to `/sign-in`.
  The public routes are `/sign-in` and `/auth/confirm`, plus static assets;
- sends a signed-in user who opens `/sign-in` to their landing page;
- enforces the 7-day limit on pages: reads the sign-in time from the session
  token's `amr` claim (the entry with method `otp`, whose timestamp is set at
  verification and survives token refresh), and if it's more than 7 days old,
  signs the user out and sends them to `/sign-in` with "Please sign in again."

Server components and route handlers still check the user themselves rather
than trusting the proxy alone. Data stays protected by RLS either way.

**The 7-day limit for data too (my call).** The proxy only runs when a page
loads, so a client that keeps refreshing its token without loading pages could
still reach the data past 7 days. To close that without touching every RLS
policy, a scheduled database job (pg_cron, hourly) deletes Auth sessions
created more than 7 days ago. That also removes their refresh tokens, so the
next refresh fails and access ends within `jwt_expiry` (1 hour) at most. The
job goes in a hand-written Prisma migration, like slice 02's trigger.

Supabase's own "time-box sessions" setting would do the same job but needs
the Pro plan. If the project moves to Pro, turn it on (`[auth.sessions]
timebox = "168h"` locally, the same value in the dashboard) and the cleanup
job can go.

### 5. Seed and tests

- The local seed already creates confirmed users through the admin API, so it
  keeps working with sign-up off.
- Database tests (`apps/db-tests`) add:
  - with sign-up off, `signInWithOtp` for an unknown email creates no Auth
    user, and `signUp` with the publishable key fails;
  - an invited user exists after `inviteUserByEmail`, and verifying their
    invite code with `type: 'email'` signs them in;
  - `signInWithOtp` for an invited-but-unaccepted user sends nothing and
    creates nothing;
  - a blocked user can't verify a code or refresh a session, and their rows
    are still there;
  - unblocking restores sign-in;
  - the cleanup job removes sessions older than 7 days and leaves newer ones.
- Web tests cover the proxy (redirects for signed-out, signed-in and
  older-than-7-days sessions) and the sign-in action returning the identical
  response for every Supabase outcome listed above.
- **First check before writing templates:** confirm with the local mail
  catcher that the invite email fills `{{ .Token }}` and `{{ .TokenHash }}`.
  If the invite can't carry a code, the invite email carries only the link,
  and the spec's "both in every email" falls back to sign-in emails only.
- An end-to-end check of the full flow against the local stack reads the
  emails from the local mail catcher: invite → code → `/setup`; sign out;
  sign in → link → `/`. Whether this runs as a Playwright test in CI or as a
  documented manual check is the builder's call. If it's manual, it goes in
  the done-when list as a step the maintainer runs once.

### 6. Docs

- The README's local setup section explains how to invite yourself locally and
  where to read the emails (the mail catcher URL).
- A short production note lists the Gmail setup (2-step verification, app
  password, SMTP host `smtp.gmail.com`, port 587) and the Auth settings to
  mirror in the dashboard. Slice 09 turns it into the launch checklist.

## Left to the builder

- Where the admin script lives and what runs it (a TypeScript script next to
  the seed, run through `tsx`, is the obvious fit), and its exact CLI shape.
- The exact custom-SMTP rate limit.
- Template HTML and styling within the description above.
- How the sign-in page is built from the existing shadcn components.
- How the proxy's route matcher and the public-route list are written.
- Whether the end-to-end flow is automated (see section 5).

## Known gaps

- **Gmail as the sender.** Emails come from a `@gmail.com` address, Gmail gives
  no delivery logs, and Google may flag automated sending from a new account.
  Fine at invite-only scale. If deliverability suffers, switch to Resend or
  Postmark before or during slice 09. That's a settings change, not code.
- **A block isn't instant.** A banned user's current access token stays valid
  until it expires (`jwt_expiry`, 1 hour), so a block can take up to an hour
  to bite. Acceptable for Phase 1. Shortening `jwt_expiry` would narrow it.
- **Invites expire in 24 hours**, Supabase's maximum, and only the admin can
  re-send one. Self-service recovery would need a server component holding
  the service-role key, which this slice doesn't add.
- **Supabase Auth's API reveals whether an email is known** to anyone calling
  it directly with the publishable key (different error codes, and a slower
  answer for known emails). Our page hides this; settings can't. At
  invite-only scale, knowing that an email has an account gives an attacker
  nothing to use without that inbox.
- **A blocked user can still receive sign-in emails** if they ask for them;
  the codes don't work. Stopping the email would mean sending mail through a
  Supabase Send Email hook instead of plain SMTP.
- **Blocked users and the engine.** Phase 2 collection must skip blocked users'
  profiles. Nothing runs per user in Phase 1, so there's nothing to skip yet.

## Done when

- An invited email can sign in with either the link or the code and lands on
  `/setup` the first time and `/` after that.
- An email that wasn't invited can't create an account through the sign-in
  page or through Supabase Auth directly, and sees the same message on our
  page as an invited one.
- Signed-out requests to app pages are redirected to `/sign-in`, and a session
  older than 7 days from sign-in is ended for pages at once and for data
  within an hour.
- A blocked user can't sign in and their data is unchanged; unblocking restores
  access.
- Production Auth settings and the Gmail SMTP setup are written down for
  slice 09.
- `npx nx run-many -t lint test build typecheck` and the database job pass.

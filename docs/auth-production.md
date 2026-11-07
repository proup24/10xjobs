# Auth setup for production (Supabase Cloud)

The local stack reads these values from `supabase/config.toml`. Supabase Cloud does not, so mirror them by hand in the dashboard. The committed files stay the source of truth: if they change, update the dashboard.

## Auth settings

Authentication, then the settings pages named below.

| Setting                                          | Value                                              | `config.toml` key                           |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------- |
| Allow new users to sign up                       | off                                                | `[auth] enable_signup = false`              |
| Email OTP length                                 | 6                                                  | `[auth.email] otp_length`                   |
| Email OTP expiration                             | 86400 seconds (24 hours)                           | `[auth.email] otp_expiry`                   |
| Minimum interval between emails to the same user | 60 seconds                                         | `[auth.email] max_frequency`                |
| Emails sent per hour                             | 30                                                 | `[auth.rate_limit] email_sent`              |
| Confirm email                                    | off                                                | `[auth.email] enable_confirmations = false` |
| JWT expiry (access token lifetime)               | 3600 seconds (1 hour)                              | `[auth] jwt_expiry`                         |
| Site URL                                         | the Vercel production URL (`<project>.vercel.app`) | `[auth] site_url`                           |
| Redirect URLs                                    | the Vercel production URL (`<project>.vercel.app`) | `[auth] additional_redirect_urls`           |

Anonymous sign-ins stay off. The Site URL matters: the email templates build their links from `{{ .SiteURL }}`, so a wrong value sends users to the wrong host.

The emails-per-hour limit can only be changed once custom SMTP is enabled (next section).

## Email templates

Authentication, Emails, Templates. Paste the files from `supabase/templates/` as they are. Both links point at `{{ .SiteURL }}/auth/confirm` with `token_hash` and `type`, never at `{{ .ConfirmationURL }}`.

### Invite user

Subject: `You've been invited to 10xjobs`

```html
<div
  style="
    font-family:
      -apple-system,
      Segoe UI,
      Helvetica,
      Arial,
      sans-serif;
    max-width: 480px;
    margin: 0 auto;
    padding: 24px;
    color: #111;
  "
>
  <p style="font-size: 16px">You've been invited to 10xjobs.</p>
  <p style="font-size: 14px; margin-bottom: 4px">Your code:</p>
  <p
    style="
      font-size: 36px;
      font-weight: 700;
      letter-spacing: 6px;
      font-family: monospace;
      margin: 0 0 24px;
    "
  >
    {{ .Token }}
  </p>
  <p>
    <a
      href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite"
      style="
        display: inline-block;
        background: #111;
        color: #fff;
        padding: 12px 20px;
        border-radius: 6px;
        text-decoration: none;
      "
      >Accept the invite</a
    >
  </p>
  <p style="font-size: 14px; color: #444">The link and the code expire in 24 hours and work once.</p>
  <p style="font-size: 14px; color: #444">If you weren't expecting this email, you can ignore it.</p>
  <p style="font-size: 14px; color: #444">10xjobs</p>
</div>
```

### Magic link

Subject: `Your 10xjobs sign-in code`

```html
<div
  style="
    font-family:
      -apple-system,
      Segoe UI,
      Helvetica,
      Arial,
      sans-serif;
    max-width: 480px;
    margin: 0 auto;
    padding: 24px;
    color: #111;
  "
>
  <p style="font-size: 16px">Your 10xjobs sign-in code.</p>
  <p style="font-size: 14px; margin-bottom: 4px">Your code:</p>
  <p
    style="
      font-size: 36px;
      font-weight: 700;
      letter-spacing: 6px;
      font-family: monospace;
      margin: 0 0 24px;
    "
  >
    {{ .Token }}
  </p>
  <p>
    <a
      href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email"
      style="
        display: inline-block;
        background: #111;
        color: #fff;
        padding: 12px 20px;
        border-radius: 6px;
        text-decoration: none;
      "
      >Sign in to 10xjobs</a
    >
  </p>
  <p style="font-size: 14px; color: #444">The link and the code expire in 24 hours and work once.</p>
  <p style="font-size: 14px; color: #444">If you weren't expecting this email, you can ignore it.</p>
  <p style="font-size: 14px; color: #444">10xjobs</p>
</div>
```

## Gmail SMTP

Authentication, Emails, SMTP Settings, enable custom SMTP.

1. Create a dedicated Gmail account for the app. Do not use a personal one.
2. Turn on 2-step verification for it.
3. Create an app password (Google Account, Security, App passwords).
4. Enter these in the Supabase dashboard:
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Username: the Gmail address
   - Password: the app password
   - Sender name: `10xjobs`
   - Sender address: the Gmail address

Known gap: Gmail deliverability is unproven. If invite or sign-in emails land in spam or get throttled, switch to Resend or Postmark before or during slice 09; only the SMTP settings change.

The credentials go only in the dashboard. They never go in git, in `config.toml`, or in any `.env*` file that is tracked. Local development uses Mailpit (http://127.0.0.1:54324) and sends nothing.

## Session length and pg_cron

Sessions last 7 days from sign-in. A Prisma migration (`end_expired_sessions`) creates `public.end_expired_sessions()` and schedules the `end-expired-sessions` pg_cron job, hourly (`0 * * * *`). It deletes `auth.sessions` rows older than 7 days. The migration also runs `CREATE EXTENSION IF NOT EXISTS pg_cron`, so applying it to production enables pg_cron; nothing to switch on by hand. Production migrates from CI, not from a machine; see [production.md](production.md). After the first production migrate, check that the job exists with `select jobname, schedule from cron.job;`. Then verify the cleanup runs: execute `select public.end_expired_sessions();` once as postgres in the SQL editor (it returns a count), or check `cron.job_run_details` after an hour. If you ever run `prisma migration ref set` or advance the `db` ref, re-add `"end-expired-sessions"` to `invariants` in `refs/db.json` first, or new databases skip the cron job.

On the Supabase Pro plan, you can instead set a session time-box under Authentication, Sessions: `timebox = "168h"` (the `[auth.sessions]` key in `config.toml`). Supabase then ends sessions itself, and the cron job becomes redundant. Keep the job unless you have confirmed the time-box is active.

## Running `pnpm users` against production

The CLI manages invites and blocks: `pnpm users invite|block|unblock <email>` and `pnpm users list`. It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the shell. Locally, `eval "$(scripts/supabase-env.sh)"` sets them. For production, export the project's URL and service key from the dashboard (Project Settings, API) in the current shell only, never in a file:

```sh
export SUPABASE_URL=https://<project-ref>.supabase.co
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
pnpm users list
```

The CLI prints `Using <host>` before it does anything. Check that the host is the project you mean (`<project-ref>.supabase.co`, not `127.0.0.1`) before you continue. Open a fresh shell, or `unset` both variables, afterwards, so a later local command cannot hit production.

Known gaps to keep in mind when you run it:

- A block can take up to 1 hour to take effect: the user's current access token stays valid until `jwt_expiry` (3600 seconds).
- Blocked users still receive sign-in emails, but the codes do not work.
- Supabase Auth's API, when called directly, reveals whether an email is known. The sign-in page does not: it always answers with the same neutral message.
- Invites expire after 24 hours, and only the admin can send a new one (`pnpm users invite <email>`).

## Pre-launch checklist

See [production.md](production.md).

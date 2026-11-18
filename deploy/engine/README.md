# Hosted engine runbook

One Hetzner server runs the engine against the `10xjobs-dev` database. Design: [engine hosting spec](../../docs/superpowers/specs/2026-11-10-engine-hosting-design.md). Placeholders below: `<ip>` is the server's public IPv4 (for example `203.0.113.10`). Never put secrets or real IPs in this file.

## 1. What runs here

Docker Compose project `xjobs-engine`, five services (`compose.yaml`):

- `api`: the NestJS HTTP API on internal port 3000. Every route, health included, needs the `X-Engine-Key` header (`ENGINE_API_KEY`); the web app also sends a user token on user routes. The operator endpoints do not exist here (`XJOBS_OPERATOR_ENDPOINTS` is off, and the engine refuses it in production). The API container gets neither Claude credential (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`).
- `worker`: one `worker-all` process (`WORKER_ROLE=all`). It is the only place schedules run (`XJOBS_RUN_SCHEDULES=1`).
- `redis`: BullMQ queues, with append-only persistence and no eviction.
- `redis-cache`: a 128 MB LRU cache, nothing persisted.
- `caddy`: HTTPS in front of `api`, with an automatic Let's Encrypt certificate for `ENGINE_HOSTNAME`.

CI deploys on merge to `main`: CI, then `Dev database`, then `Deploy engine` (`.github/workflows/deploy-engine.yml`). It skips green while the `ENGINE_SSH_HOST` secret is unset. An automatic deploy also skips green when the server already runs a newer commit, so two quick merges that finish out of order never roll it back.

Each deploy of a new image recreates `api` and `worker`, so the API is briefly down (a short outage) and the worker restarts. If the new image is broken, the API stays down until a rollback (section 9) runs. A failed image pull leaves the running deploy and its files untouched.

## 2. Create the server

1. In the Hetzner console, create a server: Ubuntu 24.04, a shared-vCPU type with 4 GB RAM.
2. Pick the location nearest the `10xjobs-dev` Supabase region. Find the region in Supabase under Project Settings, General. For `eu-central-1` use Falkenstein or Nuremberg.
3. Add both people's SSH keys at creation.
4. Create a Cloud Firewall allowing inbound 22/tcp, 80/tcp, 443/tcp and 443/udp. Attach it to the server.
5. Note the server IPv4. Get its ed25519 host key fingerprint from the server itself, since the console may not show it: in the root session of section 4, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.

## 3. The CI deploy key

On your laptop, in an empty temp directory:

1. `ssh-keygen -t ed25519 -N '' -f engine-deploy -C engine-deploy`
2. Keep `engine-deploy.pub` for the keys file (next section). The private key `engine-deploy` goes into the GitHub secret `ENGINE_SSH_PRIVATE_KEY` (section 6). Delete both local files after that.

## 4. Bootstrap

`bootstrap.sh` installs Docker, creates the `deploy` user (docker group, no sudo), installs SSH keys, hardens SSH, enables `ufw` and security updates, and creates `/home/deploy/engine`.

1. Create a file `keys` with one public key per line: each person's key plus `engine-deploy.pub`.
2. Check every line. A bad file locks you out of SSH until you use the console: `ssh-keygen -l -f keys` must print one fingerprint per key.
3. `scp deploy/engine/bootstrap.sh keys root@<ip>:`
4. `ssh root@<ip> ./bootstrap.sh keys`. Run it over this root SSH session, not from the console. Keep the session open.
5. In another terminal, confirm `ssh deploy@<ip>` works. Only then close the root session.
6. Confirm `ssh root@<ip>` is now refused.

After bootstrap, SSH allows only `deploy` (`AllowUsers deploy`, `PermitRootLogin no`, no passwords), and `deploy` has no sudo. Root is reachable only through the Hetzner web console. Re-running `bootstrap.sh` needs the console. The owner may grant `deploy` sudo by hand from the console if wanted; the spec leaves that to the owner.

## 5. Server secrets

1. `ssh deploy@<ip>`, then `cd engine`.
2. Create `.env` with the names in `deploy/engine/.env.example`, then `chmod 600 .env`.
3. Set `ENGINE_HOSTNAME=api.<ip with dashes>.sslip.io`, for example `api.203-0-113-10.sslip.io`.
4. Get `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the same places as the `DEV_*` secrets in [shared-dev-database.md](../../docs/shared-dev-database.md). `DATABASE_URL` is the session pooler on port 5432, never 6543.
5. Generate the engine key with `openssl rand -base64 48` (at least 32 characters) and set it as `ENGINE_API_KEY`. The same value goes into Vercel (section 5a). The deploy's health check reads it from the running `api` container on the server; it never goes to GitHub.
6. Set `APIFY_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` (section 13; only the `worker` container uses the latter).
7. Set `WEB_APP_URL` to the web app's public origin, for example `https://app.example.com` (no trailing path). Match webhook payloads link to `<WEB_APP_URL>/?job=<id>`; without it their `links.match` is `null`. After adding it to a running server, `$C up -d` (section 8).
8. Single-quote any value that contains `$`, because Compose interpolates `env_file` values. `openssl rand -base64 48` output has no `$`.

Engine runtime secrets live only in this file. They never go to GitHub.

## 5a. The engine key in Vercel

The web app calls the engine with `ENGINE_URL` and `ENGINE_API_KEY`. Set both in Vercel for every environment that exists (Production, Preview, Development), all pointing at this one engine:

1. `ENGINE_URL`: `https://api.<ip with dashes>.sslip.io`.
2. `ENGINE_API_KEY`: the same value as in the server `.env`. Mark it Sensitive.
3. Never prefix either with `NEXT_PUBLIC_`.

Locally, put `ENGINE_URL=http://localhost:3000` and a local `ENGINE_API_KEY` in `apps/web/.env.local`, matching the local engine's `.env`.

**Rotate the key.**

1. Generate a new value: `openssl rand -base64 48`.
2. Update `ENGINE_API_KEY` in the server `.env` and in Vercel (every environment).
3. On the server, `$C up -d` (section 8) so `api` restarts with the new key, then redeploy the web app in Vercel so it picks up the new value.
4. Expect brief failures between the two sides changing: the web app's engine calls answer 401 or "unavailable" until both have the new key. User data is already saved, so nothing is lost; retry afterwards.

**Merge-day order for the engine auth slice.** The deploy replaces `api` with the new image before its health check. Without `ENGINE_API_KEY` in the server `.env`, the new image fails env validation and crash-loops, so the API is down (and the deploy fails) until the key is added to `~/engine/.env` and `$C up -d` runs, or a rollback (section 9) runs. So, before merging:

1. Add `ENGINE_API_KEY` to the server `.env`. Removing the old basic-auth username and password lines is optional; the engine ignores them.
2. Set `ENGINE_URL` and `ENGINE_API_KEY` in Vercel, every environment.
3. Then merge. The deploy waits for `api` to report healthy, checks `/api/health` with the key from the server itself, and checks that the same URL without the key answers 401.

## 6. GitHub secrets

In the `dev` environment, set only these four:

1. `ENGINE_SSH_HOST`: `<ip>`.
2. `ENGINE_SSH_USER`: `deploy`.
3. `ENGINE_SSH_PRIVATE_KEY`: the contents of `engine-deploy` (section 3). Delete the local copy afterwards.
4. `ENGINE_SSH_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <ip>`. Save that line to a file and run `ssh-keygen -lf` on it. The fingerprint must match the one `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` printed on the server (section 2).

## 7. First deploy

1. The first merge to `main` after setup deploys automatically. Or run it by hand: Actions, Deploy engine, Run workflow, branch `main`, no input.
2. On the server, `curl -sf -H "X-Engine-Key: $($C exec -T api printenv ENGINE_API_KEY)" https://api.<ip with dashes>.sslip.io/api/health` must return 200 with a valid certificate. The deploy job runs this check itself.
3. Every route without the key, health included, must return 401: `curl -s -o /dev/null -w '%{http_code}\n' https://api.<ip with dashes>.sslip.io/api/health` prints `401`.

## 8. Everyday operations

Run these on the server, in `~/engine`. Define the alias once per session:

```sh
cd ~/engine
C="docker compose -p xjobs-engine --env-file image.env --env-file .env"
```

Always use `$C`, for logs, ps and restart too. `ENGINE_IMAGE_TAG` (from `image.env`) and `ENGINE_HOSTNAME` (from `.env`) are required, so a bare `docker compose` fails.

1. Logs: `$C logs -f worker` (or `api`, `caddy`, `redis`).
2. Status: `$C ps`.
3. Restart: `$C restart worker`.
4. Change a secret: edit `.env`, then `$C up -d`.

Containers restart on failure by themselves.

## 8a. Trial actors

A trial actor runs beside harvestapi to compare them. `cheap_scraper` (channel `LINKEDIN_JOB_BOARD_CHEAP`) is off until it is listed in `.env`:

1. Turn it on: set `COLLECTION_TRIAL_CHANNELS=LINKEDIN_JOB_BOARD_CHEAP`. Turn it off: remove the line or empty it. Then `$C up -d worker`. The worker removes the schedule of a trial that is not listed.
2. It has its own daily spend cap, `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP` (default 3 dollars, Morocco day), apart from harvestapi's `COLLECTION_DAILY_BUDGET_USD`. Its spend is counted from its own runs only.
3. It runs hourly 09-21 Morocco time, Monday to Friday, like harvestapi, on its own queue (`collect-linkedin-job-board-cheap`).

## 9. Roll back

1. Pick a merge SHA: `git log main`. It must be the full 40-character SHA.
2. Actions, Deploy engine, Run workflow, from branch `main`, with `image_tag` set to that SHA. Always run it from `main`: the `dev` environment only allows `main`, so a run from any other branch fails on the environment policy.
3. The image must still exist in GHCR; that is what gets pulled. The server keeps only two engine images on its disk: the running one and the one it replaced. Every deploy removes the rest, before the pull and again after the rollout.
4. A dispatch with no `image_tag` builds and deploys `main`'s HEAD.
5. A manual dispatch always deploys, even an older commit. That is what makes it a rollback.

## 10. Add or remove a person

1. Edit `/home/deploy/.ssh/authorized_keys` on the server as `deploy`. Add or remove that person's line. Leave the CI key line alone.
2. Add or remove their key in the Hetzner project too, so future servers match.
3. Do not re-run `bootstrap.sh` for this: it overwrites `authorized_keys` and needs the console.

## 11. Move to a real domain

1. Add an A record for the name pointing to `<ip>`.
2. Change `ENGINE_HOSTNAME` in `.env` to that name.
3. `$C up -d caddy`. The deploy health check reads `ENGINE_HOSTNAME` from the running `caddy` container, so it follows once Caddy has restarted. Update `ENGINE_URL` in Vercel too.

## 12. Verify that collection works

The LinkedIn job board collects at minute 0 of each hour from 08:00 to 22:00 UTC, Monday to Friday.

1. After the first such hour following the deploy: `$C logs worker | grep CollectionService`. Each run logs one summary line, such as `channel=linkedin-job-board builders=… segments=… collected=… batches=… costUsd=…`.
2. Query `10xjobs-dev` (SQL editor or the read-only `supabase-dev` MCP). Replace the timestamp with the deploy time:

```sql
-- jobs collected since the deploy, with processor status
select "processingStatus", count(*)
from normalized_jobs
where "createdAt" > '2026-01-01T00:00:00Z'
group by 1;

-- match decisions on those jobs
select m.outcome, count(*)
from job_matches m
join normalized_jobs j on j.id = m."jobId"
where j."createdAt" > '2026-01-01T00:00:00Z'
group by 1;
```

3. Expect new rows, `processingStatus = 'processed'` for most, and `qualified` or `rejected` outcomes in `job_matches`.

## 13. Set the Claude token

The processor runs `claude -p` in the `worker` container, on the owner's Claude subscription for now. The image has Claude Code installed at the exact version pinned in `apps/xjobs/src/modules/processor/models/claude/version.ts`; its auto-updater is off.

1. On your laptop, run `claude setup-token` and copy the token it prints. It is valid for one year.
2. On the server, in `~/engine`, set `CLAUDE_CODE_OAUTH_TOKEN=<token>` in `.env` (single-quote it if it contains `$`).
3. `$C up -d worker`.
4. Check: `$C logs worker | grep -i processor`. Look for `processor ready`, which the startup check logs once the credential works (within about three minutes). Every boot first logs `Processing paused until … (startup): checking the Claude credential` at info level; that line is expected. `processor not started`, or a `(startup)` pause logged at error level with another detail, means the check failed.

This is for the dogfooding period only. Before anyone else gets an account, do section 17.

## 14. Renew the token

The token expires one year after `claude setup-token`. Put a calendar reminder two weeks before that date.

1. Run `claude setup-token` again.
2. Replace the `CLAUDE_CODE_OAUTH_TOKEN` value in the server `.env`.
3. `$C up -d worker`.

An expired or revoked token shows as an auth error: the job goes back to `pending` without losing an attempt, the processor pauses for 10 minutes, and the log names this fix. Collection, ingest and match keep running.

## 15. Read a pause

The processor pauses on a usage limit (until the limit resets, or 15 minutes if unknown), on an auth error (10 minutes), and when the weekly share reaches `PROCESSOR_WEEKLY_STOP_AT` (default `0.85`, of any weekly limit).

1. `$C logs worker | grep -i pause`.
2. The log line reads `Processing paused until <time> (<reason>): <detail>`; the reason is `usage_limit`, `weekly_reserve`, `auth` or `startup` (auth and a failed startup check log at error level; the initial `checking the Claude credential` pause logs at info). `GET /processor/status` shows the same pause, but it is an operator endpoint (`XJOBS_OPERATOR_ENDPOINTS`) that the hosted API does not serve; use it only on a local engine.
3. Nothing needs fixing for a usage limit or the weekly stop: jobs wait as `pending` and the processor resumes by itself. An auth error needs section 14. An `auth` pause whose detail starts `could not run claude:` is not the token: the `claude` binary could not be started (missing, or out of processes or file handles).

## 16. Measure worker memory

Four `claude` calls run at once by default (`PROCESSOR_CONCURRENCY=4`), each a Node process.

1. With the processor busy (jobs pending), run `docker stats --no-stream` on the server and read the `worker` container's memory.
2. The server has 4 GB RAM and also runs `api`, both Redis instances and Caddy. If the worker plus the rest leaves little headroom or the kernel kills processes, set a lower `PROCESSOR_CONCURRENCY` (for example 2) in `.env` and run `$C up -d worker`.

## 17. Switch to an API key

**Required before any other person gets an account.** Anthropic's terms do not allow serving other people from a Claude subscription, and the subscription limits assume one person's ordinary use. Do not give anyone an account until this is done.

1. Create an Anthropic API key in the Anthropic Console.
2. In the server `.env`, set `ANTHROPIC_API_KEY=<key>` and remove the `CLAUDE_CODE_OAUTH_TOKEN` line.
3. Set a real `PROCESSOR_DAILY_BUDGET_USD` (the default `0` means no cap). Size it from the processor's real cost per job.
4. `$C up -d worker`, then check `$C logs worker | grep -i processor`.

No code change is needed: `claude -p` uses the key when it is set.

## 18. Other sites on this server

Caddy also serves sites that other projects ship. It imports every `/home/deploy/caddy-sites/*.caddy` file (mounted read-only at `/etc/caddy/sites`) and joins the external Docker network `edge`, which those projects' containers also join.

1. `edge` and `/home/deploy/caddy-sites` must exist before this change deploys. Without `edge`, `$C up -d` fails. A missing `/home/deploy/caddy-sites` would be created by Docker, owned by root, so the `deploy` user could not write site files into it. As `deploy`: `docker network create edge` and `mkdir -p /home/deploy/caddy-sites`.
2. 10xapply ships `xapply.caddy` into that folder and reloads this Caddy itself.
3. Every 10xjobs deploy runs `caddy reload`, which re-reads the imported site files too. A broken site file would make that reload fail the deploy step; the previous config keeps running.
4. A broken site file is refused by 10xapply's validate step before it is installed.
5. No service on `edge` may share a name or alias with a 10xjobs service: Compose adds each service name as a DNS name on every network it joins. 10xapply's are all `xapply-*`, and this Caddy proxies `xjobs-api` (an alias on the default network), not `api`.

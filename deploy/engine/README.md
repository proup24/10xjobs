# Hosted engine runbook

One Hetzner server runs the engine against the `10xjobs-dev` database. Design: [engine hosting spec](../../docs/superpowers/specs/2026-11-10-engine-hosting-design.md). Placeholders below: `<ip>` is the server's public IPv4 (for example `203.0.113.10`). Never put secrets or real IPs in this file.

## 1. What runs here

Docker Compose project `xjobs-engine`, five services (`compose.yaml`):

- `api`: the NestJS HTTP API on internal port 3000. Basic auth on every route except `GET /api/health`.
- `worker`: one `worker-all` process (`WORKER_ROLE=all`). It is the only place schedules run (`XJOBS_RUN_SCHEDULES=1`).
- `redis`: BullMQ queues, with append-only persistence and no eviction.
- `redis-cache`: a 128 MB LRU cache, nothing persisted.
- `caddy`: HTTPS in front of `api`, with an automatic Let's Encrypt certificate for `ENGINE_HOSTNAME`.

CI deploys on merge to `main`: CI, then `Dev database`, then `Deploy engine` (`.github/workflows/deploy-engine.yml`). It skips green while the `ENGINE_SSH_HOST` secret is unset.

## 2. Create the server

1. In the Hetzner console, create a server: Ubuntu 24.04, a shared-vCPU type with 4 GB RAM.
2. Pick the location nearest the `10xjobs-dev` Supabase region. Find the region in Supabase under Project Settings, General. For `eu-central-1` use Falkenstein or Nuremberg.
3. Add both people's SSH keys at creation.
4. Create a Cloud Firewall allowing inbound 22/tcp, 80/tcp, 443/tcp and 443/udp. Attach it to the server.
5. Note the server IPv4 and the ed25519 host key fingerprint shown in the console.

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
5. Generate the basic auth password with `openssl rand -base64 24` (at least 12 characters). Set `BASIC_AUTH_USERNAME` too.
6. Set `APIFY_TOKEN` and `OPENROUTER_API_KEY`.
7. Single-quote any value that contains `$`, because Compose interpolates `env_file` values. `openssl rand -base64 24` output has no `$`.

Engine runtime secrets live only in this file. They never go to GitHub.

## 6. GitHub secrets

In the `dev` environment, set only these four:

1. `ENGINE_SSH_HOST`: `<ip>`.
2. `ENGINE_SSH_USER`: `deploy`.
3. `ENGINE_SSH_PRIVATE_KEY`: the contents of `engine-deploy` (section 3). Delete the local copy afterwards.
4. `ENGINE_SSH_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <ip>`. Check its fingerprint (`ssh-keygen -lf` on that line) against the one in the Hetzner console.

## 7. First deploy

1. The first merge to `main` after setup deploys automatically. Or run it by hand: Actions, Deploy engine, Run workflow, branch `main`, no input.
2. `curl https://api.<ip with dashes>.sslip.io/api/health` must return 200 with a valid certificate.
3. Any other route without Basic auth must return 401.

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

## 9. Roll back

1. Pick a merge SHA: `git log main`. It must be the full 40-character SHA.
2. Actions, Deploy engine, Run workflow, with `image_tag` set to that SHA.
3. The image must still exist in GHCR; that is what gets pulled. The server also prunes images created more than 168 hours ago from its disk.
4. A dispatch with no `image_tag` builds only from `main`. From any other branch it skips with a notice.

## 10. Add or remove a person

1. Edit `/home/deploy/.ssh/authorized_keys` on the server as `deploy`. Add or remove that person's line. Leave the CI key line alone.
2. Add or remove their key in the Hetzner project too, so future servers match.
3. Do not re-run `bootstrap.sh` for this: it overwrites `authorized_keys` and needs the console.

## 11. Move to a real domain

1. Add an A record for the name pointing to `<ip>`.
2. Change `ENGINE_HOSTNAME` in `.env` to that name.
3. `$C up -d caddy`. The deploy health check reads `ENGINE_HOSTNAME` from `.env`, so it follows.

## 12. Verify that collection works

The LinkedIn job board collects at minute 0 of each hour from 08:00 to 22:00 UTC, Monday to Friday.

1. After the first such hour following the deploy: `$C logs worker | grep -i collect`.
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

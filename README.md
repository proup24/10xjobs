# Xjobs

## Local Supabase

Requires Docker with Compose v2+ and Node.js. Allow at least 4 GB RAM for
the stack. Uses the official Supabase `self-hosted/v0.8.3` release with pinned
images, adapted for local development.

```sh
node scripts/setup-supabase.mjs
docker compose up -d --wait
```

The setup script creates an ignored `.env` with random passwords and matching
JWT API keys. Running it again preserves existing credentials.

- **Studio and API:** http://localhost:8000
- **Studio login:** `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` in `.env`.
- **Client API key:** `ANON_KEY` in `.env`; keep `SERVICE_ROLE_KEY` server-side only.
- **Postgres session connection:** `postgresql://postgres.xjobs:<POSTGRES_PASSWORD>@localhost:5432/postgres`
- **Transaction pooler:** the same connection on port `6543`.
- **Redis:** `redis://localhost:6379` from the host, or `redis://redis:6379`
  from another Compose service. No password is configured for local development.

Redis uses the [official Redis image](https://hub.docker.com/_/redis), pinned to
`8.2.10-alpine`, with append-only persistence in the `redis-data` named volume
and a health check. Set `REDIS_PORT` in `.env` to change its host port (default
`6379`). Start Redis alone with `docker compose up -d --wait redis`.

For a local NestJS/Prisma connection, use the session connection above as your
`DATABASE_URL`. If port 5432 is occupied, change `POSTGRES_HOST_PORT` in `.env`;
keep `POSTGRES_PORT=5432` for internal service connections.

```sh
docker compose ps              # Service status
docker compose logs -f auth    # Follow a service's logs
docker compose down            # Stop; preserve database and uploaded files
```

Database files, uploads, and Studio snippets persist under `supabase/volumes/`
and are ignored by Git. Encryption configuration and the Deno cache use named
volumes. Keep `.env` together with the data: changing its passwords after database
initialization does not rotate the database credentials.

All published ports bind to localhost. Email signup auto-confirms for local
development; email delivery requires configuring the `SMTP_*` settings. Set
`SITE_URL` to your frontend URL when adding a frontend. This configuration is
for local development; production requires deployment-specific configuration.

Upstream: [Supabase Docker guide](https://supabase.com/docs/guides/self-hosting/docker),
commit `bc27d2661edd09a5d0b8d76ce33da6d4071a756e`. Vendored configuration and
initialization files are covered by `supabase/LICENSE`. The Compose file changes
the project name, container naming, mount paths, and published port bindings.

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/node?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Run tasks

### Application imports

Keep application code under `apps/xjobs/src`. Use `src/*` for imports across
features, such as `import { getHostName } from 'src/utils'`, and relative imports
within a feature. Feature `index.ts` files expose explicit named exports and
`export type` declarations; internal files should not import their own barrel.
There is no global `src/index.ts` barrel.

The alias is scoped to this app and configured for TypeScript, Webpack, and
Vitest. Standalone TypeScript commands should use `tsx --tsconfig tsconfig.app.json`
from `apps/xjobs`, as the `db:seed` script does. Tooling configuration entrypoints
and their shared configuration dependencies keep relative imports because
Prisma's configuration loader does not resolve TypeScript path aliases.

To run the dev server for your app, use:

```sh
npx nx serve xjobs
```

To create a production bundle:

```sh
npx nx build xjobs
```

To see all available targets to run for a project, run:

```sh
npx nx show project xjobs
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

Use the plugin's generator to create new projects.

To generate a new application, use:

```sh
npx nx g @nx/node:app demo
```

To generate a new library, use:

```sh
npx nx g @nx/node:lib mylib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/node?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

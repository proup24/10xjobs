# Workspaces and Users — Design

Date: 2026-10-29
Status: draft

## Intent

The Phase 1 qualify step judges every collected job against _the job seeker's profile_: what positions they want, what stack they know and enjoy, where and how they can work, and how senior they are. Today the engine has nothing to judge against. This module gives it that: a workspace, the users in it, each user's contact channels, and each user's job-seeker profile with its tech stack and resume.

The profile is the input to the anti-goals in the roadmap. A thin or wrong profile means applying to the wrong jobs or rejecting the right ones, so the profile favours explicit, structured fields the qualify step can compare against, not free text.

## Goals, non-goals, anti-goals

**Goals**

- A `workspace` record that every other record in this module belongs to.
- CRUD for users, their contacts, and their profile through the NestJS engine's REST API.
- A profile defined mainly by target **positions** and a **tech stack**, plus the personal preferences listed below.
- Upload, download and replace a resume PDF per profile.

**Non-goals**

- Authentication and authorization. Phase 4. Until then the API trusts its caller, as a self-hosted single-user install does.
- The Next.js screens for editing the profile. They come with the web app.
- Matching jobs against the profile. That is the qualify step, Phase 1 "Find".
- Parsing the resume PDF into profile fields.

**Anti-goals**

- A profile so loose (free text everywhere) that qualify cannot compare it to a job.
- Personal data, resumes included, ending up in git. Resumes are written outside the repo's tracked tree at runtime.
- Records that are not workspace-scoped.

## Constraints

- Prisma 8 (`@prisma/orm-postgres` rc.21) contract in `apps/xjobs/src/database/contract.prisma`. Enums are PSL text enums with planner-generated CHECK constraints; lists are Postgres arrays; composite `type` blocks are stored as `jsonb`.
- Request validation uses `class-validator` DTOs through the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) already set in `main.ts`.
- CI (`nx run-many -t lint test build typecheck`) has no database. Unit tests must not need one.
- The API is served under the `/api` prefix, with Swagger in development.

## Data model

All tables have `id Uuid @id @onCreate(uuid(7))` and the existing `Timestamps` mixin. Columns are camelCase in the contract, as the existing `User` model is; tables are mapped to snake_case plural names.

### workspaces

| field | type           | notes                              |
| ----- | -------------- | ---------------------------------- |
| name  | String         |                                    |
| slug  | String, unique | lowercase, `[a-z0-9-]`, 2–64 chars |

A self-hosted install has one workspace, created by the seed with slug `default`.

### users

| field       | type                       | notes                                                                          |
| ----------- | -------------------------- | ------------------------------------------------------------------------------ |
| workspaceId | Uuid → workspaces, cascade |                                                                                |
| name        | String                     | required                                                                       |
| email       | String                     | unique **per workspace** (`@@unique([workspaceId, email])`), stored lowercased |
| address     | `Address?` (jsonb)         | see below                                                                      |

`Address` value object: `line1 String`, `line2 String?`, `city String`, `postalCode String?`, `state String?`, `country String` (ISO 3166-1 alpha-2, uppercase).

This replaces the starter `User` model. Its global `email` unique becomes the per-workspace unique.

### contacts

A user's own contact channels, the ones that go on applications.

| field       | type                       | notes                                                                                  |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------- |
| workspaceId | Uuid → workspaces, cascade |                                                                                        |
| userId      | Uuid → users, cascade      |                                                                                        |
| kind        | `ContactKind`              | `phone`, `email`, `linkedin`, `github`, `gitlab`, `portfolio`, `website`, `other`      |
| value       | String                     | phone in E.164, emails as emails, URLs as http(s) URLs (validated per kind in the DTO) |
| label       | String?                    | e.g. "personal", "work"                                                                |
| isPrimary   | Boolean, default false     | at most one primary per `(userId, kind)`, enforced by the service                      |

`@@unique([userId, kind, value])`.

### profiles

One profile per user (`userId` unique).

| field             | type                          | notes                                                                         |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| workspaceId       | Uuid → workspaces, cascade    |                                                                               |
| userId            | Uuid → users, cascade, unique |                                                                               |
| positions         | `Position[]`                  | target positions, at least one                                                |
| languages         | `Language[]`                  | `AR`, `FR`, `EN`, `ES`; at least one                                          |
| country           | String                        | ISO 3166-1 alpha-2                                                            |
| city              | String?                       |                                                                               |
| regions           | `Region[]`                    | regions the user belongs to, e.g. Morocco → `MENA`, `NORTH_AFRICA`, `EMEA`    |
| yearsOfExperience | Int                           | 0–60                                                                          |
| timezoneCurrent   | Int                           | UTC offset in **minutes**, −720…840                                           |
| timezoneMin       | Int                           | lowest working offset accepted, minutes                                       |
| timezoneMax       | Int                           | highest working offset accepted, minutes; `timezoneMin <= timezoneMax`        |
| engagements       | `Engagement[]`                | accepted: `employee`, `contractor`, `eor`, `agency`, `per_task`; at least one |
| arrangements      | `Arrangement[]`               | accepted: `remote`, `hybrid`, `onsite`, `unstated`; at least one              |
| seniority         | `Seniority`                   | `junior`, `mid`, `senior`, `staff`, `lead`, `principal`, `unstated`           |
| noticePeriodDays  | Int                           | 0–365                                                                         |
| resume\*          | see Resume                    | nullable columns                                                              |

Timezones are minutes, not hours, so offsets like UTC+5:30 fit. "UTC−4 to UTC+4" is `timezoneMin = -240`, `timezoneMax = 240`.

The range rules are `@@check` constraints in the database as well as DTO rules, so a bad row cannot get in through a script or a seed.

### profile_skills (the tech stack)

A table rather than a jsonb array, so qualify can filter on it ("has Node.js at mastery ≥ 6").

| field       | type                       | notes                                                                                  |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------- |
| workspaceId | Uuid → workspaces, cascade |                                                                                        |
| profileId   | Uuid → profiles, cascade   |                                                                                        |
| technology  | `Technology`               | enum, list below                                                                       |
| domain      | `SkillDomain`              | `backend`, `frontend`, `fullstack`, `mobile`, `devops`, `data`, `ml`, `security`, `qa` |
| mastery     | Int                        | 0–10, `@@check`                                                                        |
| preference  | Int                        | 0–10, how much the user wants to work with it, `@@check`                               |

`@@unique([profileId, technology, domain])`: the same technology can appear under two domains (TypeScript in backend and frontend) with different ratings.

### Enum values

**Position** (`Position`): `backend_engineer`, `frontend_engineer`, `fullstack_engineer`, `mobile_engineer`, `devops_engineer`, `site_reliability_engineer`, `platform_engineer`, `cloud_engineer`, `security_engineer`, `data_engineer`, `ml_engineer`, `ai_engineer`, `qa_engineer`, `embedded_engineer`, `software_architect`, `tech_lead`, `engineering_manager`.

**Region** (`Region`): `EMEA`, `MENA`, `NORTH_AFRICA`, `SUB_SAHARAN_AFRICA`, `MIDDLE_EAST`, `EUROPE`, `EU`, `UK`, `NORTH_AMERICA`, `LATAM`, `APAC`, `GLOBAL`.

**Technology** (`Technology`), a starter list; adding one is a contract edit and a migration:

- Languages: `javascript`, `typescript`, `python`, `java`, `kotlin`, `go`, `rust`, `csharp`, `cpp`, `php`, `ruby`, `scala`, `elixir`, `swift`, `dart`, `sql`, `bash`.
- Backend: `nodejs`, `nestjs`, `express`, `fastify`, `django`, `fastapi`, `flask`, `spring`, `dotnet`, `laravel`, `rails`, `graphql`, `grpc`.
- Frontend and mobile: `react`, `nextjs`, `vue`, `nuxt`, `angular`, `svelte`, `tailwindcss`, `react_native`, `flutter`.
- Data: `postgresql`, `mysql`, `mongodb`, `redis`, `elasticsearch`, `kafka`, `rabbitmq`, `spark`, `airflow`, `dbt`, `snowflake`.
- Cloud and DevOps: `aws`, `gcp`, `azure`, `docker`, `kubernetes`, `terraform`, `ansible`, `github_actions`, `gitlab_ci`, `linux`, `nginx`, `prometheus`, `grafana`.
- ML: `pytorch`, `tensorflow`, `langchain`.

Enum values are stored as the lowercase text shown (regions and languages uppercase, as above). `per-task` from the request is spelled `per_task` so every enum value is a valid identifier; the API uses the stored spelling.

## Resume

- `POST /…/profile/resume`, `multipart/form-data` with one `file` field. Accepts only PDFs: the `application/pdf` mime type **and** the `%PDF-` magic bytes. Max 5 MB. Replacing an existing resume deletes the old file after the new one is saved.
- `GET /…/profile/resume` streams the file back with its original filename. `DELETE` removes it.
- Columns on `profiles`, all nullable: `resumeKey` (storage key), `resumeFilename`, `resumeSizeBytes Int`, `resumeSha256`, `resumeUploadedAt`.
- Storage sits behind a `ResumeStorage` interface (`put`, `get`, `delete`). The first implementation writes to a local directory set by `RESUME_STORAGE_DIR` (env, validated, default `./storage/resumes` relative to the working directory, and `storage/` is added to `.gitignore`). The key is `<workspaceId>/<profileId>/<uuid>.pdf`; the user's filename is never part of the path. A Supabase Storage implementation can replace it later without touching the profile code.

## API

All under `/api/workspaces/:workspaceId`. The workspace is explicit in the path, so moving to multi-tenant only adds an authorization check. Every lookup filters by `workspaceId`, so an id from another workspace returns 404.

| method             | path                                 |                                                                      |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| POST, GET          | `/api/workspaces`                    | create, list                                                         |
| GET, PATCH         | `/api/workspaces/:workspaceId`       |                                                                      |
| POST, GET          | `/users`                             | create, list                                                         |
| GET, PATCH, DELETE | `/users/:userId`                     |                                                                      |
| POST, GET          | `/users/:userId/contacts`            |                                                                      |
| PATCH, DELETE      | `/users/:userId/contacts/:contactId` |                                                                      |
| PUT, GET           | `/users/:userId/profile`             | PUT creates or replaces the whole profile, **including `techStack`** |
| POST, GET, DELETE  | `/users/:userId/profile/resume`      |                                                                      |

The profile PUT body is the profile fields plus `techStack: { technology, domain, mastery, preference }[]`. The service writes the profile and replaces its skill rows in one transaction. The GET returns the same shape plus resume metadata (no storage key).

Errors: 400 for validation (the pipe's default body), 404 for anything not found in the workspace, 409 for unique violations (duplicate email in the workspace, duplicate contact, duplicate skill). Ids in paths are validated as UUIDs (`ParseUUIDPipe`).

## Code layout

```
apps/xjobs/src/
  workspaces/   workspaces.module.ts, .controller.ts, .service.ts, .repository.ts, dto/
  users/        users.module.ts, users.controller.ts, users.service.ts, users.repository.ts,
                contacts.controller.ts, contacts.service.ts, contacts.repository.ts,
                profiles.controller.ts, profiles.service.ts, profiles.repository.ts,
                resume-storage.ts (interface + local implementation), dto/
```

Services hold the rules (404s, primary-contact uniqueness, transactional skill replacement, resume replacement). Repositories are the only code that touches `DatabaseService`. Unit tests cover services with in-memory fake repositories, the DTOs through `class-validator`, and the local resume storage against a temp directory, so CI needs no database.

The seed creates the `default` workspace first, then the existing starter users inside it.

## Left to the builder

- Exact DTO class names and the shape of list responses (a plain array is fine; no pagination yet).
- How the repository maps Prisma unique-violation errors to a 409.
- Swagger decorators: add them where they are cheap.

## Calls I made (not confirmed by the user)

- Contacts are the user's own contact channels, not recruiters.
- The workspace is part of this work and comes first.
- `languages`, `regions`, `engagements`, `arrangements` and `positions` are lists; `seniority` is a single value.
- `regions` are the regions the user belongs to, not regions they target.
- Timezones in minutes; `per-task` spelled `per_task`; added `fullstack`, `mobile`, `data`, `ml`, `qa` skill domains.
- The tech stack is its own table; the position and technology enum lists above.
- Local-disk resume storage behind an interface, 5 MB cap.
- No auth; the workspace id in the path.

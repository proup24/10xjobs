# Workspaces and Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspaces, users, contacts and job-seeker profiles (with tech stack and resume PDF) to the NestJS engine, persisted through the Prisma 8 contract and exposed as REST endpoints.

**Architecture:** One Prisma 8 contract change and migration for all five tables. Two Nest modules: `workspaces` and `users` (users, contacts, profiles, resume). Controllers validate with class-validator DTOs, services hold the rules, and repositories are the only code that touches `DatabaseService`. Unit tests run services against in-memory fake repositories, so CI needs no database.

**Tech Stack:** NestJS 11, Prisma 8 (`@prisma/orm-postgres` 8.0.0-rc.21), class-validator / class-transformer, multer (via `@nestjs/platform-express`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-workspaces-and-users-design.md`

## Global Constraints

- Every table has `id Uuid @id @onCreate(uuid(7))` and `+Timestamps`; every domain table has `workspaceId` → `workspaces` with `onDelete: Cascade`.
- Every repository read and write filters by `workspaceId`. An id from another workspace is a 404.
- Errors: 400 validation, 404 not found in workspace, 409 unique violation (Postgres SQLSTATE `23505`).
- Path ids are parsed with `ParseUUIDPipe`.
- Enum values are stored exactly as listed in the spec (`per_task`, uppercase `Language` and `Region`, everything else lowercase).
- Timezones are UTC offsets in minutes, −720…840, with `timezoneMin <= timezoneMax`. `mastery` and `preference` are 0–10, `yearsOfExperience` 0–60, `noticePeriodDays` 0–365.
- Resume: PDF only (mime `application/pdf` **and** leading bytes `%PDF-`), max 5 MB (5 _ 1024 _ 1024), stored under `RESUME_STORAGE_DIR` (default `./storage/resumes`) at key `<workspaceId>/<profileId>/<uuid>.pdf`.
- Never edit `contract.json` / `contract.d.ts` by hand. Re-emit with `pnpm --filter @xjobs/xjobs db:emit` (run from `apps/xjobs`: `npx prisma contract emit`).
- Before writing a query, read the installed Prisma 8 references in `node_modules/.pnpm/@prisma+orm-postgres@8.0.0-rc.21*/node_modules/@prisma/orm-postgres/skills/prisma-8/references/` (`contract.md`, `queries.md`, `queries-postgres.md`, `migrations.md`).
- Do not read or write `.env*` (except `.env.example`) or `private/`.

## Review Focus

1. **Email case and whitespace.** Creating `Bob@Example.com ` when `bob@example.com` exists in the workspace is a 409, not a second user. Covered in Task 4.
2. **Cross-workspace ids.** A user, contact or profile fetched through another workspace's path is a 404 and is never modified. Covered in Tasks 4–6.
3. **Duplicate skills in one PUT body.** Two `techStack` entries with the same `(technology, domain)` are a 400 from validation, not a 500 from the unique index. Covered in Task 6.
4. **A fake or oversized resume.** A file named `cv.pdf` that is not a PDF is a 400; a file over 5 MB is a 413; when saving the new file fails, the old resume stays. Covered in Task 7.
5. **Primary contacts and user deletion.** Marking a contact primary demotes the existing primary of the same kind instead of erroring. Deleting a user also deletes their resume file, not just the rows. Covered in Tasks 5 and 7.

---

### Task 1: Data contract, migration and seed

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma`
- Regenerate: `apps/xjobs/src/database/contract.json`, `contract.d.ts`
- Create: `apps/xjobs/src/database/migrations/app/<timestamp>_workspaces_and_users/` (planned by the CLI)
- Create: `apps/xjobs/src/database/seeds/workspaces.seed.ts`
- Modify: `apps/xjobs/src/database/seeds/users.seed.ts`, `seeds/index.ts`

**Interfaces:**

- Produces: ORM collections `db.orm.public.Workspace`, `User`, `Contact`, `Profile`, `ProfileSkill`. Enums `Position`, `Language`, `Region`, `Engagement`, `Arrangement`, `Seniority`, `ContactKind`, `Technology`, `SkillDomain`, all with `@@type("pg/text@1")`. Value object `Address`. Row types come from `contract.d.ts` (`Models.public_User` and so on; see `queries.md` § _Naming model and result types_).
- Produces: the TypeScript enum value lists in `apps/xjobs/src/common/enums/profile.enums.ts`, exported as `as const` arrays plus union types (`POSITIONS` / `Position`, `LANGUAGES`, `REGIONS`, `ENGAGEMENTS`, `ARRANGEMENTS`, `SENIORITIES`, `CONTACT_KINDS`, `TECHNOLOGIES`, `SKILL_DOMAINS`), re-exported from `src/common/enums/index.ts`. DTOs use these with `@IsIn`. A unit test asserts each array equals `Object.values(db.enums.public.<Enum>.members)` from the emitted contract, so the two cannot drift.

- [ ] **Step 1: Write the contract.** Models `Workspace` (`@@map("workspaces")`), `User` (`users`), `Contact` (`contacts`), `Profile` (`profiles`), `ProfileSkill` (`profile_skills`), with the fields, uniques and enum values from the spec's _Data model_ section. `@@index([workspaceId])` on every child table, plus `@@index([userId])` on contacts. Checks via `@@check(expression: sql\`...\`, name: "...")`:
  - profiles: `profiles_years_range` (`"yearsOfExperience" BETWEEN 0 AND 60`), `profiles_notice_range` (0–365), `profiles_tz_range` (all three offsets BETWEEN −720 AND 840 AND `"timezoneMin" <= "timezoneMax"`), `profiles_positions_nonempty` (`cardinality("positions") > 0`), and the same for languages, engagements and arrangements.
  - profile_skills: `profile_skills_mastery_range`, `profile_skills_preference_range` (0–10).
  - workspaces: `workspaces_slug_format` (`slug ~ '^[a-z0-9-]{2,64}$'`).
- [ ] **Step 2: Emit.** Run `cd apps/xjobs && npx prisma contract emit`. Expected: exit 0, and `contract.d.ts` mentions `public_Profile` and `Technology`.
- [ ] **Step 3: Plan the migration.** Run `cd apps/xjobs && npx prisma migration plan --name workspaces_and_users`. If the CLI asks about the origin (`MIGRATION.PLAN_ORIGIN_UNKNOWN`), plan from the init migration's snapshot as `migration-model.md` § _The trap_ describes, never from `@empty`. Existing `users` rows have no `workspaceId`: edit the generated `migration.ts` so it creates the `default` workspace and backfills `users.workspaceId` before the NOT NULL constraint, following `migrations.md` § data migrations. Expected: a new directory under `migrations/app/` whose ops create the four tables, alter `users`, and add the checks.
- [ ] **Step 4: Write the enum-drift test** in `apps/xjobs/src/common/enums/profile.enums.spec.ts`: for each enum, `expect([...POSITIONS].sort()).toEqual(Object.values(contract-derived members).sort())`. Build the members from `contract` exported by `src/database` (no connection needed). Run `npx nx test xjobs`. Expected: FAIL (arrays missing).
- [ ] **Step 5: Add `profile.enums.ts`** with the arrays. Run `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Seeds.** `workspacesSeed` (name `workspaces`) upserts `{ name: 'Default', slug: 'default' }`. `usersSeed` looks up the `default` workspace and upserts its users by `(workspaceId, email)`. In `index.ts`, order is `[workspacesSeed, usersSeed]`.
- [ ] **Step 7: Apply locally, if a database is reachable.** Run `cd apps/xjobs && npx prisma db migrate && pnpm db:seed && npx prisma db verify`. Expected: each exits 0. If no local database is running, note it in the handoff and continue.
- [ ] **Step 8: Typecheck and commit.** Run `npx nx run xjobs:typecheck`. Expected: PASS. Then `git commit -m "feat(db): add workspaces, users, contacts, profiles and skills to the contract"`.

### Task 2: Unique-violation mapping

**Files:**

- Create: `apps/xjobs/src/database/errors.ts`, `apps/xjobs/src/database/errors.spec.ts`
- Modify: `apps/xjobs/src/database/index.ts` (export)

**Interfaces:**

- Produces: `isUniqueViolation(error: unknown): boolean` (true when `error`, or any `error.cause` in its chain, has `sqlState === '23505'`), and `rethrowConflict(error: unknown, message: string): never` (throws `ConflictException(message)` when `isUniqueViolation`, otherwise rethrows `error`).

- [ ] **Step 1: Write the tests:** `isUniqueViolation({ sqlState: '23505' })` is true; `isUniqueViolation(new Error('x', { cause: { sqlState: '23505' } }))` is true; `isUniqueViolation({ sqlState: '23503' })` is false; `isUniqueViolation(null)` is false; `rethrowConflict` throws `ConflictException` for the first case and rethrows the original object for the third.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement** in `errors.ts`.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): map unique violations to 409`.

### Task 3: Workspaces module

**Files:**

- Create: `apps/xjobs/src/workspaces/{index.ts, workspaces.module.ts, workspaces.controller.ts, workspaces.service.ts, workspaces.repository.ts, workspaces.service.spec.ts, dto/create-workspace.dto.ts, dto/update-workspace.dto.ts, dto/workspace.dto.spec.ts}`
- Modify: `apps/xjobs/src/app/app.module.ts` (import `WorkspacesModule`)

**Interfaces:**

- Consumes: `DatabaseService`, `rethrowConflict`.
- Produces: `abstract class WorkspacesRepository` with `create(data: { name: string; slug: string }): Promise<WorkspaceRow>`, `list(): Promise<WorkspaceRow[]>`, `findById(id: string): Promise<WorkspaceRow | null>`, `update(id: string, data: Partial<{ name: string; slug: string }>): Promise<WorkspaceRow | null>`. `PrismaWorkspacesRepository` implements it and is bound with `{ provide: WorkspacesRepository, useClass: PrismaWorkspacesRepository }`. `WorkspacesService.getOrThrow(id: string): Promise<WorkspaceRow>` (404 `Workspace not found`). The module exports `WorkspacesService`, which Task 4 uses to 404 an unknown workspace. `WorkspaceRow = { id; name; slug; createdAt; updatedAt }`.
- The same pattern applies to every repository in Tasks 4–7: an abstract class used as the injection token, a `Prisma*` implementation, and an in-memory fake class in the spec file.

- [ ] **Step 1: DTO tests** (`validate(plainToInstance(CreateWorkspaceDto, …))`): `{ name: 'Mine', slug: 'my-space' }` is valid; slug `My Space`, `a` or 65 chars fails; an empty name fails; `UpdateWorkspaceDto` accepts `{}`.
- [ ] **Step 2: Service tests** with a fake repository: `create` returns the row; a duplicate slug (the fake throws `{ sqlState: '23505' }`) becomes `ConflictException`; `getOrThrow('missing')` throws `NotFoundException`; `update` on a missing id throws `NotFoundException`.
- [ ] **Step 3: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 4: Implement** the DTOs, repository, service and the controller (`@Controller('workspaces')`: `POST`, `GET`, `GET :workspaceId`, `PATCH :workspaceId`) and the module. Add `@ApiTags('workspaces')`.
- [ ] **Step 5: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(workspaces): add workspaces module`.

### Task 4: Users

**Files:**

- Create: `apps/xjobs/src/users/{index.ts, users.module.ts, users.controller.ts, users.service.ts, users.repository.ts, users.service.spec.ts, dto/address.dto.ts, dto/create-user.dto.ts, dto/update-user.dto.ts, dto/user.dto.spec.ts}`
- Modify: `apps/xjobs/src/app/app.module.ts` (import `UsersModule`)

**Interfaces:**

- Consumes: `WorkspacesService.getOrThrow`, `rethrowConflict`.
- Produces: `UsersRepository` with `create(workspaceId, data: UserInput): Promise<UserRow>`, `list(workspaceId)`, `findById(workspaceId, userId): Promise<UserRow | null>`, `update(workspaceId, userId, data: Partial<UserInput>): Promise<UserRow | null>`, `delete(workspaceId, userId): Promise<boolean>`. `UserInput = { name: string; email: string; address?: AddressInput | null }`. `UsersService.getOrThrow(workspaceId, userId): Promise<UserRow>` (404 `User not found`), used by Tasks 5–7. `UsersService.delete` calls `ProfilesService.removeResumeFor(workspaceId, userId)` (Task 7) before deleting; add that call in Task 7.
- Routes: `@Controller('workspaces/:workspaceId/users')`. Every handler calls `WorkspacesService.getOrThrow(workspaceId)` first.

- [ ] **Step 1: DTO tests:** a valid user with an address passes; email `not-an-email` fails; the address country `ma` fails (ISO alpha-2 uppercase, `@IsISO31661Alpha2` and `@Matches(/^[A-Z]{2}$/)`); `address.line1` missing fails; `@Transform` turns email `' Bob@Example.com '` into `'bob@example.com'`; an unknown property fails under `forbidNonWhitelisted` (validate with `{ whitelist: true, forbidNonWhitelisted: true }`).
- [ ] **Step 2: Service tests:** create, then create the same email in the same workspace → `ConflictException`; the same email in another workspace succeeds; `getOrThrow(workspaceB, userOfA)` → `NotFoundException`; `update` and `delete` across workspaces → `NotFoundException`, and the fake's row for workspace A is unchanged.
- [ ] **Step 3: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 4: Implement** the DTOs, repository, service, controller (`POST`, `GET`, `GET :userId`, `PATCH :userId`, `DELETE :userId` → 204) and module.
- [ ] **Step 5: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(users): add users CRUD`.

### Task 5: Contacts

**Files:**

- Create: `apps/xjobs/src/users/{contacts.controller.ts, contacts.service.ts, contacts.repository.ts, contacts.service.spec.ts, dto/create-contact.dto.ts, dto/update-contact.dto.ts, dto/contact.dto.spec.ts}`
- Modify: `apps/xjobs/src/users/users.module.ts`

**Interfaces:**

- Consumes: `UsersService.getOrThrow`, `rethrowConflict`, `CONTACT_KINDS`.
- Produces: `ContactsRepository` with `create(workspaceId, userId, data: ContactInput)`, `list(workspaceId, userId)`, `findById(workspaceId, userId, contactId)`, `update(...)`, `delete(...)`, and `setPrimary(workspaceId, userId, contactId, kind)`. `setPrimary` runs in one `db.transaction`: it sets `isPrimary=false` on the user's other contacts of `kind`, then `true` on `contactId`. `ContactInput = { kind: ContactKind; value: string; label?: string | null; isPrimary?: boolean }`.
- Routes: `workspaces/:workspaceId/users/:userId/contacts`: `POST`, `GET`, `PATCH :contactId`, `DELETE :contactId` → 204.

- [ ] **Step 1: DTO tests.** Value validation depends on `kind`, through one custom validator `IsContactValue`. `phone` requires E.164 (`+212612345678` passes, `0612345678` fails); `email` requires an email; `linkedin`, `github`, `gitlab`, `portfolio` and `website` require an `http(s)` URL; `other` accepts any non-empty string up to 500 chars. An unknown kind fails.
- [ ] **Step 2: Service tests:** creating a second `isPrimary: true` email contact leaves exactly one primary email contact (the new one); PATCH `isPrimary: true` does the same; a duplicate `(kind, value)` → `ConflictException`; a contact of user A reached via user B → `NotFoundException`.
- [ ] **Step 3: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 4: Implement.** On create or update with `isPrimary: true`, the service writes the contact, then calls `setPrimary`.
- [ ] **Step 5: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(users): add contacts`.

### Task 6: Profile and tech stack

**Files:**

- Create: `apps/xjobs/src/users/{profiles.controller.ts, profiles.service.ts, profiles.repository.ts, profiles.service.spec.ts, dto/upsert-profile.dto.ts, dto/skill.dto.ts, dto/profile.dto.spec.ts, dto/validators.ts}`
- Modify: `apps/xjobs/src/users/users.module.ts`

**Interfaces:**

- Consumes: `UsersService.getOrThrow`, the enum arrays from Task 1.
- Produces: `ProfilesRepository` with `findByUser(workspaceId, userId): Promise<ProfileWithSkills | null>` and `upsert(workspaceId, userId, data: ProfileInput, skills: SkillInput[]): Promise<ProfileWithSkills>`. `upsert` uses one `db.transaction`: it creates or updates the profile row by `userId`, deletes its `profile_skills`, and inserts `skills`. Also `setResume(workspaceId, profileId, meta: ResumeMeta | null): Promise<void>` for Task 7. `ProfileWithSkills = ProfileRow & { techStack: SkillRow[] }`.
- `ProfileView` (the response shape): all profile fields, `techStack: { technology, domain, mastery, preference }[]` sorted by `preference` desc then `mastery` desc, and `resume: { filename, sizeBytes, sha256, uploadedAt } | null`. It never includes `resumeKey`. Built by `toProfileView(p: ProfileWithSkills): ProfileView` in `profiles.service.ts`.
- `ProfilesService.getOrThrow(workspaceId, userId): Promise<ProfileWithSkills>` (404 `Profile not found`), used by Task 7.
- Routes: `workspaces/:workspaceId/users/:userId/profile`: `PUT` (200 with `ProfileView`), `GET`.

- [ ] **Step 1: DTO tests** for `UpsertProfileDto` (use a valid fixture and vary one field per test):
  - valid: `positions: ['backend_engineer']`, `languages: ['EN','FR']`, `country: 'MA'`, `regions: ['MENA','NORTH_AFRICA','EMEA']`, `yearsOfExperience: 6`, `timezoneCurrent: 60`, `timezoneMin: -240`, `timezoneMax: 240`, `engagements: ['employee','contractor']`, `arrangements: ['remote']`, `seniority: 'senior'`, `noticePeriodDays: 30`, `techStack: [{ technology: 'nodejs', domain: 'backend', mastery: 8, preference: 9 }]` → no errors.
  - empty `positions`, `languages`, `engagements` or `arrangements` → error (`@ArrayNotEmpty`, `@ArrayUnique`, `@IsIn(..., { each: true })`).
  - `engagements: ['per-task']` → error; `['per_task']` → ok.
  - `timezoneMin: 300, timezoneMax: 240` → error on `timezoneMax` (custom `IsGreaterOrEqual('timezoneMin')` in `dto/validators.ts`); `timezoneCurrent: 900` → error.
  - `mastery: 11` or `-1`, or `preference: 3.5` → error (`@IsInt @Min(0) @Max(10)`).
  - two `techStack` entries `{ nodejs, backend }` → error (custom `UniqueBy(['technology','domain'])`); `{ typescript, backend }` plus `{ typescript, frontend }` → ok.
  - `techStack: []` → ok (a profile may have no skills yet).
- [ ] **Step 2: Service tests:** `upsert` for a user without a profile creates one; a second `upsert` replaces `techStack` entirely (the old skill is gone, the new ones are present) and keeps the same profile id; `get` on a user without a profile → `NotFoundException`; `toProfileView` omits `resumeKey` and sorts the stack.
- [ ] **Step 3: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(users): add job-seeker profile with tech stack`.

### Task 7: Resume upload and storage

**Files:**

- Create: `apps/xjobs/src/users/{resume-storage.ts, resume-storage.spec.ts, resume.controller.ts, resume.service.spec.ts}`
- Modify: `apps/xjobs/src/users/profiles.service.ts`, `users.service.ts`, `users.module.ts`, `apps/xjobs/src/config/environment.validation.ts` (+ its spec), `.env.example`, `.gitignore`
- Modify: root `package.json` and the app `package.json` devDependencies: add `@types/multer` with the package manager the lockfile uses.

**Interfaces:**

- Produces: `abstract class ResumeStorage { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }`. `LocalResumeStorage(rootDir: string)` writes `path.join(rootDir, key)`, creating directories as needed. It rejects any key that resolves outside `rootDir`. `delete` of a missing file is a no-op. It is bound through a factory that reads `RESUME_STORAGE_DIR` from `ConfigService`.
- `ResumeMeta = { key: string; filename: string; sizeBytes: number; sha256: string; uploadedAt: Date }`.
- `ProfilesService.saveResume(workspaceId, userId, file: { originalname: string; mimetype: string; buffer: Buffer; size: number }): Promise<ProfileView>`, `getResume(workspaceId, userId): Promise<{ filename: string; data: Buffer }>`, `deleteResume(workspaceId, userId): Promise<void>`, and `removeResumeFor(workspaceId, userId): Promise<void>` (no-op when there's no profile or resume).
- Env: `RESUME_STORAGE_DIR: z.string().min(1).default('./storage/resumes')`.
- Routes on `workspaces/:workspaceId/users/:userId/profile/resume`: `POST` with `FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } })` (multer's limit error maps to 413 `PayloadTooLargeException`), `GET` (stream with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="<sanitized original>"`, via `StreamableFile`), and `DELETE` → 204.

- [ ] **Step 1: Storage tests** against `fs.mkdtemp` dirs: put then get round-trips; delete then get rejects; delete of a missing key resolves; key `../escape.pdf` rejects.
- [ ] **Step 2: Resume service tests** (fake repositories plus an in-memory `ResumeStorage` fake): a buffer starting `%PDF-1.7` with mime `application/pdf` is saved and the view's `resume.sha256` is its SHA-256 hex. The same bytes with mime `text/plain` → `BadRequestException`. Mime `application/pdf` with bytes `hello` → `BadRequestException`. Replacing a resume deletes the old key after the new `put`. When `put` throws, the old key is still in the fake and the profile meta is unchanged. With no file → `BadRequestException('A PDF file is required')`. `getResume` without one → `NotFoundException`. `removeResumeFor` deletes the stored key.
- [ ] **Step 3: Env test:** `validateEnvironment` without `RESUME_STORAGE_DIR` yields `./storage/resumes`.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 5: Implement.** Make `UsersService.delete` call `profiles.removeResumeFor` before deleting the user. Add `/storage` to `.gitignore`, and to `.env.example` (application section) add `# RESUME_STORAGE_DIR=./storage/resumes`.
- [ ] **Step 6: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(users): add resume PDF upload and local storage`.

### Task 8: End-to-end check and CI

**Files:**

- Create: `apps/xjobs-e2e/src/xjobs/users.spec.ts`

- [ ] **Step 1: Write the e2e spec** (axios, the existing support setup). Create a workspace with a unique slug, then a user. Add a primary GitHub contact. PUT a profile with the fixture from Task 6, then GET it: equal fields, `resume: null`. POST a small valid PDF (`Buffer.from('%PDF-1.4\n%%EOF')` as `FormData`), then GET `/resume`: status 200, `content-type` `application/pdf`. GET the user through a second workspace's path → 404. POST the same email again → 409.
- [ ] **Step 2: Run locally if a database and the server are available:** `npx nx e2e xjobs-e2e`. Expected: PASS. Otherwise record that it was not run.
- [ ] **Step 3: Run CI's command:** `npx nx run-many -t lint test build typecheck`. Expected: all targets succeed.
- [ ] **Step 4: Commit** `test(e2e): cover workspaces, users, profile and resume`.

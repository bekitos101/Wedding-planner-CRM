# Wedding Organizer — project guide for Claude

University project (Software Architectures, BMEVIAUMA21, 2026/27). A web app for professional
wedding planners: weddings, collaborators, guests + RSVP, tasks + checklists, budget + payments,
suppliers, day schedule, dashboard, notifications.

- Full requirements: @docs/SPEC.md (FR-xx, NFR-xx, AC-xx, BR-xx IDs are used everywhere)
- Build plan and current phase: @docs/PLAN.md
- REST contract shared by frontend and backend: @docs/API.md

## Stack (fixed by the spec — do not swap)
- **web/**: Angular + TypeScript, HTML, CSS with **Tailwind CSS v4** (utility classes; shared
  theme tokens and a few component classes in `web/src/styles.css`). No other UI library.
- **server/**: Node.js + Express + TypeScript, Prisma ORM, PostgreSQL
- Auth: JWT (httpOnly cookie or Bearer) + bcrypt, Express middleware
- Email: Nodemailer over SMTP. Local dev uses **Mailpit** (SMTP :1025, UI http://localhost:8025)
- Scheduled jobs: `node-cron` inside the single backend process (no queues, no microservices)
- Tests: Vitest + Supertest (server). Angular default test runner for web.

## Layout
```
docker-compose.yml   postgres:16 + mailpit
server/
  prisma/schema.prisma, prisma/seed.ts
  src/routes/        HTTP layer: parse + validate (zod), call a service, map errors
  src/services/      business logic: ALL rules, permissions, calculations
  src/repositories/  data access via Prisma only
  src/middleware/    auth (JWT), loadWedding, requireOwner / requireMember
  src/jobs/          cron jobs (reminders, email retry)
  src/lib/           mailer, token hashing, logger
  tests/             Vitest + Supertest, one file per feature area
web/
  src/app/core/      auth service, http interceptors, guards
  src/app/features/  one folder per feature (weddings, guests, tasks, budget, ...)
  src/app/rsvp/      public guest RSVP page (no planner shell, no auth)
docs/
```

## Environment (already set up — use these values)
- **Node 22**, pinned in `.node-version` and managed by fnm (the machine's global Node is 16).
  **Claude's Bash/PowerShell tools start on Node 16**, so ALWAYS run node/npm/npx/ng through
  fnm, from the Bash tool, wrapped in `bash -c` (plain `fnm exec -- npm` fails on Windows):
  `cd server && fnm exec -- bash -c 'npm test'`, `fnm exec -- bash -c 'npx prisma migrate dev'`.
  (`fnm exec -- npm.cmd ...` also works.) fnm reads `.node-version` from the repo root. Phase 0 must add
  `"engines": { "node": ">=22" }` to `server/package.json` and `web/package.json`, plus an
  `.npmrc` with `engine-strict=true` next to each.
- **docker-compose.yml** (done): postgres:16 with a persistent `pgdata` volume + Mailpit.
  The init script in `docker/postgres-init/` creates the test database on first start.
  - `DATABASE_URL=postgresql://wedding:wedding@localhost:5432/wedding_organizer`
  - test: `postgresql://wedding:wedding@localhost:5432/wedding_organizer_test`
  - SMTP `localhost:1025` (no auth), Mailpit UI http://localhost:8025
- Docker Desktop must be running before `docker compose up -d`.

## Commands
- `docker compose up -d` — start Postgres and Mailpit
- `cd server && npm run dev` — API on http://localhost:3000
- `cd server && npx prisma migrate dev` — apply schema changes
- `cd server && npm test` — run backend tests (must pass before a phase is done)
- `cd web && npm start` — Angular on http://localhost:4200 (proxies /api to :3000)

## Non-negotiable rules
1. **Three layers.** Routes never touch Prisma; repositories hold no business rules (NFR-21).
2. **Authorization lives in the backend** for every protected endpoint: identity, wedding
   membership, and permission (NFR-02, FR-18). Frontend hiding a button is cosmetic only.
3. **Roles:** owner = `Wedding.ownerId` (full control). Team member = active `WeddingMember`
   row: read-only, except `status` and `progressNotes` on tasks assigned to them (BR-03).
   Any other field in a team member's task update → 403, not silently ignored.
4. **Wedding data isolation:** any `/weddings/:weddingId/...` request from a non-member → 404
   (don't leak existence). Child records must be looked up scoped by `weddingId`.
5. **Validate every input on the server** with zod (NFR-04). Error responses use the shape in
   docs/API.md with a human-readable `message` (NFR-10).
6. **Derived values are computed, never stored:** totals paid, outstanding balance, remaining
   budget, RSVP counts, overdue flags (FR-59, BR-07, BR-08).
7. **Money** is `Decimal(12,2)` in Prisma; never JS floats for sums — use Prisma.Decimal.
8. **Invitation tokens:** 32 random bytes (base64url), only the SHA-256 hash stored. Tokens,
   passwords, JWTs never logged (NFR-06).
9. **Jobs are idempotent:** unique constraints + upserts so re-running cron creates no
   duplicates (NFR-16). Email failures are recorded, never thrown into request handlers (NFR-17).
10. **Out of scope (v1):** real payments, supplier booking, plus-ones/groups, SMS, real-time,
    custom templates, overdue-task reminders. Don't build them.

## Decisions filling gaps in the spec
- One RSVP deadline per wedding: `Wedding.rsvpDeadline` (Assumption 10.1), a calendar date
  (`@db.Date`, `"YYYY-MM-DD"` in the API). RSVPs are accepted through the whole deadline day;
  an invitation is expired once today's UTC date is after `rsvpDeadline`.
- Archived weddings are read-only (409), except the owner may still revoke team members.
- Team members can read all of a wedding's data except collaborator management (owner only).
  Revisit if the team decides "permitted information" should be narrower (FR-14).
- Reminder config: one in-app + one email reminder `REMINDER_DAYS_BEFORE` (default 3) days
  before a task's deadline, sent to the assignee (or the owner if unassigned).
- Email retry policy (FR-64): up to 3 attempts, retry job every 10 minutes, then status `FAILED`
  and visible to the planner for manual resend.
- Resending an invitation rotates the token (old link stops working) and keeps one invitation
  per guest (BR-05).

## Working conventions
- Work phase by phase from docs/PLAN.md; tick items there when done.
- Every business rule (BR-xx) and every acceptance criterion (AC-xx) gets at least one test.
  Name tests with the ID, e.g. `it('AC-04: member cannot update another member's task')`.
- If you change an endpoint, update docs/API.md in the same change.
- Any CSV/spreadsheet export must neutralise formula injection (CWE-1236): text cells starting
  with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Guests can type free text via the public
  RSVP page, so treat every exported text field as untrusted.
- **Never commit.** No `git add`, `commit`, `reset`, `stash`, `push` or other state-changing
  git commands — the user commits manually. At the end of a step, suggest a commit message
  referencing FR/AC IDs instead. Read-only git (`status`, `diff`, `log`) is fine.
- **No AI attribution in commits or PRs.** Suggested (or, when explicitly asked, actual) commit
  messages and PR descriptions must NOT contain `Co-Authored-By: Claude …`, "Generated with
  Claude Code" or similar lines — the user doesn't want Claude listed as a contributor.

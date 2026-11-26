# Wedding Organizer

A web application for professional wedding planners. Manage several weddings in one place:
collaborators, guests and RSVPs, tasks and checklists, budget and payments, suppliers, the
wedding-day schedule, a dashboard and notifications.

University project for **Software Architectures (BMEVIAUMA21), 2026/27**.

| Part | Technology |
|---|---|
| Frontend (`web/`) | Angular 22, TypeScript, Tailwind CSS v4 |
| Backend (`server/`) | Node.js 22, Express 5, TypeScript, Prisma 6, zod, JWT + bcrypt |
| Database | PostgreSQL 16 (Docker) |
| Email | Nodemailer over SMTP; locally Mailpit (Docker) catches all outgoing mail |
| Scheduled jobs | node-cron inside the API process (task reminders, email retries) |
| Tests | Vitest + Supertest (server), Vitest (web) |

### Features

- **Accounts:** register, log in / out, profile, password change (ends other sessions).
- **Weddings:** several per planner, progress, archive (read-only afterwards).
- **Team:** invite registered planners as team members (read-only, can update their own tasks), revoke access.
- **Guests & RSVP:** guest list, invitation emails with a secure personal link, public RSVP page
  for guests (no account), delivery status with automatic retry, dietary requirements.
- **Tasks & checklists:** assign tasks, overdue tracking, built-in checklist templates.
- **Budget:** expenses, deposits and instalments, outstanding balances, overdue payments, over-budget warning.
- **Suppliers** and the **wedding-day schedule** with overlap warnings.
- **Dashboard & reports:** live totals, charts, guest/dietary and budget-by-category reports with CSV export.
- **Notifications:** in-app bell and email reminders 3 days before task deadlines.
- **Public site:** landing page and contact form.

Requirements, build plan and API: see [Documentation](#8-documentation).

---

## 1. Prerequisites

Install these once:

| Tool | Version | Check with |
|---|---|---|
| [Node.js](https://nodejs.org) | **22** | `node -v` → `v22.x` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | any recent | `docker compose version` |
| [Git](https://git-scm.com) | any recent | `git --version` |

**Node version matters.** Both apps refuse to install on older Node (`engine-strict`). If you
need another Node version for other projects, use a version manager. The repo pins Node 22 in
`.node-version`, so with [fnm](https://github.com/Schniz/fnm) you can just run `fnm use` in the
project folder.

---

## 2. First-time setup

Make sure **Docker Desktop is running**, then from the project root:

**Windows (PowerShell)**
```powershell
# 1. Start the database and the mail catcher
docker compose up -d

# 2. Backend
cd server
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
npm install
npx prisma migrate dev          # creates the tables
npm run db:seed                 # demo accounts and weddings (safe to re-run)

# 3. Frontend
cd ..\web
npm install
```

**macOS / Linux**
```bash
docker compose up -d

cd server
cp .env.example .env
cp .env.test.example .env.test
npm install
npx prisma migrate dev
npm run db:seed

cd ../web
npm install
```

---

## 3. Run the app

You need **two terminals**, one for each part:

| Terminal | Folder | Command | Runs on |
|---|---|---|---|
| 1 (API) | `server/` | `npm run dev` | http://localhost:3000 |
| 2 (web) | `web/` | `npm start` | **http://localhost:4200** ← open this |

Open **http://localhost:4200** in your browser. The Angular dev server forwards every `/api/...`
request to the API on port 3000, so you never need to open port 3000 yourself.

Both servers reload automatically when you edit code.

> **Run exactly one API instance.** The API also runs the scheduled jobs (reminders every
> minute, email retries every 10 minutes); two instances would both run them. If the app shows
> "Something went wrong" everywhere, the API terminal has stopped — start it again.

### Demo accounts

Created by `npm run db:seed`. Password for all of them: **`Password123!`**

| Email | Who | Role |
|---|---|---|
| `owner@demo.test` | Olivia Owner | Owns three weddings: Emma & Daniel, Sofia & Marco and (archived) Lili & Bence |
| `member@demo.test` | Tom Teammate | Active team member of Emma & Daniel (read-only, can update tasks assigned to him) |
| `assistant@demo.test` | Anna Assistant | Active team member of Emma & Daniel and Sofia & Marco |
| `former@demo.test` | Mark Former | Revoked member of Emma & Daniel (shows the Revoked chip on the Team page; has no access) |
| `planner2@demo.test` | Peter Planner | Owns his own wedding (Judit & Andras); Olivia cannot see it, which demonstrates isolation |

### Demo data

`npm run db:seed` is safe to run any number of times (fixed ids, no duplicates). To start from scratch use `npm run db:reset` (drops the data, re-applies migrations and re-seeds).

| Wedding | Owner | What is in it |
|---|---|---|
| Emma & Daniel (2027-06-19) | Olivia | The showcase: 40 guests with every RSVP and invitation state (sent, failed, revoked, pending, not invited) and dietary notes, 25 tasks (overdue, due this week, assigned to Olivia, Tom and Anna), 11 expenses with deposits and instalments (over budget, one overdue, one due soon), 10 suppliers, a full-day schedule with intentional overlaps |
| Sofia & Marco (2027-09-25) | Olivia | Medium data, under budget: 20 guests, 12 tasks (six created from the "Short engagement" checklist template), 6 expenses, 5 suppliers, a short schedule |
| Lili & Bence (2026-09-12) | Olivia | Archived (Archived tab): 8 guests, 6 completed tasks, 4 fully paid expenses |
| Judit & Andras (2027-08-14) | Peter | A little data: 3 guests, 3 tasks, 2 expenses, 1 supplier |

Two demo RSVP links are created (never in production). The path pattern is `<APP_BASE_URL>/rsvp/<token>`; **copy the exact URLs from the seed output** (printed at the end of `npm run db:seed`):

- an open link for a pending guest of Emma & Daniel, so you can answer the RSVP and watch the dashboard change;
- a link for a guest of the archived wedding, which shows the "no longer valid" page.

### Other local URLs

| URL | What |
|---|---|
| http://localhost:8025 | **Mailpit**: every email the app sends (invitations, reminders) lands here |
| http://localhost:3000/api/health | API health check: `{"status":"ok","db":"ok"}` |
| `npx prisma studio` (in `server/`) | Browse and edit the database in your browser |

### Stopping

- `Ctrl+C` in each terminal stops the API and the web app.
- `docker compose down` stops Postgres and Mailpit. **Your data is kept.**
- `docker compose down -v` stops them **and deletes all data**. Run the setup steps again afterwards.

---

## 4. Run the tests

```powershell
cd server
npm test                        # API tests, against a separate *_test database

cd ..\web
npm test -- --watch=false       # Angular tests (no browser needed)
```

The server tests use their own database (`wedding_organizer_test`, created automatically by
Docker), so running them never touches your dev data. They refuse to run if `server/.env.test`
is missing or points at a database whose name doesn't end in `_test`.

---

## 5. Configuration

All backend settings live in `server/.env` (copied from `.env.example`). The defaults work
for local development as they are.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://wedding:wedding@localhost:5432/wedding_organizer` | Postgres connection (matches `docker-compose.yml`) |
| `JWT_SECRET` | placeholder | Signs login tokens. **At least 32 characters.** Use a long random value outside local dev; in production the server refuses any secret containing `change-me` or `test-secret` |
| `PORT` | `3000` | API port |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Mail server (Mailpit locally) |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | empty / empty / `false` | Login and TLS for a real mail provider (not needed for Mailpit) |
| `SMTP_FROM` | `Wedding Organizer <no-reply@wedding.local>` | Sender address on emails |
| `CONTACT_TO` | `hello@wedding-organizer.local` | Where contact-form messages go. **Set a real inbox outside local dev**, otherwise messages are lost |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the API. Set to `1` behind one proxy so the contact-form rate limit is per visitor |
| `APP_BASE_URL` | `http://localhost:4200` | Used to build links in emails (e.g. RSVP links) and as the allowed browser origin for state-changing requests (CSRF guard); must be `https:` in production |
| `REMINDER_DAYS_BEFORE` | `3` | Days before a task deadline that reminders are sent |
| `CRON_ENABLED` | `true` | Turns the scheduled jobs (reminders, email retries) on or off |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` |

`.env` files are git-ignored. Never commit real secrets.

---

## 6. Useful commands

Run these inside `server/`:

| Command | What it does |
|---|---|
| `npm run dev` | Start the API with auto-reload |
| `npm test` | Run the API tests |
| `npm run build` then `npm start` | Production build and run |
| `npx prisma migrate dev` | Apply new database migrations (after pulling schema changes) |
| `npm run db:seed` | Re-create demo data (idempotent, never duplicates) |
| `npm run db:reset` | **Wipe** the dev database, re-apply migrations and re-seed |
| `npx prisma studio` | Database browser |
| `npm run perf:dashboard` | Dashboard performance test (NFR-20) on a separate `wedding_organizer_perf` database; rewrites `docs/PERFORMANCE.md`. Create the database once: `docker compose exec postgres psql -U wedding -d postgres -c "CREATE DATABASE wedding_organizer_perf OWNER wedding;"` |

**After pulling new changes:** run `npm install` in both folders and `npx prisma migrate dev` in `server/`.

### Production notes

The project is built and demoed locally. For a real deployment:

- **HTTPS is required** (NFR-07): terminate TLS at a reverse proxy (e.g. nginx, Caddy) or the
  hosting platform, set `NODE_ENV=production` (login cookies become `Secure`) and `TRUST_PROXY=1`.
- Set a long random `JWT_SECRET`, real SMTP settings (`SMTP_*`), `CONTACT_TO` and `APP_BASE_URL`
  (the public URL of the web app — it is used in invitation and reminder links).
- Build: `cd server && npm run build && npm start`; `cd web && npm run build` produces static files
  in `web/dist/web/browser/` — serve them and route `/api/*` to the API (same origin).
- Apply migrations with `npx prisma migrate deploy` (not `migrate dev`). Do **not** run the seed:
  it creates demo accounts with a public password.
- Run **one** API instance with `CRON_ENABLED=true`; any additional instances must use `CRON_ENABLED=false`.
- The API sends its own security headers (nosniff, frame denial, `Cache-Control: no-store`, HSTS in
  production). The proxy that serves the **web app** should add: an HTTP→HTTPS redirect,
  `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
- `docker-compose.yml` is for **development only** (public credentials, ports bound to localhost).
  Use a managed or properly secured PostgreSQL in production.

### Security notes

- Sessions are stateless JWTs in an httpOnly, `SameSite=Lax` cookie (7 days). Logging out clears the
  cookie; changing the password invalidates all other sessions.
- Login, registration and password checks are rate-limited; invitation links carry 256-bit random
  tokens of which only a SHA-256 hash is stored.
- Known, accepted: `npm audit` reports advisories in the Prisma **CLI** dependency chain
  (`deepmerge-ts`, `effect`). They are only reachable at build/migration time with trusted config,
  never from user input; the fix requires the Prisma 7 major upgrade, deferred after v1.

---

## 7. Project structure

```
docker-compose.yml        Postgres 16 + Mailpit for local development
docker/postgres-init/     Creates the test database on first start
server/
  prisma/                 schema.prisma (data model), migrations, seed.ts + seeds/ (demo data)
  src/routes/             HTTP layer: validates input (zod), calls a service
  src/services/           Business logic: all rules, permissions and calculations
  src/repositories/       Data access (Prisma only)
  src/middleware/         Authentication, wedding access checks, error handling
  src/jobs/               Scheduled jobs: reminder delivery, email retries
  src/lib/                Logger, JWT, mailer, tokens, shared validation, helpers
  tests/                  API tests (Vitest + Supertest)
web/src/app/
  core/                   Auth, guards, HTTP interceptors, layout (header/footer), shared UI, models, pipes
  features/               One folder per feature (weddings, guests, tasks, budget, dashboard, ...)
  layout/                 Planner shell with side navigation
  rsvp/                   Public guest RSVP page (no login)
docs/
  SPEC.md                 Requirements (FR-, NFR-, AC-, BR- IDs)
  PLAN.md                 Build plan and progress
  API.md                  REST API contract shared by frontend and backend
  ACCEPTANCE.md           Acceptance criteria → tests, plus a manual demo script
  PERFORMANCE.md          Dashboard performance test (NFR-20)
```

The backend follows a strict **three-layer architecture**: routes → services → repositories.
Routes never access the database directly, and all permission checks happen on the server.

---

## 8. Documentation

- [docs/SPEC.md](docs/SPEC.md): requirements specification (Markdown copy; the PDF is authoritative)
- [docs/API.md](docs/API.md): every endpoint, request/response shape and error code
- [docs/PLAN.md](docs/PLAN.md): build phases and what's done
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): how every acceptance criterion (AC-01..AC-15) is verified, and a step-by-step demo script
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): dashboard response times on a representative dataset (NFR-20)

---

## 9. Credits

- Fonts: Playfair Display and Inter, self-hosted through `@fontsource` packages (SIL Open Font License 1.1).
- The public pages currently use built-in SVG ornaments and gradients instead of photographs. If stock photos from Unsplash are added to `web/public/images/`, list the photo page and photographer here.

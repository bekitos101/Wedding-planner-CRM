# Wedding Organizer

A web application for professional wedding planners. Manage several weddings in one place:
collaborators, guests and RSVPs, tasks and checklists, budget and payments, suppliers, the
wedding-day schedule, a dashboard and notifications.

University project for **Software Architectures (BMEVIAUMA21), 2026/27**.

| Part | Technology |
|---|---|
| Frontend (`web/`) | Angular 22, TypeScript, CSS |
| Backend (`server/`) | Node.js 22, Express 5, TypeScript, Prisma 6, zod |
| Database | PostgreSQL 16 (Docker) |
| Email (local dev) | Mailpit (Docker), catches all outgoing mail |
| Tests | Vitest + Supertest (server), Vitest (web) |

> **Status:** accounts (register, log in, profile) are done. Weddings, team members, guests,
> tasks, budget and the rest are being added phase by phase. See [docs/PLAN.md](docs/PLAN.md).

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

### Demo accounts

Created by `npm run db:seed`. Password for both: **`Password123!`**

| Email | Who | Role |
|---|---|---|
| `owner@demo.test` | Olivia Owner | Owns both demo weddings |
| `member@demo.test` | Tom Teammate | Team member of the first wedding (read-only, can update tasks assigned to him) |

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
| `JWT_SECRET` | placeholder | Signs login tokens. **At least 32 characters.** Use a long random value outside local dev; the server refuses the placeholder in production |
| `PORT` | `3000` | API port |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Mail server (Mailpit locally) |
| `SMTP_FROM` | `Wedding Organizer <no-reply@wedding.local>` | Sender address on emails |
| `APP_BASE_URL` | `http://localhost:4200` | Used to build links in emails (e.g. RSVP links) |
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

**After pulling new changes:** run `npm install` in both folders and `npx prisma migrate dev` in `server/`.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows **"Cannot GET /"** | You opened port 3000 (the API). Open **http://localhost:4200** instead |
| Page doesn't load at :4200 | The web app isn't running. Run `npm start` in `web/` |
| Red banner "Can't reach the server right now" | The API isn't running. Run `npm run dev` in `server/` |
| `npm install` fails with **EBADENGINE** / unsupported engine | Your Node is older than 22. Check `node -v` and switch to Node 22 |
| `Can't reach database server at localhost:5432` | Docker Desktop isn't running, or the containers are stopped. Start Docker, then `docker compose up -d` |
| **Port already in use** (3000 or 4200) | An old server is still running. Close its terminal, or on Windows: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess` |
| Prisma **EPERM** error on Windows during `migrate` / `generate` | A running API server locks Prisma's engine file. Stop `npm run dev`, run the command again, then restart |
| Tests fail with "`.env.test` missing" | `Copy-Item .env.test.example .env.test` in `server/` |
| Web tests: "Timeout waiting for worker" | The machine was busy. Run the tests again |

---

## 8. Project structure

```
docker-compose.yml        Postgres 16 + Mailpit for local development
docker/postgres-init/     Creates the test database on first start
server/
  prisma/                 schema.prisma (data model), migrations, seed.ts
  src/routes/             HTTP layer: validates input (zod), calls a service
  src/services/           Business logic: all rules, permissions and calculations
  src/repositories/       Data access (Prisma only)
  src/middleware/         Authentication, error handling
  src/lib/                Logger, JWT, error types, helpers
  tests/                  API tests (Vitest + Supertest)
web/src/app/
  core/                   Auth service, guards, HTTP interceptors, shared models
  features/               One folder per feature (auth, profile, weddings, ...)
  layout/                 App shell: top bar and side navigation
  rsvp/                   Public guest RSVP page (no login)
docs/
  SPEC.md                 Requirements (FR-, NFR-, AC-, BR- IDs)
  PLAN.md                 Build plan and progress
  API.md                  REST API contract shared by frontend and backend
```

The backend follows a strict **three-layer architecture**: routes → services → repositories.
Routes never access the database directly, and all permission checks happen on the server.

---

## 9. Documentation

- [docs/SPEC.md](docs/SPEC.md): requirements specification (Markdown copy; the PDF is authoritative)
- [docs/API.md](docs/API.md): every endpoint, request/response shape and error code
- [docs/PLAN.md](docs/PLAN.md): build phases and what's done

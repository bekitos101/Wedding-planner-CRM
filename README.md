# Wedding Organizer

Web app for professional wedding planners (BMEVIAUMA21). See `CLAUDE.md`, `docs/SPEC.md`, `docs/PLAN.md`, `docs/API.md`.

## Prerequisites
- **Node 22.** Your machine's global Node may be older. Node 22 is pinned in `.node-version`:
  run `fnm use` in the repo (or install Node 22 another way), check `node -v`, then `npm install`.
  Both `server/` and `web/` enforce `engines: node >=22` (`engine-strict`).
- Docker Desktop (running)

## Quick start
```
docker compose up -d                 # Postgres + Mailpit

cd server
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
cp .env.test.example .env.test       # PowerShell: Copy-Item .env.test.example .env.test
npm install
npx prisma migrate dev               # apply migrations
npm run db:seed                      # demo data (safe to re-run)
npm run dev                          # API on http://localhost:3000 (check /api/health)
npm test                             # backend tests (use the *_test database)

cd ../web
npm install
npm start                            # Angular on http://localhost:4200 (proxies /api)
```

- Mailpit UI (captured emails): http://localhost:8025
- Demo accounts (after seeding), password `Password123!`:
  - `owner@demo.test` (Olivia Owner, owns both demo weddings)
  - `member@demo.test` (Tom Teammate, team member of the first wedding)

The full install guide comes in Phase 6.

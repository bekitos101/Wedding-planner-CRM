# Build plan

Tick boxes as work lands. Each phase ends with `cd server && npm test` green; the user then
commits it manually (Claude only suggests the message).
Phases 0–2 are sequential (everything depends on them). Phase 3 tracks can run in parallel —
each track owns its own route/service/repository/test files and its own web feature folder.

## Phase 0 — Scaffold (main session)
- [x] Monorepo: `server/`, `web/`, `docs/`, root `.gitignore`, `README.md`
- [x] `docker-compose.yml`: postgres:16 (volume for persistence, AC-14) + axllent/mailpit
      (+ `docker/postgres-init` creates the test DB; Node 22 pinned in `.node-version`)
- [x] `server/`: Express + TypeScript, zod, pino logger with redaction of `password`, `token`,
      `authorization`, `cookie` (NFR-06), central error handler, `/api/health`
- [x] `server/.env.example`: DATABASE_URL, JWT_SECRET, SMTP_HOST/PORT, APP_BASE_URL,
      REMINDER_DAYS_BEFORE=3, CRON_ENABLED=true
- [x] Full Prisma schema for all 12 entities (+ ChecklistTemplateItem) incl. constraints:
      `@@unique([weddingId, userId])` on WeddingMember (BR-02), `guestId @unique` on Invitation
      (BR-05), `tokenHash @unique`, `@@unique([taskId, userId, type, channel, scheduledAt])` on
      Notification (NFR-16), `Wedding.rsvpDeadline`, `Invitation.revokedAt`,
      `Invitation.attemptCount`, Decimal(12,2) money, enums for statuses
- [x] Vitest + Supertest setup with a separate test database, reset between test files
- [x] `web/`: Angular app, routing, `/api` proxy to :3000, base layout
- [x] Seed script: demo owner, team member, 2 weddings, built-in checklist templates (FR-36)

## Phase 1 — Accounts (FR-01..04) → AC-01 part
- [x] Register / login / logout / me / update profile; bcrypt cost 12; JWT auth middleware
- [x] Web: login, register, profile pages; auth guard; interceptor

## Phase 2 — Weddings, membership, authorization core (FR-06..18, BR-01/02/13/14)
- [x] Middleware `loadWedding` (404 for non-members), `requireOwner`, `requireMember`
- [x] Wedding CRUD + archive; list active weddings with progress (% tasks completed)
- [x] Collaborators: add registered user by email, list, revoke (status REVOKED, data kept)
- [x] Tests: AC-01, AC-02, BR-14 (non-member gets 404 on every wedding route), BR-02
- [x] Web: wedding list, create/edit wedding, wedding shell with side nav (NFR-09),
      collaborator page (owner only), role badge (NFR-11)

## Phase 2.5 — Design refresh (requested by the team)
- [x] Tailwind CSS v4 in web/, theme tokens ("elegant & soft": ivory/blush, rose accent, serif
      headings), self-hosted fonts; all existing screens restyled consistently (NFR-12)
- [x] Public site: header with navigation, landing page (hero photo, features, how it works,
      call to action), contact page, footer with links and "© Wedding Organizer. All rights reserved."
- [x] Routing: `/` landing (logged-in planners → `/weddings`), `/weddings` list, `/contact` public
- [x] Backend: `POST /api/contact` (zod, honeypot, rate limit, Nodemailer → Mailpit), shared
      `lib/mailer.ts` that phase 3A/5 reuse
- [ ] Stock photos in web/public/images (Unsplash licence), credited in README — **pending: automated download blocked; decorative illustrations used meanwhile**

## Phase 3 — Feature tracks (parallel)
### 3A Guests, invitations, RSVP (FR-19..30, BR-04/05/06/11, NFR-03/08)
- [x] Guest CRUD + search; send / resend invitation (rotate token, one invitation per guest)
- [x] Mailer records deliveryStatus SENT / FAILED + attemptCount; failures never break the request
- [x] Public `GET/POST /api/rsvp/:token`: hash lookup, revoked/expired/invalid → 404/410,
      returns only that guest's name, wedding couple names/date, current status
- [x] Revoke invitation endpoint
- [x] Tests: AC-05, AC-06, AC-07 (invalid, revoked, expired), BR-05
- [x] Web: guest list with filters, invitation status column + resend; public RSVP page

### 3B Tasks and checklists (FR-31..38, BR-03)
- [x] Task CRUD (owner); assignee must be an active member (UC-07)
- [x] `PATCH /tasks/:id` for members: only `status`, `progressNotes`, only own tasks; anything
      else → 403
- [x] Overdue flag computed (FR-35); list templates; apply template copies items into tasks
- [x] Tests: AC-03, AC-04, AC-09
- [x] Web: task board/list, "My tasks", template picker, member edit form limited to 2 fields

### 3C Budget and payments (FR-39..47, BR-07/08, NFR-14)
- [x] Expense CRUD; payment CRUD nested under expense; totals computed in service
- [x] Wedding budget summary: totalBudget, committed, paid, outstanding, remaining; overdue
      expenses (FR-46)
- [x] Tests: AC-08, BR-07, BR-08 (edit/delete payment changes balance)
- [x] Web: expenses table with paid/outstanding, payments drawer, budget summary card

### 3D Suppliers and schedule (FR-48..56, BR-12)
- [x] Supplier CRUD
- [x] Schedule CRUD, `startTime < endTime` validation, sorted list, response includes
      `overlapsWith: id[]` per item and a `warnings` array on create/update
- [x] Tests: AC-10, BR-12
- [x] Web: supplier list/form; timeline view with overlap highlight

## Phase 4 — Dashboard and reports (FR-57..60, NFR-20)
- [x] `GET /weddings/:id/dashboard` aggregating via queries (groupBy/aggregate), no stored totals
- [x] Reports: guest responses (counts + dietary list), budget status by category
- [x] Tests: AC-11 (seed known data, assert exact numbers)
- [x] Web: dashboard cards + simple charts; reports page

## Notes from the Phase 0 review (apply in the named phase)
- Phase 2: don't let the owner also get a `WeddingMember` row (BR-01/02). On revoke, unassign
  the member's tasks and cancel their PENDING reminders (FR-13, FR-62).
- Phase 3: no DB CHECK constraints exist — zod must enforce `Payment.amount > 0`,
  `agreedAmount >= 0`, `startTime < endTime` (NFR-04).
- Phase 3 (from the Phase 2 review): mount every feature router under the shared
  `/weddings/:weddingId` parent router (access is checked there); add each route to
  `WEDDING_ROUTES` in tests/authorization.test.ts with its `access` and `write` flags — the
  route-enumeration test fails otherwise. 3B: check "assignee is an active member" inside the same
  transaction as the task write, so it can't race with a revoke. 3A: RSVP expiry uses the
  date-only rule in CLAUDE.md.
- Phase 6 (from the Phase 3 review): the archived check for guests/budget/suppliers/schedule writes
  runs in middleware only (not in the write transaction, unlike tasks), so a write racing an archive
  can still land. Low impact; consider a shared `assertWeddingActive(tx, weddingId)` with FOR SHARE.
- Phase 5 (from the Phase 2 review): archiving must cancel PENDING notifications (BR-13, FR-62);
  tasks unassigned by a revoke should get reminders re-created for the owner.
- Phase 5: the Notification unique key includes `scheduledAt` and `userId`, so a reschedule or
  reassignment won't hit the old row. In ONE transaction, CANCEL the old PENDING rows, then upsert
  the new ones; the upsert's update branch must reset `status=PENDING, attemptCount=0, sentAt=null`
  (rescheduling back to an earlier date hits a CANCELLED row) (NFR-16, BR-10, AC-13).

## Phase 5 — Notifications and scheduler (FR-61..64, BR-09/10/11/13, NFR-15/16/17)
- [x] On task create/update: upsert pending IN_APP + EMAIL reminders at
      `dueDate - REMINDER_DAYS_BEFORE`; cancel on complete/delete/archive; reschedule moves them
- [x] Cron every minute: send due EMAIL reminders (skip archived weddings); mark SENT/FAILED
- [x] Cron every 10 min: retry FAILED invitation/reminder emails with attemptCount < 3
- [x] In-app notification list + mark read
- [x] Tests: AC-12, AC-13, NFR-16 (run job twice → no duplicates), BR-13
- [x] Web: notification bell + list

## Phase 6 — Hardening and demo
- [ ] Full acceptance pass AC-01..AC-15 (tester agent)
- [ ] Security review against NFR-01..08 (reviewer agent)
- [ ] Dashboard timing with seeded representative data (e.g. 5 weddings × 200 guests) (NFR-20)
- [ ] README install guide: prerequisites, env vars, docker compose, migrate, seed, start,
      Mailpit URL, demo accounts (NFR-25, AC-15)
- [ ] Restart test: stop everything, start again, data still there (AC-14)

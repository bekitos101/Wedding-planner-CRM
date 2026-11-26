# Acceptance traceability (Phase 6)

How every acceptance criterion (AC), business rule (BR) and testable non-functional requirement (NFR)
in [SPEC.md](SPEC.md) is verified. Status legend: ✅ automated, 🟡 manual (see the procedures below), ❌ gap.

Test files live in `server/tests/` (Vitest + Supertest, real PostgreSQL test database) and
`web/src/app/**/*.spec.ts` (Angular runner). Names are quoted by their ID prefix; search for the ID.
`server/tests/acceptance.test.ts` is an end-to-end journey that uses only the public HTTP API
(register, login, create everything through endpoints) and proves AC-01..AC-13 in one chain;
the feature files hold the detailed, attacker and edge cases.

Run: `cd server && npm test` and `cd web && npx ng test --watch=false`.

## 1. Acceptance criteria

| ID | Criterion (short) | How it is verified | Status |
|---|---|---|---|
| AC-01 | Register, log in, create at least two weddings | `acceptance.test.ts` "AC-01/02/03/04: register, two weddings, ..." (register + login + two weddings + list). `auth.test.ts` "AC-01: planner can register and is logged in", "AC-01: planner can log in and log out". `auth-attacks.test.ts` "AC-01: register, login, GET /me, PATCH /me return exactly {id,name,email,createdAt}". `weddings.test.ts` "AC-01: planner can create at least two weddings and sees both in the list". Web: `login.page.spec.ts`, `weddings-list.page.spec.ts` | ✅ automated |
| AC-02 | Add a registered team member; owner can revoke | `members.test.ts` "AC-02: owner adds a registered team member and can revoke access"; `acceptance.test.ts` journey (add, member reads wedding, revoke, member gets 404, tasks kept). Web: `team.page.spec.ts` "revokes after confirmation and reloads" | ✅ automated |
| AC-03 | Member updates status/progress notes of an assigned task, not deadline, priority, assignment | `tasks.test.ts` "AC-03: team member updates status and progress notes of an assigned task but not deadline, priority or assignment"; `acceptance.test.ts` journey (5 forbidden bodies, each 403, row unchanged); `phase3-attacks.test.ts` BR-03 cases. Web: `tasks.page.spec.ts` "AC-03: member gets an edit form with ONLY status and progress notes, and sends only those" | ✅ automated |
| AC-04 | Member cannot update another member's task via UI or direct API | API: `tasks.test.ts` "AC-04: team member cannot update another member's task via direct API", `phase3-attacks.test.ts` "AC-04: team member cannot update another member's task via direct API (403, unchanged)", `acceptance.test.ts` journey (403, DB unchanged, then 404 after revoke). UI: `tasks.page.spec.ts` "AC-04: member sees no edit on tasks assigned to others" | ✅ automated |
| AC-05 | Add guest, send invitation, inspect delivery status | `invitations.test.ts` "AC-05: planner adds a guest, sends an invitation and sees its delivery status"; `acceptance.test.ts` journey; failure path `phase3-attacks.test.ts` "BR-11: a failed invitation email is recorded as FAILED ...". Web: `guests.page.spec.ts` "sends a first invitation straight away", "resend asks for confirmation, then shows a warning when delivery FAILED" | ✅ automated |
| AC-06 | Guest RSVPs via valid link; dashboard reflects it | `dashboard.test.ts` "AC-06: a guest's RSVP is reflected on the dashboard" (pending to accepted to declined, exact counts); `rsvp.test.ts` "AC-06: guest RSVPs via a valid link and the guest list summary reflects it"; `acceptance.test.ts` journey (real send, token from mail, RSVP, dashboard). Web: `rsvp-page.spec.ts` "posts the answer with dietary requirements and shows the updated answer" | ✅ automated |
| AC-07 | Invalid, revoked, expired links rejected | `rsvp.test.ts` "AC-07: invalid link 404, revoked link 410, expired link 410"; `phase3-attacks.test.ts` "AC-07: ..." (deadline today open, yesterday 410, tomorrow open, tampered tokens 404, stored hash is not a token, deleted guest 404); `acceptance.test.ts` journey. Web: `rsvp-page.spec.ts` "404 shows the invalid-link message", "410 shows the server message (revoked or deadline passed)", "a 410 while submitting switches to the closed card" | ✅ automated |
| AC-08 | Record a deposit and a later payment; outstanding balance correct | `budget.test.ts` "AC-08: planner records a deposit and a later payment and the outstanding balance is correct"; `phase3-attacks.test.ts` "AC-08: zero, negative, and malformed payment amounts → 400 and nothing stored"; `acceptance.test.ts` journey (1500.50 + 999.25 gives paid 2499.75, outstanding 2500.25; 0, -5, 0.00, abc rejected). Web: `budget.page.spec.ts` "lists payments", "shows an overpayment error under the amount field" | ✅ automated |
| AC-09 | Copy a built-in checklist without modifying the template | `checklists.test.ts` "AC-09: applying a built-in checklist copies tasks and leaves the template unchanged"; `phase3-attacks.test.ts` "AC-09: wedding closer than daysBeforeWedding → due dates clamped ..."; `acceptance.test.ts` journey (edit a copy, template rows byte-identical). Web: `tasks.page.spec.ts` (owner sees "Apply checklist template") | ✅ automated |
| AC-10 | Schedule chronological; overlaps warn | API: `schedule.test.ts` "AC-10: schedule is shown chronologically and an overlap triggers a warning"; `acceptance.test.ts` journey (created out of order, listed in order). UI: `schedule.page.spec.ts` "AC-10: shows overlapping items with a chip, highlight and the overlapped titles", "AC-10: items are displayed chronologically, grouped by day, in the order the API returns them", "BR-12: shows returned warnings as a dismissible alert after saving" | ✅ automated |
| AC-11 | Dashboard shows correct guest, task, financial totals from stored records | `dashboard.test.ts` "AC-11: dashboard shows correct guest, task and financial totals from stored records" (7 guests, 8 tasks, 3 expenses, exact values e.g. paid 4500.25, outstanding 4499.75, remaining 11000.00); `acceptance.test.ts` journey (exact budget block recomputed after API writes); `dashboard.test.ts` "FR-59: dashboard values change when records change". Web: `dashboard.spec.ts` "FR-57: renders exact numbers, ..." | ✅ automated |
| AC-12 | Upcoming task gives an in-app notification and a scheduled email reminder | `reminders.test.ts` "AC-12: an eligible upcoming task produces an in-app notification and a scheduled email reminder"; `phase5-attacks.test.ts` "AC-12: assigned task due in 10 days reaches the assignee bell and inbox exactly at scheduledAt, then mark read"; `acceptance.test.ts` journey (run the job, rows SENT, one email, inbox has one item). Web: `notification-bell.spec.ts`, `notifications.page.spec.ts` | ✅ automated |
| AC-13 | Completed or rescheduled task leaves no obsolete pending reminder | `reminders.test.ts` "AC-13: completing or rescheduling a task leaves no obsolete pending reminder"; `phase5-attacks.test.ts` "AC-13: complete, reschedule, reassign and delete via the API leave exactly the right PENDING rows"; `acceptance.test.ts` journey (reschedule moves both rows to the new date, member completes, zero PENDING) | ✅ automated |
| AC-14 | Data survives application restart | Automated proxy: `acceptance.test.ts` "AC-14: stored data is read back from the database after the connection is dropped and re-opened". Real proof is the manual restart procedure in section 5 (Postgres named volume `pgdata`) | ✅ verified 2026-11-26: `docker compose down` + `up -d` → users, weddings, guests, tasks, expenses, payments, notifications, total paid and RSVP answers identical; the running API recovered without a restart |
| AC-15 | Team can install, configure, start, demo from the install docs | Manual: follow README from a fresh clone (procedure in section 5) | ✅ verified 2026-11-26: fresh copy without node_modules/.env, README steps on an empty database → install, migrate, seed, server + web build and sample tests (42/42) all succeeded |

## 2. Business rules

| ID | Rule | How it is verified | Status |
|---|---|---|---|
| BR-01 | Exactly one owner | `weddings.test.ts` "BR-01: the creator is the owner and gets no member row"; `schema-constraints.test.ts` "BR-01: wedding has exactly one owner (ownerId is required ...)"; `members.test.ts` "BR-01: owner's own email → 400 ..."; `weddings-attacks.test.ts` "BR-01: owner cannot be added as member even with different casing and spaces", "BR-01: owner cannot be revoked ..." | ✅ automated |
| BR-02 | No duplicate membership | `schema-constraints.test.ts` "BR-02: duplicate WeddingMember ... is rejected"; `members.test.ts` "BR-02: adding an active member twice → 409", "BR-02: re-adding a revoked member re-activates the same row"; `weddings-attacks.test.ts` "BR-02: revoke then re-add regains access, with exactly one row across two cycles" | ✅ automated |
| BR-03 | Member edits only status and progress notes of assigned tasks | `tasks.test.ts` "BR-03: member status change sets completedAt ...", "BR-03: a forbidden key beats value validation ..."; `phase3-attacks.test.ts` "BR-03: {status, progressNotes, assigneeId:null} → 403 and nothing changes", "BR-03: member sending protected keys with unchanged values → 403 (each key)", "BR-03: empty body as member never 500s ...", "BR-03: revoked member loses access ...", "BR-03: owner assigning a task to a revoked member → 400". Web: `tasks.page.spec.ts` AC-03 / AC-04 | ✅ automated |
| BR-04 | Individual guest records, no groups | `guests.test.ts` "BR-04: two guests may share an email and stay separate records" (no plus-one/group field exists in the API) | ✅ automated |
| BR-05 | Resend creates no duplicate guest or second active invitation | `invitations.test.ts` "BR-05: resend rotates the token, keeps one invitation, old link stops working", "BR-05: resending after a revoke makes a fresh working link"; `schema-constraints.test.ts` "BR-05: a guest can have at most one Invitation"; `phase3-attacks.test.ts` "BR-05: after resend the old token → 404, the new one works"; `jobs.test.ts` "BR-05: a retry racing a manual resend backs off ..." | ✅ automated |
| BR-06 | Invalid, revoked, expired tokens rejected | `rsvp.test.ts` "AC-07 ..." and "BR-06: RSVP stays open through the whole deadline day", "BR-06/BR-13: archived wedding → 410", "BR-06/NFR-08: revoke between validation and save → 410 and no write"; `dates.test.ts` "BR-06: closed from the first instant of the next UTC day"; `invitations.test.ts` "BR-06: sending after the RSVP deadline → 409" | ✅ automated |
| BR-07 | Outstanding = agreed - sum of payments | `budget.test.ts` "BR-07: outstanding = agreed − sum of payments", "BR-07: overpayment → 400 and the message states the outstanding balance"; exact decimals in `acceptance.test.ts` and `dashboard.test.ts` | ✅ automated |
| BR-08 | Editing/deleting a payment recalculates balances | `budget.test.ts` "BR-08: editing or deleting a payment recalculates the balance", "BR-08: editing a payment above the agreed amount → 400, balance unchanged"; `phase3-attacks.test.ts` "BR-08: payment edits lowering then raising keep totals exact", "BR-08: deleting an expense removes its payments from the summary". Web: `budget.page.spec.ts` "BR-08: after deleting a payment the expense and the summary are refreshed" | ✅ automated |
| BR-09 | Completed tasks generate no new upcoming reminders | `reminders.test.ts` "BR-09: a task created as COMPLETED gets no reminders; reopening creates them" | ✅ automated |
| BR-10 | Reschedule updates or cancels pending reminders | `reminders.test.ts` "BR-10: reassigning moves the reminders ...", "BR-10/FR-62: revoking a member moves the reminders of their tasks to the owner"; `jobs.test.ts` "BR-10: a FAILED reminder email is cancelled by a reschedule or reassignment ...", "BR-10: the retry job itself cancels a FAILED row ..."; AC-13 tests (reschedule) | ✅ automated |
| BR-11 | Email failures recorded and retried per policy | `invitations.test.ts` "NFR-17/BR-11: mail failure records FAILED and still returns 200"; `jobs.test.ts` "BR-11/FR-64: failed reminder emails are retried up to 3 attempts, then stay FAILED", "BR-11: a retry that succeeds marks the reminder SENT", "BR-11: a FAILED invitation is retried with a rotated token and attemptCount + 1, then SENT", "BR-11/FR-64: failed invitation retries stop at 3 attempts and stay FAILED"; `phase5-attacks.test.ts` "BR-11: attemptCount goes 1, 2, 3 ...", "BR-11/FR-64: after the 3rd failed attempt the guest list shows invitation FAILED ..." | ✅ automated |
| BR-12 | Overlaps warn but are permitted | `schedule.test.ts` "BR-12: overlapping items are saved (warning, not an error)", "BR-12: back-to-back items do not overlap", "BR-12: a contained item overlaps ..."; `phase3-attacks.test.ts` "BR-12: an item spanning midnight ...", "BR-12: three-way overlap ..."; `dashboard-attacks.test.ts` BR-12 cases. Web: `schedule.page.spec.ts` "BR-12: shows returned warnings ..." | ✅ automated |
| BR-13 | Archived weddings: excluded from active list, no new reminders | `weddings.test.ts` "BR-13: archived wedding excluded from default list, shown with ?status=archived", "BR-13: archived wedding is read-only (PATCH → 409, add member → 409)", "BR-13: archive is idempotent ..."; `authorization.test.ts` "BR-13: on an archived wedding every write route answers 409 ..."; `reminders.test.ts` "BR-13: archiving cancels pending reminders, the job skips archived weddings, none are created afterwards", "BR-13: the job cancels (does not send) a pending reminder whose wedding got archived behind its back"; `phase5-attacks.test.ts` "BR-13: archiving one wedding cancels only its pending reminders ..."; per-feature "BR-13" read-only tests in guests, tasks, budget, suppliers, schedule, invitations | ✅ automated |
| BR-14 | Unauthorized wedding-data requests rejected | `authorization.test.ts` "BR-14: non-member gets 404 on every wedding route (identical body for all cases)", "BR-14: the rejected requests changed nothing"; per-feature "BR-14: non-member gets 404 on every ... route" in guests, tasks, budget, suppliers, schedule, dashboard, reports, members; cross-wedding id tests in `weddings-attacks.test.ts`, `phase3-attacks.test.ts`, `dashboard-attacks.test.ts`, `phase5-attacks.test.ts`. Web: `wedding-area.spec.ts` | ✅ automated |

## 3. Testable non-functional requirements

| ID | Requirement (short) | How it is verified | Status |
|---|---|---|---|
| NFR-01 | Passwords hashed with an established algorithm | `auth.test.ts` "FR-03/NFR-01: password stored as bcrypt hash, never returned" (bcrypt, cost 12); "NFR-01: password change ends other sessions ..." | ✅ automated |
| NFR-02 | Backend checks identity, membership, permission on every protected operation | `authorization.test.ts` "NFR-02: unauthenticated → 401 on all of them", "NFR-02: an invalid token → 401 ..."; `phase5-attacks.test.ts` "NFR-02: a forged or garbage bearer token gets 401 ..."; owner-only 403 tests in members/tasks/budget/guests files | ✅ automated |
| NFR-03 | Unpredictable tokens, revocation, deadline enforced | `invitations.test.ts` "NFR-03: only the SHA-256 hash is stored (token is 32 random bytes, base64url)"; `schema-constraints.test.ts` "NFR-03: invitation tokenHash is unique"; AC-07 tests | ✅ automated |
| NFR-04 | All input validated on the server | `auth-attacks.test.ts` "NFR-04: wrongly typed bodies are rejected with 400, not 500"; `schemas.test.ts`; 400 VALIDATION_ERROR cases in every feature file | ✅ automated |
| NFR-05 | Parameterised queries / ORM | `acceptance.test.ts` "NFR-05: no unsafe raw SQL anywhere; every raw query is a parameterised tagged template" (static scan of `server/src`); Prisma used everywhere else | ✅ automated |
| NFR-06 | No passwords, tokens, secrets in logs | `logging-errors.test.ts` (log capture with redaction); `auth-attacks.test.ts` "NFR-06: error bodies have only the documented shape and no hash, stack or raw token", "NFR-06: malformed JSON body → 400 ..." | ✅ automated |
| NFR-07 | Production uses HTTPS | Deployment property (TLS terminates at a reverse proxy, see README "Deployment notes"); cookie flags checked in `auth.test.ts` (HttpOnly, SameSite=Lax) | 🟡 manual |
| NFR-08 | RSVP access restricted to the guest and invitation of the token | `rsvp.test.ts` "NFR-08/FR-30: RsvpView contains only that guest's data", "NFR-08: needs no login and a planner token does not unlock RSVP of other tokens", "NFR-08: saveResponse with a stale hash, archived wedding or closed deadline writes nothing" | ✅ automated |
| NFR-10 | Understandable error messages | `invitations.test.ts` "NFR-10: transport errors map to friendly planner messages"; `phase3-attacks.test.ts` "NFR-10: sampled 400/404/409/410 bodies carry no stack, SQL/Prisma text, token or hash"; `contact.test.ts` NFR-10 cases; web `api-error.interceptor.spec.ts`, field errors in form specs | ✅ automated |
| NFR-13 | Saved data survives restart | Same as AC-14 | 🟡 manual |
| NFR-14 | Payment and balance calculations consistent | `budget.test.ts` "NFR-14: parallel payments cannot overpay an expense"; `dashboard-attacks.test.ts` "NFR-14: concurrent payments never produce a dashboard where committed - paid != outstanding" | ✅ automated |
| NFR-15 | Failed deliveries recorded, not dropped | `jobs.test.ts` "NFR-15/16: a claim (lease) keeps other runs off a row ..."; BR-11 tests (FAILED rows with attemptCount and lastError) | ✅ automated |
| NFR-16 | Scheduled jobs tolerate repeated execution | `jobs.test.ts` "NFR-16: running the reminder job twice creates no duplicate reminders and sends each email once", "NFR-16: two concurrent reminder job runs still send exactly once", "NFR-16: two concurrent retry runs retry an invitation once"; `phase5-attacks.test.ts` "NFR-16: five concurrent reminder runs over 20 due rows send each email exactly once", "NFR-16: syncAllReminders twice plus the job twice leaves a stable row count ..."; `reminders.test.ts` "NFR-16: syncing again (startup backfill) creates no duplicates ..."; `schema-constraints.test.ts` "NFR-16: duplicate Notification ... is rejected", "NFR-16: upsert on the notification compound key run twice leaves exactly one row"; `acceptance.test.ts` AC-12/13 journey (job run twice) | ✅ automated |
| NFR-17 | Email errors never corrupt data | `invitations.test.ts` "NFR-17/BR-11: mail failure records FAILED and still returns 200"; `jobs.test.ts` "NFR-17: a mail failure never breaks the job ...", "NFR-17: a failing email does not break the retry job either"; `contact.test.ts` "NFR-17: transport failure → 503 without stack or body leak" (one further test, "message arrives in Mailpit", is skipped unless Mailpit is running) | ✅ automated |
| NFR-20 | Dashboard within 2 s on representative data | `dashboard.test.ts` "NFR-20: dashboard stays fast with 200 guests" (last run printed: 200 guests / 100 tasks / 50 expenses / 150 payments took 77 ms) | ✅ automated |
| NFR-21 | Presentation, logic, data access separated | `acceptance.test.ts` "NFR-21: routes, middleware, services and jobs never touch Prisma directly (only repositories do)" (static scan) | ✅ automated |
| NFR-23 | Automated tests for critical rules and access control | This suite (see totals) | ✅ automated |
| NFR-25 | Installation and configuration instructions | README.md (prerequisites, env vars, docker compose, migrate, seed, start, Mailpit, demo accounts); verified by AC-15 procedure | 🟡 manual |

## 4. Manual demo script (about 15 minutes)

Preparation (before the audience arrives): `docker compose up -d`, `cd server && npm run db:reset`
(re-creates the demo data and prints the two demo RSVP links, copy them), `cd server && npm run dev`,
`cd web && npm start`. Open http://localhost:4200 and http://localhost:8025 (Mailpit) in two tabs.
Password for every demo account: `Password123!`. Run exactly one API instance.

Accounts: `owner@demo.test` (Olivia, planner), `member@demo.test` (Tom, team member),
`assistant@demo.test` (Anna, team member), `former@demo.test` (Mark, revoked),
`planner2@demo.test` (Peter, other planner). RSVP links: the **open** link (pending guest of
Emma & Daniel) and the **archived** link (guest of Lili & Bence) from the seed output / README.

| Min | Step | What to do and say | Proves |
|---|---|---|---|
| 0-1 | Register and log in | Open `/register`, create a new account `demo-<anything>@demo.test`, then log out and log in again. Show the invalid-password error message. | AC-01, FR-01, NFR-10 |
| 1-2 | Two weddings | Still as the new user (or as Olivia, who already has three): New wedding twice with names, date, location, budget, RSVP deadline. Show both in the list, and Olivia's Archived tab (Lili & Bence). | AC-01, BR-13 |
| 2-4 | Team access | Log in as `owner@demo.test`, open Emma & Daniel, **Team**: Tom and Anna are Active, Mark is **Revoked**. Add the account you registered in step 0-1 by its email (team members must already be registered): it appears as Active. Adding it again is refused (no duplicate membership). Now **Revoke** it and confirm. In a private window, log in as that account: Emma & Daniel is no longer in its list and opening the wedding's URL shows "not found" (Mark sees the same). Point out the **Owner** role badge; Team is missing from a team member's side nav (you will see that as Tom next). | AC-02, BR-02, BR-14, NFR-11 |
| 4-6 | Member task rules | Private window, log in as `member@demo.test`, Emma & Daniel, Tasks, filter "My tasks". Open Update progress on an assigned task: only Status and Progress notes are editable; save. Show that tasks assigned to others have no edit button. Direct-API attacker case (optional, in the browser console or a REST client with Tom's cookie): `PATCH /api/weddings/<id>/tasks/<other task id>` with `{"status":"COMPLETED"}` answers 403, and `{"priority":"LOW"}` on his own task answers 403. | AC-03, AC-04, BR-03 |
| 6-8 | Guests and invitation | As Olivia, Guests: add a guest with your own email, click Send invitation, show the Sent chip and the email in Mailpit. Click Resend, show that the first link now fails (open it) and the second works (one invitation). Show a FAILED guest in the demo data and the Resend action. | AC-05, BR-05, BR-11, FR-29 |
| 8-10 | RSVP and dashboard | Note the Overview numbers for Emma & Daniel (guests pending). Open the **open demo RSVP link** in a private window (no planner navigation): choose Accepted, add a dietary note, submit. Reload Olivia's Overview: accepted +1, pending -1. Then show the failures: edit the link text (invalid, not found), revoke a guest's link in Guests and open it (no longer valid), open the **archived demo link** (no longer valid). | AC-06, AC-07, BR-06, FR-30 |
| 10-11 | Budget | Budget: open an expense with a deposit and instalments, add a payment, show total paid and outstanding change, edit and delete a payment and show the balance recalculates. Try amount `0` and `-5`: rejected with a message. Show the overdue expense flag and the summary card (committed, paid, outstanding, remaining). | AC-08, BR-07, BR-08, NFR-14 |
| 11-12 | Checklist template | Tasks, Apply checklist template (e.g. "Short engagement"), show the copied tasks, rename one copy, reopen the template picker and show the template is unchanged. | AC-09, FR-37, FR-38 |
| 12-13 | Schedule | Schedule: the full-day timeline in chronological order. Add an item overlapping an existing one: it saves, a warning shows and both rows are highlighted. | AC-10, BR-12, FR-55, FR-56 |
| 13-14 | Dashboard and reports | Overview: guests, RSVP, tasks done / unfinished, budget, committed, paid, outstanding. Reports: guest responses with dietary list, budget by category. Log in as Tom: same pages, no edit buttons. | AC-11, FR-57, FR-58, FR-60 |
| 14-15 | Reminders | As Olivia create a task in Emma & Daniel due in 2 days, assigned to Tom (it is inside the 3-day window, so the reminder is due immediately). Within about a minute Tom's bell shows the notification and Mailpit shows the reminder email. Then complete the task as Tom (or move its deadline) and show that no pending reminder remains (Tom's bell does not receive another). | AC-12, AC-13, BR-09, BR-10 |
| end | Isolation | Log in as `planner2@demo.test`: only Judit & Andras is listed; Olivia's wedding URL answers "not found". | BR-14, FR-11 |

AC-14 and AC-15 are demonstrated with the procedures in section 5.

## 5. Manual procedures

### AC-14 Data survives restart (status ✅ verified 2026-11-26)

1. Note something recognisable, for example a payment you added or the RSVP answer from the demo.
2. Stop the API (Ctrl+C) and the web server.
3. `docker compose down` (**without `-v`**, the named volume `pgdata` must stay).
4. `docker compose up -d`, wait until Postgres is healthy.
5. `cd server && npm run dev`, `cd web && npm start`.
6. Log in as `owner@demo.test` and confirm the weddings, guests (RSVP answers), tasks, expenses and payments
   from step 1 are still there, and the sent notifications in the bell are unchanged.

Expected: nothing is lost; the seed is not needed again. (Running `docker compose down -v` or `npm run db:reset`
deletes the data on purpose.)

### AC-15 Install from the docs (status ✅ verified 2026-11-26)

1. On a clean machine (or a fresh directory): `git clone <repo>` and follow README.md exactly, in order:
   prerequisites (Node 22, Docker Desktop, Git), `docker compose up -d`, copy `server/.env.example` to `server/.env`,
   `npm install` in `server/` and `web/`, `npx prisma migrate deploy` (or `migrate dev`), `npm run db:seed`,
   start API and web.
2. Open http://localhost:4200, log in as `owner@demo.test` / `Password123!`.
3. Send an invitation and confirm it appears in Mailpit (http://localhost:8025).
4. Run `cd server && npm test` and `cd web && npx ng test --watch=false`: both green.
5. Walk through section 4.

Expected: no step requires anything that is not in the README. Record any deviation as a README bug.

## 6. Totals

Last full run: 2026-11-26.

| Suite | Files | Tests | Result |
|---|---|---|---|
| Server (Vitest + Supertest, `cd server && npm test`) | 29 | 460 | 459 passed, 1 skipped (`contact.test.ts` "NFR-17: message arrives in Mailpit", needs a running Mailpit), 0 failed |
| Web (Angular runner, `cd web && npx ng test --watch=false`) | 32 | 157 | 157 passed, 0 failed |

Server figures: the 28 pre-existing files ran 452 passed + 1 skipped; the new `acceptance.test.ts` adds 7 tests (all passed
in a separate run on the same database, because the suites share one test DB and must not run concurrently).

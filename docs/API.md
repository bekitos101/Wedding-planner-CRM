# REST API contract (v1)

Base path `/api`. JSON in and out. Dates ISO 8601. Money as strings with 2 decimals ("1250.00").
Auth: JWT in an httpOnly cookie `token` (web) or `Authorization: Bearer` (tests).

**Roles column:** `O` owner, `M` active team member (read), `A` assigned member, `P` public.

## Errors
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "End time must be after start time.",
             "fields": { "endTime": "Must be after start time" } } }
```
| HTTP | code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | zod failure or malformed JSON; `fields` filled for zod |
| 400 | BAD_REQUEST | other client errors from the HTTP layer |
| 401 | UNAUTHENTICATED | no/invalid JWT |
| 403 | FORBIDDEN | member of the wedding but lacks permission (incl. disallowed task fields); wrong `currentPassword` on PATCH /me |
| 404 | NOT_FOUND | missing, or wedding not accessible to this user (BR-14) |
| 409 | CONFLICT | duplicate membership, email already registered |
| 410 | RSVP_CLOSED | RSVP deadline passed or invitation revoked |
| 413 | PAYLOAD_TOO_LARGE | request body over 100 kB |
| 429 | TOO_MANY_REQUESTS | rate limit hit (contact form) |
| 503 | SERVICE_UNAVAILABLE | a dependency (e.g. email) is down and the request couldn't be completed |
| 500 | INTERNAL_ERROR | unexpected error; generic message, details only in server logs |

## Health
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /health | P | `{status: "ok"\|"down", db: "ok"\|"down"}`; 200 if DB reachable, else 503 |

## Contact (public)
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | /contact | P | {name, email, subject?, message, contact_hp?} → **202** `{ message: "Thanks! We'll get back to you soon." }` |

Rules:
- `name` 1–100, `email` valid (≤ 254), `subject` optional ≤ 150, `message` 10–5000 chars; all trimmed.
  Line breaks are stripped from `name` and `subject` (no header injection).
- `contact_hp` is a hidden honeypot field (deliberately an unusual name so browsers and password
  managers don't autofill it): if it is non-empty the request gets the same 202 but nothing is sent.
- Sends a plain-text email to `CONTACT_TO` (env, default `hello@wedding-organizer.local`) with
  `Reply-To` set to the sender. Nothing is stored in the database.
- Email failure → **503** `SERVICE_UNAVAILABLE` "We couldn't send your message right now. Please
  try again later." (logged without the message body).
- Rate limit: 5 requests per IP per 15 minutes → **429** `TOO_MANY_REQUESTS`
  "Too many messages. Please try again later." (in memory; resets on restart). The client IP
  comes from the socket unless `TRUST_PROXY` (env, number of proxy hops, default `0`) is set —
  set it to `1` when the API runs behind one reverse proxy, so each visitor gets their own limit.

## Auth and profile
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | /auth/register | P | {name, email, password} → **201** `User`, sets cookie (logged in) · 409 if email taken |
| POST | /auth/login | P | {email, password} → 200 `User`, sets cookie · 401 on bad credentials |
| POST | /auth/logout | any | → 204, clears cookie (works even when not logged in) |
| GET | /me | auth | → 200 `User` |
| PATCH | /me | auth | {name?, email?, password?, currentPassword?} → 200 `User` |

**`User`** = `{ id, name, email, createdAt }` — never includes `passwordHash`.

Rules:
- `name` 1–100 chars, trimmed. `email` valid, trimmed, stored lowercase (login is case-insensitive).
  `password` 8–72 chars (bcrypt limit), cost 12.
- Bad login → 401 `UNAUTHENTICATED`, message "Email or password is incorrect." — the same for
  an unknown email and a wrong password (don't reveal which accounts exist).
- `PATCH /me`: changing `email` or `password` requires `currentPassword` (missing → 400 with
  `fields.currentPassword`; wrong → 403 `FORBIDDEN` "Current password is incorrect." with
  `fields.currentPassword`). `name` alone doesn't. New email already used → 409. At least one of
  name/email/password required.
- Changing the password ends all other sessions: tokens issued before `User.passwordChangedAt`
  are rejected (401). The `PATCH /me` response re-issues the cookie so the current session stays.
- JWT: HS256, payload `{ sub: userId }`, expires in 7 days. Cookie `token`: httpOnly,
  `SameSite=Lax`, `Secure` in production, path `/`, max-age 7 days. `Authorization: Bearer`
  accepted too. Missing/invalid/expired token or deleted user → 401 `UNAUTHENTICATED`.
- Logout is stateless (clears the cookie); no server-side token blacklist in v1.

## Weddings and collaborators
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings?status=active\|archived | auth | → 200 `Wedding[]`: owned + active-member-of, default `active`, sorted by `weddingDate` asc |
| POST | /weddings | auth | {coupleNames, weddingDate, location, totalBudget, rsvpDeadline} → **201** `Wedding` (caller = owner) |
| GET | /weddings/:weddingId | O,M | → 200 `Wedding` |
| PATCH | /weddings/:weddingId | O | any subset of the POST fields → 200 `Wedding` |
| POST | /weddings/:weddingId/archive | O | → 200 `Wedding` (idempotent: archiving twice is fine) |
| GET | /weddings/:weddingId/members | O | → 200 `Member[]` (active and revoked; active first, then by name) |
| POST | /weddings/:weddingId/members | O | {email} of a registered user → **201** `Member` (or **200** when re-activating a revoked member) |
| DELETE | /weddings/:weddingId/members/:userId | O | → 204; sets status REVOKED, data kept |

**`Wedding`** = `{ id, coupleNames, weddingDate, location, totalBudget, rsvpDeadline, status,
archivedAt, createdAt, owner: { id, name }, role, progress }`
- `status`: `"ACTIVE" | "ARCHIVED"`. `role`: the **caller's** role, `"OWNER" | "TEAM_MEMBER"`.
- `totalBudget`: money string, e.g. `"25000.00"`.
- `weddingDate`, `rsvpDeadline`: **calendar dates** `"YYYY-MM-DD"` (no time, no timezone).
- `progress`: `{ completed, total, percent }` — computed from the wedding's tasks
  (`percent` = **floor**(completed / total × 100), so 100 means everything is done; `0` when
  there are no tasks). Never stored (FR-59).

**`Member`** = `{ userId, name, email, role: "TEAM_MEMBER", status: "ACTIVE" | "REVOKED",
addedAt, revokedAt }`

Rules:
- **Access (BR-14, FR-11):** every `/weddings/:weddingId/...` route first checks the caller is the
  owner or an ACTIVE member. Otherwise → **404** `NOT_FOUND` "Wedding not found." — the same for a
  non-existent id, a malformed id, another planner's wedding, and a revoked member.
  An active team member calling an owner-only route → **403** `FORBIDDEN`.
- **Validation:** `coupleNames` 1–200 chars; `location` 1–200 chars; `weddingDate` and
  `rsvpDeadline` must be `YYYY-MM-DD` calendar dates between 2000-01-01 and 2100-12-31 (anything
  with a time part → 400); `rsvpDeadline` must be on or before `weddingDate`
  (`fields.rsvpDeadline`); `totalBudget` ≥ 0, max 2 decimals, accepted as string or number. On
  PATCH the date rule is checked against the merged (existing + new) values. Unknown fields are
  ignored; `status`, `ownerId`, `id` can't be changed via PATCH.
- **Archived weddings (BR-13):** excluded from the default list (`?status=archived` shows them).
  They are **read-only**: any write to an archived wedding or its records (PATCH, adding members,
  and every later feature's create/update/delete) → **409** `CONFLICT`
  "This wedding is archived and can't be changed." There is no un-archive in v1.
  **Exception:** the owner can still **revoke** a team member (`DELETE .../members/:userId`) on an
  archived wedding — removing access is a security action, not a planning edit.
- **RSVP deadline (used from phase 3A):** RSVPs are accepted through the **whole deadline day**;
  an invitation is expired once the current UTC date is after `rsvpDeadline`.
- **Adding a member:** email matched case-insensitively.
  Unknown email → 400 `fields.email` "No registered planner with this email."
  The owner's own email → 400 `fields.email` "You already own this wedding."
  Already an ACTIVE member → 409. A REVOKED member is re-activated (same row, BR-02).
- **Revoking (FR-13):** sets `status = REVOKED`, `revokedAt = now`; the user immediately loses access
  (404). Their tasks in this wedding become unassigned and their PENDING notifications for those
  tasks are CANCELLED. Nothing is deleted. Revoking an unknown or already-revoked user → 404.

## Phase 3 — common rules (all four tracks)
- All routes below live under `/weddings/:weddingId`, so the access rules from "Weddings and
  collaborators" apply unchanged: 401 → 404 (non-member) → 403 (team member on an owner route) →
  409 (write on an archived wedding). Reads (`GET`) are open to the owner and active team members.
- Child records are always looked up by **their id AND the weddingId**. A child id that doesn't
  exist in *this* wedding (including one from another wedding) → 404 `NOT_FOUND` "<Thing> not found."
  Malformed child ids → 404 as well.
- Dates are calendar dates `"YYYY-MM-DD"` (2000-01-01..2100-12-31), except schedule times (below).
  "Today" means the current **UTC** date. Money is a string with 2 decimals (`"1250.00"`), accepted
  as string or number, ≥ 0 unless stated, max 10 integer digits, max 2 decimals.
- Text fields are trimmed; empty optional strings are stored as `null`. Unknown body fields are
  ignored. Validation errors → 400 with `fields`.
- Create → **201** with the created object; update → 200 with the updated object; delete → **204**.
- Nothing derived is stored: `isOverdue`, `totalPaid`, `outstanding`, summaries, overlaps are
  computed on every read (FR-59).

## Guests, invitations, RSVP (track 3A)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/guests?search=&rsvpStatus= | O,M | → `{ guests: Guest[], summary }` |
| POST | /weddings/:weddingId/guests | O | {name, email, dietaryRequirements?} → 201 `Guest` |
| PATCH | /weddings/:weddingId/guests/:guestId | O | any of {name, email, dietaryRequirements, rsvpStatus} → `Guest` |
| DELETE | /weddings/:weddingId/guests/:guestId | O | → 204 (its invitation is deleted too, so the link stops working) |
| POST | /weddings/:weddingId/guests/:guestId/invitation/send | O | → 200 `Guest` (create or rotate the link, then email it) |
| POST | /weddings/:weddingId/guests/:guestId/invitation/revoke | O | → 200 `Guest` |
| GET | /rsvp/:token | P | → `RsvpView` |
| POST | /rsvp/:token | P | {rsvpStatus: "ACCEPTED"\|"DECLINED", dietaryRequirements?} → `RsvpView` |

**`Guest`** = `{ id, name, email, rsvpStatus, dietaryRequirements, respondedAt, createdAt, invitation }`
- `rsvpStatus`: `"PENDING" | "ACCEPTED" | "DECLINED"` (FR-21).
- `invitation`: `null` (never sent) or `{ status, deliveryStatus, attemptCount, lastSentAt, lastError, revokedAt }`
  where `status` is `"SENT" | "FAILED" | "PENDING" | "REVOKED"` (`REVOKED` wins over the delivery
  status) and `lastError` is a short human-readable reason (never a stack trace). **The token and its
  hash are never returned** by any planner endpoint.
- `summary` = `{ total, pending, accepted, declined }` for the **whole** wedding (ignores filters).
- List: `search` matches name or email (case-insensitive, substring); `rsvpStatus` filters exactly.
  Sorted by name.

Rules:
- `name` 1–150, `email` valid ≤ 254 (stored lowercase), `dietaryRequirements` ≤ 500. Several
  guests may share an email (couples); each guest is an individual record (BR-04, no plus-ones).
- The owner may set `rsvpStatus` manually via PATCH (e.g. a guest answered by phone); this sets
  `respondedAt` (or clears it when set back to PENDING).
- **Send / resend (FR-22, BR-05, NFR-03):** generate a new token (32 random bytes, base64url), store
  only its SHA-256 hash, keep ONE invitation row per guest (upsert by `guestId`), clear `revokedAt`,
  set `attemptCount` to 1 for this send, email the link `APP_BASE_URL/rsvp/<token>` through
  `lib/mailer.ts`, then record `deliveryStatus` `SENT` or `FAILED` (+ `lastError`, `lastSentAt`).
  Resending invalidates the previous link. An email failure still returns **200** with the guest
  (status `FAILED`) — it never fails the request (NFR-17). Sending after the RSVP deadline → 409
  `CONFLICT` "The RSVP deadline for this wedding has passed."
- Email: subject `You're invited: <coupleNames>`; plain text + simple HTML with the couple, date,
  location, RSVP deadline and the link. All names are HTML-escaped. The link/token is never logged
  and never in the subject.
- **Revoke:** sets `revokedAt`; the link stops working immediately. Revoking a guest without an
  invitation → 404 "Invitation not found."

**`RsvpView`** (public, NFR-08, FR-30) = `{ guestName, coupleNames, weddingDate, location, rsvpDeadline, rsvpStatus, dietaryRequirements }`
— only that guest's data; nothing about other guests, the planner, or ids.
- Unknown / malformed token → **404** `NOT_FOUND` "This invitation link is not valid."
- Revoked → **410** `RSVP_CLOSED` "This invitation is no longer valid."
- Deadline passed (today's UTC date > `rsvpDeadline`, see `isRsvpOpen` in `lib/dates.ts`) → **410**
  `RSVP_CLOSED` "The RSVP deadline has passed." — for both GET and POST (AC-07, BR-06).
- Archived wedding → 410 `RSVP_CLOSED` "This invitation is no longer valid."
- POST may be repeated to change the answer until the deadline (FR-25); it sets `respondedAt`.
  `dietaryRequirements` omitted = unchanged; `""` clears it.

## Tasks and checklists (track 3B)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/tasks?assignee=&status=&overdue= | O,M | → `Task[]` |
| POST | /weddings/:weddingId/tasks | O | {title, description?, dueDate, priority?, status?, assigneeId?} → 201 `Task` |
| PATCH | /weddings/:weddingId/tasks/:taskId | O; A | owner: any field · assignee: only {status, progressNotes} → `Task` |
| DELETE | /weddings/:weddingId/tasks/:taskId | O | → 204 |
| GET | /checklist-templates | auth | → `Template[]` = `{ id, name, description, items: [{ id, title, description, priority, daysBeforeWedding }] }` (items by sortOrder) |
| POST | /weddings/:weddingId/checklist-templates/:templateId/apply | O | `{}` → **201** `{ created: Task[] }` |

**`Task`** = `{ id, title, description, dueDate, priority, status, progressNotes, assignee, isOverdue, completedAt, createdAt, updatedAt }`
- `priority`: `"LOW" | "MEDIUM" | "HIGH"` (default MEDIUM). `status`: `"TODO" | "IN_PROGRESS" | "COMPLETED"` (default TODO).
- `assignee`: `null` or `{ id, name }`. `isOverdue` = `dueDate` < today AND status ≠ COMPLETED (FR-35).
- `completedAt` is set when status becomes COMPLETED and cleared when it leaves COMPLETED.

Rules:
- `title` 1–200, `description` ≤ 2000, `progressNotes` ≤ 2000.
- **Assignee (UC-07):** `assigneeId` must be the wedding's owner or an ACTIVE team member of this
  wedding, else 400 `fields.assigneeId` "Assignee must be the owner or an active team member."
  Checked inside the same transaction as the write (no race with a revoke). `null` unassigns.
- **Team members (BR-03, FR-15/16, AC-03/04):** may PATCH only a task assigned to them, and the body
  may contain only `status` and/or `progressNotes`. Any other key present (even with an unchanged
  value) → **403** `FORBIDDEN` "Team members can only change the status and progress notes of tasks
  assigned to them." A task assigned to someone else → 403 with the same message. Members can't
  POST or DELETE (403).
- List filters: `assignee` = `me` | `unassigned` | a user id; `status` = one of the statuses;
  `overdue=true` → only overdue. Sorted by `dueDate`, then priority (HIGH first), then title.
- **Apply template (FR-37/38, AC-09):** copies every item into a new, independent task:
  `dueDate` = weddingDate − `daysBeforeWedding`, but never earlier than today; priority and
  description copied; unassigned; status TODO; `sourceTemplateItemId` set. The template is never
  modified. Applying the same template twice creates a second set (allowed). Unknown template → 404.
- Reminders/notifications are **not** created in this phase (phase 5).

## Budget (track 3C)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/expenses | O,M | → `Expense[]` (without payments), sorted by dueDate then description |
| POST | /weddings/:weddingId/expenses | O | {description, category, agreedAmount, dueDate, notes?} → 201 `Expense` |
| GET | /weddings/:weddingId/expenses/:expenseId | O,M | → `Expense` **with** `payments: Payment[]` (by paymentDate) |
| PATCH | /weddings/:weddingId/expenses/:expenseId | O | any of the POST fields → `Expense` |
| DELETE | /weddings/:weddingId/expenses/:expenseId | O | → 204 (its payments are deleted too) |
| POST | /weddings/:weddingId/expenses/:expenseId/payments | O | {amount, paymentDate, notes?} → 201 `Expense` with payments |
| PATCH | /weddings/:weddingId/expenses/:expenseId/payments/:paymentId | O | any of {amount, paymentDate, notes} → `Expense` with payments |
| DELETE | /weddings/:weddingId/expenses/:expenseId/payments/:paymentId | O | → 200 `Expense` with payments |
| GET | /weddings/:weddingId/budget | O,M | → `BudgetSummary` |

**`Expense`** = `{ id, description, category, agreedAmount, dueDate, notes, totalPaid, outstanding, isOverdue, paymentCount, createdAt }`
- `totalPaid` = sum of payments; `outstanding` = agreedAmount − totalPaid (BR-07);
  `isOverdue` = outstanding > 0 AND dueDate < today (FR-46). All via Prisma.Decimal.

**`Payment`** = `{ id, amount, paymentDate, notes, createdAt }`

**`BudgetSummary`** = `{ totalBudget, committed, paid, outstanding, remaining, overdueExpenses }`
- `committed` = sum of agreedAmount; `paid` = sum of payments; `outstanding` = committed − paid;
  `remaining` = totalBudget − committed (may be **negative** = over budget) (FR-45).
- `overdueExpenses` = `[{ id, description, category, outstanding, dueDate }]` sorted by dueDate.

Rules:
- `description` 1–200, `category` 1–60 (free text; the UI suggests common ones), `notes` ≤ 2000.
- Payment `amount` must be **> 0** (`fields.amount`). A payment (create or edit) that would make
  totalPaid exceed agreedAmount → 400 `fields.amount` "This payment is more than the outstanding
  balance (<outstanding>)." Lowering `agreedAmount` below totalPaid → 400 `fields.agreedAmount`
  "The agreed amount can't be less than what has already been paid (<totalPaid>)."
- Editing or deleting a payment returns the recalculated expense (BR-08, NFR-14). Payment writes
  run in a transaction with the overpayment check.

## Suppliers and schedule (track 3D)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/suppliers?search=&category= | O,M | → `Supplier[]` sorted by category, then name |
| POST | /weddings/:weddingId/suppliers | O | {name, category, contactInfo?, quotedPrice?, notes?} → 201 `Supplier` |
| PATCH | /weddings/:weddingId/suppliers/:supplierId | O | → `Supplier` |
| DELETE | /weddings/:weddingId/suppliers/:supplierId | O | → 204 |
| GET | /weddings/:weddingId/schedule | O,M | → `ScheduleItem[]` sorted by startTime, then endTime, then title |
| POST | /weddings/:weddingId/schedule | O | {title, startTime, endTime, location?, notes?} → 201 `{ item, warnings }` |
| PATCH | /weddings/:weddingId/schedule/:itemId | O | → 200 `{ item, warnings }` |
| DELETE | /weddings/:weddingId/schedule/:itemId | O | → 204 |

**`Supplier`** = `{ id, name, category, contactInfo, quotedPrice, notes, createdAt }`
- `name` 1–150, `category` 1–60, `contactInfo` ≤ 500 (free text: phone, email, website),
  `quotedPrice` money or `null` ("where known", FR-49), `notes` ≤ 2000. `search` matches name,
  category or contactInfo.

**`ScheduleItem`** = `{ id, title, startTime, endTime, location, notes, overlapsWith }`
- `startTime`/`endTime`: ISO 8601 date-times **with an offset or `Z`** (e.g. `2027-06-19T14:00:00+02:00`);
  returned as UTC ISO strings (`...Z`). The browser shows them in local time.
- `title` 1–200, `location` ≤ 200, `notes` ≤ 2000. `startTime` must be before `endTime`
  (`fields.endTime` "End time must be after start time.") (UC-11).
- `overlapsWith`: ids of other items of the same wedding that overlap. Two items overlap when
  `a.start < b.end AND b.start < a.end` (back-to-back items do **not** overlap).
- `warnings` (create/update): `[{ type: "OVERLAP", itemId, title, startTime, endTime, message }]`,
  `message` = `Overlaps with "<title>".` Overlaps are **allowed** — the item is saved anyway
  (FR-55/56, BR-12, AC-10).

## Dashboard and reports (phase 4)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/dashboard | O,M | → `Dashboard` |
| GET | /weddings/:weddingId/reports/guests | O,M | → `GuestReport` |
| GET | /weddings/:weddingId/reports/budget | O,M | → `BudgetReport` |

Read-only, available on archived weddings too. Every number is computed on request from stored
records with DB aggregates (`count`/`groupBy`/`aggregate`), read in **one consistent snapshot**
(one REPEATABLE READ transaction per request) — nothing is stored (FR-59). Team members see the
same dashboard and reports as the owner (FR-60; see the "team members can read all wedding data"
decision in CLAUDE.md). Target: < 2 s with 200 guests (NFR-20) — no per-row queries.

**`Dashboard`** (FR-57) =
```
{
  wedding:  { id, coupleNames, weddingDate, location, status, daysUntilWedding },
  guests:   { total, pending, accepted, declined, responseRate,
              invitations: { notSent, sent, failed, revoked } },
  tasks:    { total, todo, inProgress, completed, unfinished, overdue, dueNext7Days,
              percentComplete, myOpenTasks },
  budget:   { totalBudget, committed, paid, outstanding, remaining, overdueExpenseCount },
  suppliers: { total },
  schedule: { items, overlappingItems },
  upcomingTasks: Task[]   // up to 5 unfinished tasks, soonest dueDate first (same Task shape as track 3B)
}
```
- `daysUntilWedding` = weddingDate − today (UTC), in days; negative once the date has passed.
- `responseRate` = floor((accepted + declined) / total × 100); 0 when there are no guests.
- Invitation counts per guest: `revoked` = invitation with `revokedAt` set; otherwise by
  `deliveryStatus`: `sent` = SENT, `failed` = FAILED, and `notSent` = no invitation row **or**
  deliveryStatus PENDING (not delivered yet). `notSent + sent + failed + revoked = guests.total`.
- `unfinished` = todo + inProgress. `overdue` and `percentComplete` use the same rules as track 3B
  and the wedding list (`isOverdue`; floor). `dueNext7Days` = unfinished tasks with
  today ≤ dueDate ≤ today + 7. `myOpenTasks` = unfinished tasks assigned to the **caller**.
- `budget` is exactly the track 3C `BudgetSummary` (money strings), with `overdueExpenseCount`
  instead of the list.
- `schedule.overlappingItems` = number of items whose `overlapsWith` is non-empty.

**`GuestReport`** (FR-58) =
```
{
  summary: { total, pending, accepted, declined, responseRate },
  dietary: [{ name, rsvpStatus, dietaryRequirements }],      // guests with a non-empty note, by name
  guests:  [{ name, email, rsvpStatus, respondedAt, dietaryRequirements, invitationStatus }]
}
```
- `guests` = every guest sorted by name (for printing / CSV export); `invitationStatus` =
  `"NOT_SENT" | "SENT" | "FAILED" | "REVOKED"` (same rule as above). No ids, no tokens.

**`BudgetReport`** (FR-58) =
```
{
  totals: { totalBudget, committed, paid, outstanding, remaining },
  byCategory: [{ category, expenseCount, committed, paid, outstanding, shareOfCommitted }]
}
```
- Categories are grouped case-insensitively after trimming ("Venue" and "venue " are one group);
  the label shown is the most common spelling (ties: alphabetical). Sorted by `committed` desc,
  then category.
- `shareOfCommitted` = floor(category committed / total committed × 100); 0 when nothing is
  committed. Money fields are 2-decimal strings computed with Decimal.

## Notifications (phase 5)
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /notifications?unread=true | auth | caller's IN_APP notifications |
| POST | /notifications/:id/read | auth | own only |

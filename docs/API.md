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
| 500 | INTERNAL_ERROR | unexpected error; generic message, details only in server logs |

## Health
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /health | P | `{status: "ok"\|"down", db: "ok"\|"down"}`; 200 if DB reachable, else 503 |

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
| GET | /weddings?status=active\|archived | auth | owned + member-of; each item has `role`, `progress` |
| POST | /weddings | auth | {coupleNames, weddingDate, location, totalBudget, rsvpDeadline} |
| GET | /weddings/:weddingId | O,M | includes `role` of caller |
| PATCH | /weddings/:weddingId | O | |
| POST | /weddings/:weddingId/archive | O | |
| GET | /weddings/:weddingId/members | O | |
| POST | /weddings/:weddingId/members | O | {email} of a registered user |
| DELETE | /weddings/:weddingId/members/:userId | O | sets status REVOKED |

## Guests, invitations, RSVP
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/guests?search=&rsvpStatus= | O,M | each includes `invitation` summary |
| POST | /weddings/:weddingId/guests | O | {name, email, dietaryRequirements?} |
| PATCH | /weddings/:weddingId/guests/:guestId | O | |
| DELETE | /weddings/:weddingId/guests/:guestId | O | |
| POST | /weddings/:weddingId/guests/:guestId/invitation/send | O | create or rotate token, send |
| POST | /weddings/:weddingId/guests/:guestId/invitation/revoke | O | |
| GET | /rsvp/:token | P | {guestName, coupleNames, weddingDate, rsvpDeadline, rsvpStatus} only |
| POST | /rsvp/:token | P | {rsvpStatus: ACCEPTED\|DECLINED, dietaryRequirements?} |

## Tasks and checklists
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/tasks?assignee=me&status=&overdue= | O,M | each has computed `isOverdue` |
| POST | /weddings/:weddingId/tasks | O | {title, description?, dueDate, priority, status?, assigneeId?} |
| PATCH | /weddings/:weddingId/tasks/:taskId | O; A | owner: any field. assignee: only {status, progressNotes}, else 403 |
| DELETE | /weddings/:weddingId/tasks/:taskId | O | |
| GET | /checklist-templates | auth | with items |
| POST | /weddings/:weddingId/checklist-templates/:templateId/apply | O | {startDate?} → created tasks |

## Budget
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/expenses | O,M | each: totalPaid, outstanding, isOverdue |
| POST | /weddings/:weddingId/expenses | O | {description, category, agreedAmount, dueDate, notes?} |
| PATCH/DELETE | /weddings/:weddingId/expenses/:expenseId | O | |
| POST | /weddings/:weddingId/expenses/:expenseId/payments | O | {amount > 0, paymentDate, notes?} |
| PATCH/DELETE | /weddings/:weddingId/expenses/:expenseId/payments/:paymentId | O | |
| GET | /weddings/:weddingId/budget | O,M | {totalBudget, committed, paid, outstanding, remaining, overdueExpenses} |

## Suppliers and schedule
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST | /weddings/:weddingId/suppliers | O,M / O | |
| PATCH/DELETE | /weddings/:weddingId/suppliers/:supplierId | O | |
| GET | /weddings/:weddingId/schedule | O,M | sorted by startTime; each has `overlapsWith` |
| POST | /weddings/:weddingId/schedule | O | returns {item, warnings[]} |
| PATCH/DELETE | /weddings/:weddingId/schedule/:itemId | O | PATCH returns {item, warnings[]} |

## Dashboard, reports, notifications
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /weddings/:weddingId/dashboard | O,M | FR-57 fields, all computed |
| GET | /weddings/:weddingId/reports/guests | O,M | counts by status, dietary list |
| GET | /weddings/:weddingId/reports/budget | O,M | by category |
| GET | /notifications?unread=true | auth | caller's IN_APP notifications |
| POST | /notifications/:id/read | auth | own only |

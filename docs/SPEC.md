# Wedding Organizer — Requirement Specification (Markdown copy)

Source: "Wedding Organizer – Requirement Specification and Preliminary System Design",
Software Architectures (BMEVIAUMA21), 2026/2027. Team: Zhang Jinjing, Hussein Mnati Madhi,
Balkis Karoui, Hadir Helali. The PDF is the authoritative version; diagrams are not reproduced.

## 1. Introduction
Web app helping professional wedding planners manage multiple weddings centrally: create wedding
projects, collaborate with authorized team members, manage guests and invitations, track tasks and
deadlines, monitor budgets and payments, keep supplier info, and prepare the wedding-day schedule.
Each wedding has its own guests, tasks, expenses, suppliers and schedule items. The owner manages
everything and controls team access; team members view permitted info and may modify only status
and progress notes of tasks assigned to them. Guests RSVP via an email link without an account.
V1 excludes payment processing and supplier booking.

## 2. Functional Requirements

### 2.1 User Account
- FR-01 Planners can register, log in, log out.
- FR-02 Planners can view and edit their profile.
- FR-03 Passwords stored securely, never plaintext.
- FR-04 Only authenticated users access the planning interface.

### 2.2 Wedding Information
- FR-06 A planner can create and manage multiple wedding projects.
- FR-07 A wedding has couple's names, wedding date, location, estimated budget, project status.
- FR-08 The owner can edit wedding info and archive a wedding.
- FR-09 Each wedding has exactly one owner.
- FR-10 Show the owner's active weddings and their planning progress.
- FR-11 Wedding-specific records accessible only to users authorized for that wedding.

### 2.3 Team Collaboration and Permissions
- FR-12 Owner can invite authorized team members to a wedding.
- FR-13 Owner can remove a team member's access.
- FR-14 A team member can view permitted info for weddings they belong to.
- FR-15 A team member can change status and progress notes of tasks assigned to them.
- FR-16 Only the owner creates/assigns tasks and changes task deadlines or priorities.
- FR-17 Only the owner manages collaborators and modifies protected wedding settings.
- FR-18 Unauthorized operations are rejected even via direct API requests.

### 2.4 Guest Management and Invitations
- FR-19 Authorized planners can add, edit, delete, search guests.
- FR-20 Guest: name, email, RSVP status, optional dietary requirements.
- FR-21 RSVP status: Pending, Accepted, Declined.
- FR-22 Authorized planner can send and resend invitation emails.
- FR-23 Each guest has an individual record and an invitation tied to the wedding.
- FR-24 Invitation emails contain a secure link to the guest's RSVP page.
- FR-25 Guests can submit/update RSVP via a valid link until the wedding's RSVP deadline.
- FR-26 Reject RSVPs via invalid, revoked, or expired links.
- FR-27 Show the current RSVP state to a guest using a valid link.
- FR-28 Update guest statistics when an RSVP changes.
- FR-29 Record invitation delivery status; failed invitations identifiable for retry.
- FR-30 A guest link never exposes the planner interface or the full guest list.

### 2.5 Task Management and Checklist
- FR-31 Owner can create, edit, assign, delete tasks.
- FR-32 Task: title, optional description, deadline, priority, status, optional assignee.
- FR-33 Task status: To Do, In Progress, Completed.
- FR-34 Team members can update status and progress notes of tasks assigned to them.
- FR-35 Identify overdue tasks (deadline passed and not completed).
- FR-36 Provide built-in wedding-planning checklist templates.
- FR-37 Owner can copy a template into a wedding as independent tasks.
- FR-38 Changes to template-created tasks do not modify the template.

### 2.6 Budget and Payment Management
- FR-39 Owner can set/edit a wedding's estimated budget.
- FR-40 Owner can create, edit, delete expenses.
- FR-41 Expense: description, category, agreed amount, due date, notes.
- FR-42 An expense supports multiple manual payments (deposits, instalments).
- FR-43 Payment: amount, payment date, optional notes.
- FR-44 Calculate total paid and outstanding balance per expense.
- FR-45 Calculate total committed expenses and remaining wedding budget.
- FR-46 Identify expenses with outstanding balances past their due dates.
- FR-47 No real payments or banking connections in v1.

### 2.7 Supplier Management
- FR-48 Owner can create, edit, delete, view suppliers.
- FR-49 Supplier: name, service category, contact info, quoted price where known, optional notes.
- FR-50 Suppliers belong to a wedding project in v1.
- FR-51 No supplier booking or contract negotiation.

### 2.8 Wedding Schedule
- FR-52 Owner can create, edit, delete wedding-day schedule items.
- FR-53 Schedule item: title, start time, end time, optional location and notes.
- FR-54 Display schedule items chronologically.
- FR-55 Warn the owner about overlapping items.
- FR-56 Intentional overlaps are allowed.

### 2.9 Dashboard and Reports
- FR-57 Dashboard: wedding date, guest counts, RSVP stats, completed tasks, unfinished tasks,
  total budget, committed expenses, amount paid, outstanding balances.
- FR-58 Basic reports summarizing guest responses and budget status.
- FR-59 Dashboard values calculated from stored data, not separately maintained totals.
- FR-60 Team members see dashboard info permitted by their access rules.

### 2.10 Notifications
- FR-61 Create in-app notifications for configured upcoming task-deadline events.
- FR-62 Cancel/update pending reminders when a task is completed, rescheduled, or archived.
- FR-63 No overdue-task reminders in v1.
- FR-64 Email delivery failures recorded and handled by a defined retry policy.

## 3. Non-Functional Requirements

### 3.1 Security
- NFR-01 Passwords hashed with an established algorithm.
- NFR-02 Backend validates identity, wedding membership, and permission for every protected op.
- NFR-03 Unpredictable invitation tokens; support revocation; enforce RSVP deadline.
- NFR-04 All input validated on the server.
- NFR-05 Parameterized queries / ORM (no SQL injection).
- NFR-06 Passwords, invitation tokens, secrets never written to logs.
- NFR-07 Production uses HTTPS.
- NFR-08 Guest RSVP access restricted to the guest and invitation tied to the token.

### 3.2 Usability
- NFR-09 Clear navigation between weddings and their planning functions.
- NFR-10 Validation errors and failures explained in understandable language.
- NFR-11 UI distinguishes owner functions from team-member functions.
- NFR-12 Tasks, RSVP states, financial summaries presented consistently across views.

### 3.3 Reliability
- NFR-13 Saved data survives application restart.
- NFR-14 Payments and balance calculations updated consistently.
- NFR-15 Failed invitation/reminder deliveries recorded, not silently dropped.
- NFR-16 Scheduled jobs tolerate repeated execution without duplicate reminders.
- NFR-17 Email service errors never corrupt wedding, guest, or task data.

### 3.4 Performance
- NFR-20 Main dashboard loads within 2 s on a documented test config and representative dataset
  (proposed target).

### 3.5 Maintainability
- NFR-21 Separate presentation, business logic, data access.
- NFR-22 Authorization, payment calculations, RSVP validation, reminder scheduling in the backend.
- NFR-23 Automated tests for critical business rules and access-control scenarios.
- NFR-24 Source in a shared Git repository.
- NFR-25 Installation and configuration instructions provided.

## 4. User Roles
| Role | Permissions |
|---|---|
| Planner / Owner | Creates and manages weddings; manages collaborators, guests, invitations, tasks, finances, suppliers, schedule, checklist, settings. |
| Team Member | Views permitted wedding info; changes only status and progress notes of tasks assigned to them. |
| Guest | With a valid invitation link: views own RSVP state, submits/updates response before the RSVP deadline. |

### 4.1 Authorization Rules
1. Every wedding has exactly one owner.
2. Each team membership links a user to a wedding.
3. The owner has full planning permissions for their wedding.
4. Team members have read access to permitted info but cannot change protected records.
5. Team members can change status and progress notes of their assigned tasks only.
6. Removing a team member revokes access without deleting the wedding or records.
7. Guests do not need planner accounts.
8. Guest access is limited to RSVP operations authorized by a valid invitation token.

## 5. Use Cases (summary)
Actors: Planner/Owner, Team Member, Guest, Email Service (external).

- UC-01 Register/Login/Logout — enter credentials → validate → create account or verify → access.
- UC-02 Create and Manage Wedding — enter couple names, date, location, budget → validate → create
  with owner → appears in project list.
- UC-03 Manage Collaborators — owner selects a registered user → membership/invitation record →
  access active when membership active → owner can revoke.
- UC-04/05 Manage Guests and Send Invitations — create/select guest → verify email → request
  invitation → create/update invitation + secure token → email service attempts delivery →
  record result → planner can retry failures.
- UC-06 Submit/Update RSVP — guest opens link → validate token, load guest → show permitted info and
  current response → choose Accepted/Declined → validate and store → update statistics.
  Precondition: valid link and RSVP deadline not passed.
- UC-07 Create and Assign Tasks — create with title, description, deadline, priority, status →
  optionally assign → validate incl. assignee membership → save → appears in task lists.
- UC-08 Update Assigned Task — team member opens assigned tasks → updates status/progress notes →
  backend verifies membership, assignment, permitted fields → save.
- UC-09 Manage Budget and Payments — create/select expense → agreed amount, category, due date →
  record payments (amount, date) → validate → compute total paid and outstanding → dashboard.
- UC-10 Manage Suppliers — CRUD within the wedding, required-field validation.
- UC-11 Manage Wedding Schedule — items with start/end → validate times → sort → warn on overlap.
- UC-12 Apply Checklist Template — copy built-in template tasks into a wedding; independent copies.
- UC-13 View Dashboard and Reports — compute guest, task, financial summaries per access rules.
- UC-14/15 Notifications and Scheduled Reminders — notifications for upcoming deadlines; scheduler
  finds eligible reminders, email worker sends, results recorded, no duplicates.

## 6. System Architecture
Three layers: Presentation, Business Logic, Data Access. Frontend ↔ backend via REST; backend ↔
relational DB via the Data Access Layer.
- Presentation: UI for planners, team members, guests; dashboards; forms for guests, tasks,
  expenses, suppliers, schedule; notifications and reports; restricted guest RSVP UI; validation
  messages. Authorization still enforced by the backend.
- Business Logic: authn/authz; wedding and collaborator management; guests and invitations; RSVP
  token validation; task assignment and permitted updates; checklist copying; expense/payment
  validation; suppliers and schedule; dashboard calculations; notifications and scheduled email.
  Validates requests before business ops; never relies on the frontend for security or financial rules.
- Data Access: persistence for users, memberships, weddings, guests, invitations, tasks, checklist
  templates, expenses, payments, suppliers, schedule items, notifications. FK constraints and
  uniqueness rules in the DB. Invitation tokens stored as hashes.
- Email + scheduling: external email service; periodic scheduled job selects eligible,
  non-duplicated reminders; notification service records state and handles delivery attempts.
  V1: single backend app with a scheduler or lightweight worker. No microservices, distributed
  queues, or real-time messaging.

## 7. Domain Model (preliminary)
| Class | Main attributes | Responsibility |
|---|---|---|
| User | userId, name, email, passwordHash | Planner account |
| Wedding | weddingId, ownerId, coupleNames, weddingDate, location, totalBudget, status | Core wedding info |
| WeddingMember | weddingId, userId, role, status | Links users to weddings, controls membership |
| Guest | guestId, weddingId, name, email, rsvpStatus, dietaryRequirements | One attendee |
| Invitation | invitationId, guestId, tokenHash, responseDeadline, deliveryStatus, lastSentAt | Invitation and RSVP access |
| Task | taskId, weddingId, assigneeId, title, description, dueDate, priority, status, progressNotes | Planning task |
| ChecklistTemplate | templateId, name, description | Reusable task list |
| Expense | expenseId, weddingId, description, category, agreedAmount, dueDate | Financial commitment |
| Payment | paymentId, expenseId, amount, paymentDate, notes | Manually entered payment |
| Supplier | supplierId, weddingId, name, category, contactInfo, quotedPrice, notes | Supplier info |
| ScheduleItem | scheduleItemId, weddingId, title, startTime, endTime, location, notes | Wedding-day event |
| Notification | notificationId, userId, taskId, type, channel, scheduledAt, status, sentAt | In-app notifications and email reminders |

Relationships: a User owns many Weddings; a User belongs to many weddings via WeddingMember; a
Wedding has one owner and many team members; a Wedding contains many Guests, Tasks, Expenses,
Suppliers, ScheduleItems; a Guest has at most one Invitation; a Task has 0..1 assignee; an Expense
has many Payments; a ChecklistTemplate can be copied into many weddings as independent tasks; a User
receives many Notifications. Owner = Wedding.ownerId; WeddingMember = additional members. No
duplicate membership for the same user and wedding.

## 8. Technology
Frontend Angular + TypeScript/HTML/CSS · Backend Node.js + Express · PostgreSQL · REST over HTTP ·
Prisma ORM or Sequelize · JWT + bcrypt + Express middleware · Nodemailer via SMTP provider · cron ·
Git/GitHub · Vitest + Supertest · local dev environment, containerization if useful. Runs in a
modern browser. Install docs cover runtime, database, config variables, email settings, startup.

## 9. Scope
**Included in v1:** registration/login/logout/profile; multiple weddings per planner; owner-managed
collaborators; read-only team access; restricted editing of assigned tasks; guests, individual
invitations, guest RSVP; email invitations and retry of failures; tasks, assignment, fixed built-in
checklist templates; expenses, manual payments, deposits, balances; suppliers; schedule with
overlap warnings; dashboard and basic guest/budget reports; in-app notifications and scheduled
email reminders for upcoming deadlines; authorization, validation, persistence, automated tests.

**Excluded from v1:** online payments/banking; supplier marketplace/booking; live chat and
real-time editing; plus-ones/group invitations; SMS; native mobile apps; AI recommendations;
advanced accounting/invoicing; custom checklist templates; fine-grained permissions beyond
owner/member; overdue-task email reminders; complex calendar integrations.

## 10. Assumptions, Constraints, Acceptance Criteria

### Assumptions
Planners have valid emails and modern browsers · team members must already be registered ·
guests need no accounts · **one RSVP deadline per wedding** · owner responsible for correctness of
financial records · email depends on configured provider · fixed set of built-in templates ·
planning/tracking only, no financial transactions.

### Constraints
Achievable within the semester · at least three architectural layers · consistent DB relations ·
security and authorization in the backend · only email as external integration · install
instructions and suitable for a live demo.

### Acceptance Criteria
| ID | Criterion |
|---|---|
| AC-01 | Planner can register, log in, create at least two weddings. |
| AC-02 | Planner can add a registered team member; owner can revoke access. |
| AC-03 | Team member can update status/progress notes on an assigned task but not deadline, priority, or assignment. |
| AC-04 | Team member cannot update another member's task via UI or direct API. |
| AC-05 | Planner can add a guest, send an invitation, inspect delivery status. |
| AC-06 | Guest can RSVP via a valid link; dashboard reflects it. |
| AC-07 | Invalid, revoked, expired links rejected. |
| AC-08 | Planner can record a deposit and a later payment; outstanding balance correct. |
| AC-09 | Planner can copy a built-in checklist without modifying the template. |
| AC-10 | Schedule shown chronologically; overlaps trigger a warning. |
| AC-11 | Dashboard shows correct guest, task, financial totals from stored records. |
| AC-12 | Eligible upcoming task produces an in-app notification and a scheduled email reminder. |
| AC-13 | Completed or rescheduled task leaves no obsolete pending reminder. |
| AC-14 | Data survives application restart. |
| AC-15 | Team can install, configure, start, demo the app from the install docs. |

## Appendix A. Business Rules and Edge Cases
| ID | Rule | Expected behavior |
|---|---|---|
| BR-01 | Wedding ownership | Exactly one owner. |
| BR-02 | Membership uniqueness | No duplicate membership for the same user and wedding. |
| BR-03 | Task permissions | Team member edits only status and progress notes on assigned tasks. |
| BR-04 | Guest uniqueness | Individual records; no plus-ones/groups in v1. |
| BR-05 | Invitation retries | Resend creates no duplicate guest or second active invitation. |
| BR-06 | RSVP access | Invalid, revoked, expired tokens rejected. |
| BR-07 | Payments | Outstanding = agreed amount − sum of payments. |
| BR-08 | Payment consistency | Editing/deleting a payment recalculates balances. |
| BR-09 | Task reminders | Completed tasks generate no new upcoming reminders. |
| BR-10 | Rescheduled tasks | Pending reminders updated or cancelled on reschedule. |
| BR-11 | Email failure | Failures recorded and retried per policy. |
| BR-12 | Timeline overlap | Overlaps warn but are permitted. |
| BR-13 | Archived weddings | Excluded from default active list; no new reminders. |
| BR-14 | Data isolation | Unauthorized requests for wedding data rejected by the backend. |

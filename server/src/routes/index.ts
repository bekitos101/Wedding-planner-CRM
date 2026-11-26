import { Router } from 'express';
import { authRouter } from './auth.js';
import { budgetRouter } from './budget.js';
import { dashboardRouter } from './dashboard.js';
import { guestsRouter, rsvpRouter } from './guests.js';
import { planningRouter } from './planning.js';
import { checklistTemplatesRouter, tasksRouter } from './tasks.js';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';
import { membersRouter } from './members.js';
import { weddingScoped } from './weddingScoped.js';
import { weddingsRouter } from './weddings.js';

export const apiRouter = Router();
// NOTE: the public contact router is mounted in app.ts with a per-app rate limiter. Do not mount it here.
apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(meRouter);
apiRouter.use(weddingsRouter); // GET/POST /weddings (+ the wedding's own routes, registered on weddingScoped)

// Everything under /weddings/:weddingId goes through weddingScoped, which applies
// requireAuth -> loadWedding -> requireMember ONCE. NEVER mount a per-wedding router on apiRouter
// directly. Phase 3: create a Router({ mergeParams: true }), put `...ownerWriteAccess` on write
// routes (reads need nothing extra) and mount it below, e.g. weddingScoped.use('/guests', guestsRouter).
apiRouter.use('/weddings/:weddingId', weddingScoped);
weddingScoped.use('/members', membersRouter);

// Phase 3 tracks: each track owns ONE router file and adds routes there only (don't edit this file).
weddingScoped.use(guestsRouter); // 3A: /guests, /guests/:guestId/invitation/...
weddingScoped.use(tasksRouter); // 3B: /tasks, /checklist-templates/:templateId/apply
weddingScoped.use(budgetRouter); // 3C: /expenses, /expenses/:expenseId/payments, /budget
weddingScoped.use(planningRouter); // 3D: /suppliers, /schedule
// Phase 4: read-only dashboard + reports, at the root of weddingScoped (guard already ran).
weddingScoped.use(dashboardRouter); // /dashboard, /reports/guests, /reports/budget
apiRouter.use(rsvpRouter); // 3A public: /rsvp/:token (no login)
apiRouter.use(checklistTemplatesRouter); // 3B: /checklist-templates (login required)

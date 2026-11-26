import { Router } from 'express';
import { currentUserId } from '../middleware/auth.js';
import { currentWeddingId } from '../middleware/wedding.js';
import { dashboardService } from '../services/dashboardService.js';
import { reportService } from '../services/reportService.js';

// Phase 4 — dashboard and reports (FR-57..60). Mounted at the root of weddingScoped
// (requireAuth + loadWedding + requireMember already ran). Read-only: no write guards needed,
// and archived weddings stay readable.
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await dashboardService.get(currentWeddingId(req), currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/reports/guests', async (req, res, next) => {
  try {
    res.json(await reportService.guests(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/reports/budget', async (req, res, next) => {
  try {
    res.json(await reportService.budget(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

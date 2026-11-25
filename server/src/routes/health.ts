import { Router } from 'express';
import { healthService } from '../services/healthService.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res, next) => {
  try {
    const { ok, body } = await healthService.check();
    res.status(ok ? 200 : 503).json(body);
  } catch (err) {
    next(err);
  }
});

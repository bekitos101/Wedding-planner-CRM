import { Router } from 'express';
import { authRouter } from './auth.js';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';

export const apiRouter = Router();
apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(meRouter);

import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { validate } from '../lib/validate.js';
import { currentUserId, requireAuth } from '../middleware/auth.js';
import { notificationService } from '../services/notificationService.js';

// Phase 5 — in-app notifications. Spans weddings, so it is NOT under weddingScoped: login is
// required and the service only ever returns the caller's own, still-accessible rows.
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listQuery = z.object({
  unread: z.enum(['true', 'false'], { error: 'unread must be true or false' }).transform((v) => v === 'true').optional(),
});

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const { query } = validate(req, { query: listQuery });
    res.json(await notificationService.list(currentUserId(req), query.unread ?? false));
  } catch (err) {
    next(err);
  }
});

notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    res.json({ count: await notificationService.unreadCount(currentUserId(req)) });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    await notificationService.markAllRead(currentUserId(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const id = parseUuidParam(req.params.id);
    if (!id) throw notFound('Notification not found.');
    res.json(await notificationService.markRead(currentUserId(req), id));
  } catch (err) {
    next(err);
  }
});

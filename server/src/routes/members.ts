import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { validate } from '../lib/validate.js';
import { currentWeddingId, ownerAccess, ownerWriteAccess } from '../middleware/wedding.js';
import { memberService } from '../services/memberService.js';
import { emailSchema } from './auth.js';

const addBody = z.object({ email: emailSchema });

// Mounted on weddingScoped (requireAuth + loadWedding + requireMember already ran).
export const membersRouter = Router({ mergeParams: true });

membersRouter.get('/', ...ownerAccess, async (req, res, next) => {
  try {
    res.json(await memberService.list(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

membersRouter.post('/', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: addBody });
    const { member, created } = await memberService.add(req.wedding!, body.email);
    res.status(created ? 201 : 200).json(member);
  } catch (err) {
    next(err);
  }
});

// Revoking is allowed on archived weddings: removing access is a security action, not a planning edit.
membersRouter.delete('/:userId', ...ownerAccess, async (req, res, next) => {
  try {
    const userId = parseUuidParam(req.params.userId);
    if (!userId) throw notFound('Team member not found.');
    await memberService.revoke(currentWeddingId(req), userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

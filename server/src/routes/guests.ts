import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { email, optionalText, requiredText } from '../lib/schemas.js';
import { TOKEN_RE } from '../lib/tokens.js';
import { validate } from '../lib/validate.js';
import { currentWeddingId, ownerWriteAccess } from '../middleware/wedding.js';
import { guestService } from '../services/guestService.js';
import { invitationService } from '../services/invitationService.js';
import { rsvpService } from '../services/rsvpService.js';

const rsvpStatus = z.enum(['PENDING', 'ACCEPTED', 'DECLINED'], { error: 'RSVP status must be PENDING, ACCEPTED or DECLINED' });

const createBody = z.object({
  name: requiredText('Name', 150),
  email: email(),
  dietaryRequirements: optionalText('Dietary requirements', 500),
});

const patchBody = z
  .object({
    name: requiredText('Name', 150).optional(),
    email: email().optional(),
    dietaryRequirements: optionalText('Dietary requirements', 500).optional(),
    rsvpStatus: rsvpStatus.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Provide at least one field to change');

const listQuery = z.object({
  search: z.string().trim().max(200).optional(),
  rsvpStatus: rsvpStatus.optional(),
});

const rsvpBody = z.object({
  rsvpStatus: z.enum(['ACCEPTED', 'DECLINED'], { error: 'Choose ACCEPTED or DECLINED' }),
  dietaryRequirements: optionalText('Dietary requirements', 500).optional(),
});

function guestIdParam(raw: unknown): string {
  const id = parseUuidParam(raw);
  if (!id) throw notFound('Guest not found.');
  return id;
}

// Mounted at the ROOT of weddingScoped (requireAuth + loadWedding + requireMember already ran).
export const guestsRouter = Router({ mergeParams: true });

guestsRouter.get('/guests', async (req, res, next) => {
  try {
    const { query } = validate(req, { query: listQuery });
    res.json(await guestService.list(currentWeddingId(req), { search: query.search || undefined, rsvpStatus: query.rsvpStatus }));
  } catch (err) {
    next(err);
  }
});

guestsRouter.post('/guests', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: createBody });
    res.status(201).json(await guestService.create(currentWeddingId(req), body));
  } catch (err) {
    next(err);
  }
});

guestsRouter.patch('/guests/:guestId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const guestId = guestIdParam(req.params.guestId);
    const { body } = validate(req, { body: patchBody });
    res.json(await guestService.update(currentWeddingId(req), guestId, body));
  } catch (err) {
    next(err);
  }
});

guestsRouter.delete('/guests/:guestId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    await guestService.remove(currentWeddingId(req), guestIdParam(req.params.guestId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

guestsRouter.post('/guests/:guestId/invitation/send', ...ownerWriteAccess, async (req, res, next) => {
  try {
    res.json(await invitationService.send(currentWeddingId(req), guestIdParam(req.params.guestId), req.log));
  } catch (err) {
    next(err);
  }
});

guestsRouter.post('/guests/:guestId/invitation/revoke', ...ownerWriteAccess, async (req, res, next) => {
  try {
    res.json(await invitationService.revoke(currentWeddingId(req), guestIdParam(req.params.guestId)));
  } catch (err) {
    next(err);
  }
});

const tokenParam = z.string().regex(TOKEN_RE);

/** A malformed token is answered exactly like an unknown one (404, same body). */
function parseToken(raw: unknown): string {
  const r = tokenParam.safeParse(raw);
  if (!r.success) throw notFound('This invitation link is not valid.');
  return r.data;
}

// Public (no login): GET/POST /rsvp/:token. Mounted on apiRouter, NOT under weddingScoped.
export const rsvpRouter = Router();

rsvpRouter.get('/rsvp/:token', async (req, res, next) => {
  try {
    res.json(await rsvpService.view(parseToken(req.params.token)));
  } catch (err) {
    next(err);
  }
});

rsvpRouter.post('/rsvp/:token', async (req, res, next) => {
  try {
    const token = parseToken(req.params.token);
    const { body } = validate(req, { body: rsvpBody });
    res.json(await rsvpService.respond(token, body));
  } catch (err) {
    next(err);
  }
});

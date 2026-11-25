import { Router } from 'express';
import { z } from 'zod';
import { parseDateOnly } from '../lib/dates.js';
import { validate } from '../lib/validate.js';
import { currentUserId, requireAuth } from '../middleware/auth.js';
import { currentWeddingId, ownerAccess, ownerWriteAccess } from '../middleware/wedding.js';
import { weddingService } from '../services/weddingService.js';
import { weddingScoped } from './weddingScoped.js';

/** Strict "YYYY-MM-DD" calendar date within 2000-01-01..2100-12-31; any time part is rejected. */
const dateOnly = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .refine((s) => parseDateOnly(s) !== null, `${label} must be a calendar date as YYYY-MM-DD between 2000-01-01 and 2100-12-31`)
    .transform((s) => parseDateOnly(s) as Date);
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MSG = 'Must be 0 or more, with at most 2 decimals';

/** String or number, >= 0, at most 2 decimals; kept as a string so no float arithmetic happens. */
export const moneySchema = z
  .union([z.string(), z.number().finite()], { error: 'Budget is required' })
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((s) => MONEY_RE.test(s), MONEY_MSG);

const text = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(200, `${label} must be at most 200 characters`);

const weddingFields = {
  coupleNames: text('Couple names'),
  weddingDate: dateOnly('Wedding date'),
  location: text('Location'),
  totalBudget: moneySchema,
  rsvpDeadline: dateOnly('RSVP deadline'),
};
const createBody = z.object(weddingFields);
// Unknown keys (status, ownerId, id, ...) are stripped, so they can never be changed.
const patchBody = z.object(weddingFields).partial();

const listQuery = z.object({
  status: z.enum(['active', 'archived'], { error: 'Status must be active or archived' }).default('active'),
});

export const weddingsRouter = Router();

weddingsRouter.get('/weddings', requireAuth, async (req, res, next) => {
  try {
    const { query } = validate(req, { query: listQuery });
    res.json(await weddingService.list(currentUserId(req), query.status === 'active' ? 'ACTIVE' : 'ARCHIVED'));
  } catch (err) {
    next(err);
  }
});

weddingsRouter.post('/weddings', requireAuth, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: createBody });
    res.status(201).json(await weddingService.create(currentUserId(req), body));
  } catch (err) {
    next(err);
  }
});

// The routes below are registered on weddingScoped (mounted at /weddings/:weddingId):
// requireAuth + loadWedding + requireMember already ran.
weddingScoped.get('/', async (req, res, next) => {
  try {
    res.json(await weddingService.get(currentWeddingId(req), currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

weddingScoped.patch('/', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: patchBody });
    res.json(await weddingService.update(currentWeddingId(req), currentUserId(req), body));
  } catch (err) {
    next(err);
  }
});

// Idempotent, so no requireActiveWedding.
weddingScoped.post('/archive', ...ownerAccess, async (req, res, next) => {
  try {
    res.json(await weddingService.archive(currentWeddingId(req), currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { money, optionalText, requiredText } from '../lib/schemas.js';
import { validate } from '../lib/validate.js';
import { currentWeddingId, ownerWriteAccess } from '../middleware/wedding.js';
import { scheduleService } from '../services/scheduleService.js';
import { supplierService } from '../services/supplierService.js';

// Track 3D — suppliers and the wedding-day schedule (wedding-scoped, mounted at the ROOT of
// weddingScoped: requireAuth + loadWedding + requireMember already ran).
export const planningRouter = Router({ mergeParams: true });

// ISO 8601 date-time with a REQUIRED offset (Z or ±hh:mm): an offset-less value would depend on
// the server's timezone. Seconds are optional. Years 2000..2100.
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

function parseDateTime(s: string): Date | null {
  const m = DATE_TIME_RE.exec(s);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const second = m[6] ? Number(m[6]) : 0;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const offset = m[7]!;
  if (offset.toUpperCase() !== 'Z') {
    const [oh, om] = [Number(offset.slice(1, 3)), Number(offset.slice(4, 6))];
    if (oh > 23 || om > 59) return null;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d : null;
}

const dateTime = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .refine(
      (s) => parseDateTime(s) !== null,
      `${label} must be a date and time with a timezone offset, e.g. 2027-06-19T14:00:00+02:00 (years 2000-2100)`,
    )
    .transform((s) => parseDateTime(s) as Date);

const quotedPrice = money('Quoted price').nullish().transform((v) => v ?? null);

const supplierCreate = z.object({
  name: requiredText('Name', 150),
  category: requiredText('Category', 60),
  contactInfo: optionalText('Contact info', 500),
  quotedPrice,
  notes: optionalText('Notes', 2000),
});
const supplierUpdate = supplierCreate.partial();
const supplierQuery = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(60).optional(),
});

const scheduleCreate = z.object({
  title: requiredText('Title', 200),
  startTime: dateTime('Start time'),
  endTime: dateTime('End time'),
  location: optionalText('Location', 200),
  notes: optionalText('Notes', 2000),
});
const scheduleUpdate = scheduleCreate.partial();

function idParam(raw: unknown, what: string): string {
  const id = parseUuidParam(raw);
  if (!id) throw notFound(`${what} not found.`);
  return id;
}

// ---- Suppliers (FR-48..51) ----
planningRouter.get('/suppliers', async (req, res, next) => {
  try {
    const { query } = validate(req, { query: supplierQuery });
    res.json(await supplierService.list(currentWeddingId(req), query));
  } catch (err) {
    next(err);
  }
});

planningRouter.post('/suppliers', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: supplierCreate });
    res.status(201).json(await supplierService.create(currentWeddingId(req), body));
  } catch (err) {
    next(err);
  }
});

planningRouter.patch('/suppliers/:supplierId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = idParam(req.params.supplierId, 'Supplier');
    const { body } = validate(req, { body: supplierUpdate });
    res.json(await supplierService.update(currentWeddingId(req), id, body));
  } catch (err) {
    next(err);
  }
});

planningRouter.delete('/suppliers/:supplierId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    await supplierService.remove(currentWeddingId(req), idParam(req.params.supplierId, 'Supplier'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Schedule (FR-52..56) ----
planningRouter.get('/schedule', async (req, res, next) => {
  try {
    res.json(await scheduleService.list(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

planningRouter.post('/schedule', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: scheduleCreate });
    res.status(201).json(await scheduleService.create(currentWeddingId(req), body));
  } catch (err) {
    next(err);
  }
});

planningRouter.patch('/schedule/:itemId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = idParam(req.params.itemId, 'Schedule item');
    const { body } = validate(req, { body: scheduleUpdate });
    res.json(await scheduleService.update(currentWeddingId(req), id, body));
  } catch (err) {
    next(err);
  }
});

planningRouter.delete('/schedule/:itemId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    await scheduleService.remove(currentWeddingId(req), idParam(req.params.itemId, 'Schedule item'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

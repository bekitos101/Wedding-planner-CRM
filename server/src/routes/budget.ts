import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { dateOnly, money, optionalText, requiredText } from '../lib/schemas.js';
import { validate } from '../lib/validate.js';
import { currentWeddingId, ownerWriteAccess } from '../middleware/wedding.js';
import { budgetService } from '../services/budgetService.js';
import { expenseService } from '../services/expenseService.js';

// Track 3C — expenses, payments and the budget summary (mounted at the root of weddingScoped;
// requireAuth + loadWedding + requireMember already ran).
export const budgetRouter = Router({ mergeParams: true });

const expenseBody = z.object({
  description: requiredText('Description', 200),
  category: requiredText('Category', 60),
  agreedAmount: money('Agreed amount'),
  dueDate: dateOnly('Due date'),
  notes: optionalText('Notes', 2000),
});
const expensePatch = expenseBody.partial();

const amount = money('Amount').refine((d) => d.gt(0), 'Amount must be greater than 0');
const paymentBody = z.object({
  amount,
  paymentDate: dateOnly('Payment date'),
  notes: optionalText('Notes', 2000),
});
const paymentPatch = paymentBody.partial();

function expenseId(raw: unknown): string {
  const id = parseUuidParam(raw);
  if (!id) throw notFound('Expense not found.');
  return id;
}
function paymentId(raw: unknown): string {
  const id = parseUuidParam(raw);
  if (!id) throw notFound('Payment not found.');
  return id;
}

budgetRouter.get('/budget', async (req, res, next) => {
  try {
    res.json(await budgetService.summary(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

budgetRouter.get('/expenses', async (req, res, next) => {
  try {
    res.json(await expenseService.list(currentWeddingId(req)));
  } catch (err) {
    next(err);
  }
});

budgetRouter.post('/expenses', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: expenseBody });
    res.status(201).json(await expenseService.create(currentWeddingId(req), body));
  } catch (err) {
    next(err);
  }
});

budgetRouter.get('/expenses/:expenseId', async (req, res, next) => {
  try {
    res.json(await expenseService.get(currentWeddingId(req), expenseId(req.params.expenseId)));
  } catch (err) {
    next(err);
  }
});

budgetRouter.patch('/expenses/:expenseId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = expenseId(req.params.expenseId);
    const { body } = validate(req, { body: expensePatch });
    res.json(await expenseService.update(currentWeddingId(req), id, body));
  } catch (err) {
    next(err);
  }
});

budgetRouter.delete('/expenses/:expenseId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    await expenseService.remove(currentWeddingId(req), expenseId(req.params.expenseId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

budgetRouter.post('/expenses/:expenseId/payments', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = expenseId(req.params.expenseId);
    const { body } = validate(req, { body: paymentBody });
    res.status(201).json(await expenseService.addPayment(currentWeddingId(req), id, body));
  } catch (err) {
    next(err);
  }
});

budgetRouter.patch('/expenses/:expenseId/payments/:paymentId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = expenseId(req.params.expenseId);
    const pid = paymentId(req.params.paymentId);
    const { body } = validate(req, { body: paymentPatch });
    res.json(await expenseService.updatePayment(currentWeddingId(req), id, pid, body));
  } catch (err) {
    next(err);
  }
});

budgetRouter.delete('/expenses/:expenseId/payments/:paymentId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const id = expenseId(req.params.expenseId);
    const pid = paymentId(req.params.paymentId);
    res.json(await expenseService.removePayment(currentWeddingId(req), id, pid));
  } catch (err) {
    next(err);
  }
});

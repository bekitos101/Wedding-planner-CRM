import { randomUUID } from 'node:crypto';
import type { RouteSpec } from './types.js';

const expense = { description: 'Cake', category: 'Catering', agreedAmount: '100.00', dueDate: '2027-01-01' };

/** Track 3C expenses, payments, budget: every route this track mounts under /weddings/:weddingId. */
export const BUDGET_ROUTES: RouteSpec[] = [
  { name: 'list expenses', method: 'get', pattern: '/weddings/:weddingId/expenses', path: (c) => `/api/weddings/${c.weddingId}/expenses`, access: 'member', write: false },
  { name: 'create expense', method: 'post', pattern: '/weddings/:weddingId/expenses', path: (c) => `/api/weddings/${c.weddingId}/expenses`, body: expense, access: 'owner', write: true },
  { name: 'get expense', method: 'get', pattern: '/weddings/:weddingId/expenses/:expenseId', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}`, access: 'member', write: false, archivedStatus: 404, memberReadStatus: 404 },
  { name: 'update expense', method: 'patch', pattern: '/weddings/:weddingId/expenses/:expenseId', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}`, body: { description: 'x' }, access: 'owner', write: true },
  { name: 'delete expense', method: 'delete', pattern: '/weddings/:weddingId/expenses/:expenseId', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}`, access: 'owner', write: true },
  { name: 'add payment', method: 'post', pattern: '/weddings/:weddingId/expenses/:expenseId/payments', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}/payments`, body: { amount: '10.00', paymentDate: '2026-12-01' }, access: 'owner', write: true },
  { name: 'update payment', method: 'patch', pattern: '/weddings/:weddingId/expenses/:expenseId/payments/:paymentId', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}/payments/${randomUUID()}`, body: { notes: 'x' }, access: 'owner', write: true },
  { name: 'delete payment', method: 'delete', pattern: '/weddings/:weddingId/expenses/:expenseId/payments/:paymentId', path: (c) => `/api/weddings/${c.weddingId}/expenses/${randomUUID()}/payments/${randomUUID()}`, access: 'owner', write: true },
  { name: 'budget summary', method: 'get', pattern: '/weddings/:weddingId/budget', path: (c) => `/api/weddings/${c.weddingId}/budget`, access: 'member', write: false },
];

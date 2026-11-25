import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { makeExpense, makePayment } from './helpers/budgetFactories.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function setup(totalBudget = '10000.00') {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const { user: stranger } = await createUser();
  const wedding = await createWedding(owner.id, { totalBudget });
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  const base = `/api/weddings/${wedding.id}`;
  return { owner, member, stranger, wedding, base, o: bearer(owner.id), m: bearer(member.id), s: bearer(stranger.id) };
}

const newExpense = { description: 'Venue hire', category: 'Venue', agreedAmount: '1000.00', dueDate: '2027-03-01' };
const pay = (amount: string | number | undefined, paymentDate = '2026-01-01') => ({ amount, paymentDate });

describe('expenses CRUD', () => {
  it('FR-40/41: owner creates, reads, edits and deletes an expense', async () => {
    const t = await setup();
    const c = await api().post(`${t.base}/expenses`).set(t.o).send({ ...newExpense, notes: ' hi ' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ description: 'Venue hire', agreedAmount: '1000.00', dueDate: '2027-03-01', notes: 'hi', totalPaid: '0.00', outstanding: '1000.00', isOverdue: false, paymentCount: 0 });
    const g = await api().get(`${t.base}/expenses/${c.body.id}`).set(t.o);
    expect(g.status).toBe(200);
    expect(g.body.payments).toEqual([]);
    const p = await api().patch(`${t.base}/expenses/${c.body.id}`).set(t.o).send({ agreedAmount: 1200.5 });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ agreedAmount: '1200.50', outstanding: '1200.50', notes: 'hi' });
    expect(p.body.payments).toBeUndefined();
    const list = await api().get(`${t.base}/expenses`).set(t.o);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].payments).toBeUndefined();
    expect((await api().delete(`${t.base}/expenses/${c.body.id}`).set(t.o)).status).toBe(204);
    expect((await api().get(`${t.base}/expenses/${c.body.id}`).set(t.o)).status).toBe(404);
  });

  it('FR-40: list is sorted by dueDate then description', async () => {
    const t = await setup();
    await makeExpense(t.wedding.id, { description: 'B', dueDate: '2027-02-01' });
    await makeExpense(t.wedding.id, { description: 'A', dueDate: '2027-02-01' });
    await makeExpense(t.wedding.id, { description: 'Z', dueDate: '2027-01-01' });
    const res = await api().get(`${t.base}/expenses`).set(t.o);
    expect(res.body.map((e: { description: string }) => e.description)).toEqual(['Z', 'A', 'B']);
  });

  it('FR-41: invalid expense input → 400 with fields', async () => {
    const t = await setup();
    const res = await api().post(`${t.base}/expenses`).set(t.o).send({ description: '', category: 'x', agreedAmount: '-5', dueDate: '2027-02-30' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['description', 'agreedAmount', 'dueDate']));
  });

  it('FR-40: member reads expenses (200) but cannot write (403)', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id);
    expect((await api().get(`${t.base}/expenses`).set(t.m)).status).toBe(200);
    expect((await api().get(`${t.base}/expenses/${e.id}`).set(t.m)).status).toBe(200);
    expect((await api().post(`${t.base}/expenses`).set(t.m).send(newExpense)).status).toBe(403);
    expect((await api().patch(`${t.base}/expenses/${e.id}`).set(t.m).send({ description: 'x' })).status).toBe(403);
    expect((await api().delete(`${t.base}/expenses/${e.id}`).set(t.m)).status).toBe(403);
    expect((await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.m).send(pay('1'))).status).toBe(403);
    const p = await makePayment(e.id, '5.00');
    expect((await api().patch(`${t.base}/expenses/${e.id}/payments/${p.id}`).set(t.m).send({ notes: 'x' })).status).toBe(403);
    expect((await api().delete(`${t.base}/expenses/${e.id}/payments/${p.id}`).set(t.m)).status).toBe(403);
    expect((await api().get(`${t.base}/budget`).set(t.m)).status).toBe(200);
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(1);
  });

  it('BR-14: non-member gets 404 on every budget route', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id);
    const p = await makePayment(e.id, '10.00');
    const calls = [
      api().get(`${t.base}/expenses`),
      api().post(`${t.base}/expenses`).send(newExpense),
      api().get(`${t.base}/expenses/${e.id}`),
      api().patch(`${t.base}/expenses/${e.id}`).send({ description: 'x' }),
      api().delete(`${t.base}/expenses/${e.id}`),
      api().post(`${t.base}/expenses/${e.id}/payments`).send(pay('1')),
      api().patch(`${t.base}/expenses/${e.id}/payments/${p.id}`).send({ notes: 'x' }),
      api().delete(`${t.base}/expenses/${e.id}/payments/${p.id}`),
      api().get(`${t.base}/budget`),
    ];
    for (const c of calls) expect((await c.set(t.s)).status).toBe(404);
    expect(await prisma.expense.count({ where: { weddingId: t.wedding.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(1);
  });

  it('BR-14: an expense id from another wedding → 404 on every expense route', async () => {
    const a = await setup();
    const b = await setup();
    const foreign = await makeExpense(b.wedding.id);
    const fp = await makePayment(foreign.id, '10.00');
    const ex = `${a.base}/expenses/${foreign.id}`;
    expect((await api().get(ex).set(a.o)).status).toBe(404);
    expect((await api().patch(ex).set(a.o).send({ description: 'x' })).status).toBe(404);
    expect((await api().delete(ex).set(a.o)).status).toBe(404);
    expect((await api().post(`${ex}/payments`).set(a.o).send(pay('1'))).status).toBe(404);
    expect((await api().patch(`${ex}/payments/${fp.id}`).set(a.o).send({ notes: 'x' })).status).toBe(404);
    expect((await api().delete(`${ex}/payments/${fp.id}`).set(a.o)).status).toBe(404);
    expect((await api().get(`${a.base}/expenses/not-a-uuid`).set(a.o)).status).toBe(404);
    expect(await prisma.payment.count({ where: { expenseId: foreign.id } })).toBe(1);
    expect(await prisma.expense.count({ where: { id: foreign.id } })).toBe(1);
  });

  it('BR-14: a payment id from another expense of the same wedding → 404 and untouched', async () => {
    const t = await setup();
    const e1 = await makeExpense(t.wedding.id);
    const e2 = await makeExpense(t.wedding.id);
    const p2 = await makePayment(e2.id, '50.00');
    const url = `${t.base}/expenses/${e1.id}/payments/${p2.id}`;
    expect((await api().patch(url).set(t.o).send({ amount: '1.00' })).status).toBe(404);
    expect((await api().delete(url).set(t.o)).status).toBe(404);
    expect((await api().delete(`${t.base}/expenses/${e1.id}/payments/${randomUUID()}`).set(t.o)).status).toBe(404);
    expect(await prisma.payment.count({ where: { id: p2.id } })).toBe(1);
  });

  it('FR-40: deleting an expense deletes its payments', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id);
    await makePayment(e.id, '10.00');
    await api().delete(`${t.base}/expenses/${e.id}`).set(t.o);
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(0);
  });
});

describe('payments', () => {
  it('AC-08: planner records a deposit and a later payment and the outstanding balance is correct', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '5000.00' });
    const dep = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send({ amount: '1500.00', paymentDate: '2026-09-01', notes: 'Deposit' });
    expect(dep.status).toBe(201);
    expect(dep.body).toMatchObject({ totalPaid: '1500.00', outstanding: '3500.00', paymentCount: 1 });
    const later = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay('2000.50', '2026-11-01'));
    expect(later.status).toBe(201);
    expect(later.body).toMatchObject({ totalPaid: '3500.50', outstanding: '1499.50', paymentCount: 2 });
    expect(later.body.payments.map((p: { amount: string }) => p.amount)).toEqual(['1500.00', '2000.50']);
    expect(later.body.payments[0]).toMatchObject({ paymentDate: '2026-09-01', notes: 'Deposit' });
    const g = await api().get(`${t.base}/expenses/${e.id}`).set(t.o);
    expect(g.body.outstanding).toBe('1499.50');
  });

  it('BR-07: outstanding = agreed − sum of payments', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '300.00' });
    await makePayment(e.id, '100.25');
    await makePayment(e.id, '50.00');
    const res = await api().get(`${t.base}/expenses`).set(t.o);
    expect(res.body[0]).toMatchObject({ totalPaid: '150.25', outstanding: '149.75', paymentCount: 2 });
  });

  it('FR-44: decimals are exact (0.10 + 0.20 = "0.30")', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '1.00' });
    await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay(0.1));
    const res = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay(0.2, '2026-01-02'));
    expect(res.body.totalPaid).toBe('0.30');
    expect(res.body.outstanding).toBe('0.70');
  });

  it('BR-08: editing or deleting a payment recalculates the balance', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '1000.00' });
    const p1 = await makePayment(e.id, '400.00', '2026-01-01');
    const p2 = await makePayment(e.id, '100.00', '2026-02-01');
    const edit = await api().patch(`${t.base}/expenses/${e.id}/payments/${p2.id}`).set(t.o).send({ amount: '250.00' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ totalPaid: '650.00', outstanding: '350.00' });
    const del = await api().delete(`${t.base}/expenses/${e.id}/payments/${p1.id}`).set(t.o);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ totalPaid: '250.00', outstanding: '750.00', paymentCount: 1 });
    const keepAmount = await api().patch(`${t.base}/expenses/${e.id}/payments/${p2.id}`).set(t.o).send({ notes: 'cheque' });
    expect(keepAmount.body.payments[0]).toMatchObject({ amount: '250.00', notes: 'cheque' });
    const budget = await api().get(`${t.base}/budget`).set(t.o);
    expect(budget.body.paid).toBe('250.00');
  });

  it('FR-43: amount 0, negative or missing → 400 fields.amount', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id);
    for (const amount of ['0', '0.00', '-5', 'abc', '1.234', undefined]) {
      const res = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay(amount));
      expect(res.status, String(amount)).toBe(400);
      expect(res.body.error.fields.amount).toBeDefined();
    }
    const p = await makePayment(e.id, '10.00');
    const res = await api().patch(`${t.base}/expenses/${e.id}/payments/${p.id}`).set(t.o).send({ amount: '0' });
    expect(res.status).toBe(400);
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(1);
  });

  it('BR-07: overpayment → 400 and the message states the outstanding balance', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '100.00' });
    await makePayment(e.id, '70.00');
    const res = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay('30.01'));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.amount).toBe('This payment is more than the outstanding balance (30.00).');
    expect(res.body.error.message).toContain('30.00');
    const exact = await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay('30.00'));
    expect(exact.status).toBe(201);
    expect(exact.body.outstanding).toBe('0.00');
  });

  it('BR-08: editing a payment above the agreed amount → 400, balance unchanged', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '100.00' });
    await makePayment(e.id, '60.00');
    const p = await makePayment(e.id, '20.00');
    const res = await api().patch(`${t.base}/expenses/${e.id}/payments/${p.id}`).set(t.o).send({ amount: '40.01' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.amount).toContain('(40.00)');
    expect((await api().patch(`${t.base}/expenses/${e.id}/payments/${p.id}`).set(t.o).send({ amount: '40.00' })).status).toBe(200);
  });

  it('NFR-14: parallel payments cannot overpay an expense', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '100.00' });
    const results = await Promise.all([1, 2, 3].map(() => api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay('60.00'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    const sum = await prisma.payment.aggregate({ where: { expenseId: e.id }, _sum: { amount: true } });
    expect(sum._sum.amount!.lte(100)).toBe(true);
  });

  it('FR-40: agreedAmount below what is already paid → 400 fields.agreedAmount', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '500.00' });
    await makePayment(e.id, '200.00');
    const res = await api().patch(`${t.base}/expenses/${e.id}`).set(t.o).send({ agreedAmount: '199.99' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.agreedAmount).toBe("The agreed amount can't be less than what has already been paid (200.00).");
    const ok = await api().patch(`${t.base}/expenses/${e.id}`).set(t.o).send({ agreedAmount: '200.00' });
    expect(ok.status).toBe(200);
    expect(ok.body.outstanding).toBe('0.00');
  });
});

describe('budget summary', () => {
  it('FR-45: committed, paid, outstanding and a negative remaining are exact', async () => {
    const t = await setup('25000.00');
    const mk = (description: string, agreedAmount: string, dueDate: string) => makeExpense(t.wedding.id, { description, agreedAmount, dueDate });
    const venue = await mk('Venue', '8000.00', '2099-05-19');
    const food = await mk('Dinner', '9000.00', '2099-06-10');
    const photo = await mk('Photographer', '2500.00', '2020-10-31');
    const flowers = await mk('Flowers', '1200.00', '2099-06-01');
    await mk('Band', '2200.00', '2099-06-19');
    const dress = await mk('Attire', '3100.00', '2099-04-30');
    await makePayment(venue.id, '2000.00');
    await makePayment(venue.id, '3000.00');
    await makePayment(food.id, '1500.00');
    await makePayment(photo.id, '1000.00');
    await makePayment(flowers.id, '1200.00');
    await makePayment(dress.id, '500.10');
    await makePayment(dress.id, '599.90');
    const res = await api().get(`${t.base}/budget`).set(t.m);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalBudget: '25000.00', committed: '26000.00', paid: '9800.00', outstanding: '16200.00', remaining: '-1000.00' });
  });

  it('FR-46: overdue expenses = outstanding > 0 and due before today, sorted by dueDate', async () => {
    const t = await setup();
    const late2 = await makeExpense(t.wedding.id, { description: 'Late 2', agreedAmount: '100.00', dueDate: '2021-05-01' });
    const late1 = await makeExpense(t.wedding.id, { description: 'Late 1', agreedAmount: '200.00', dueDate: '2020-01-01', category: 'Music' });
    const paidLate = await makeExpense(t.wedding.id, { description: 'Paid late', agreedAmount: '50.00', dueDate: '2020-01-01' });
    await makeExpense(t.wedding.id, { description: 'Future', dueDate: '2099-01-01' });
    await makePayment(late2.id, '40.00');
    await makePayment(paidLate.id, '50.00');
    const res = await api().get(`${t.base}/budget`).set(t.o);
    expect(res.body.overdueExpenses).toEqual([
      { id: late1.id, description: 'Late 1', category: 'Music', outstanding: '200.00', dueDate: '2020-01-01' },
      { id: late2.id, description: 'Late 2', category: 'Venue', outstanding: '60.00', dueDate: '2021-05-01' },
    ]);
    const list = await api().get(`${t.base}/expenses`).set(t.o);
    const flags = Object.fromEntries(list.body.map((e: { description: string; isOverdue: boolean }) => [e.description, e.isOverdue]));
    expect(flags).toEqual({ 'Late 1': true, 'Late 2': true, 'Paid late': false, Future: false });
  });

  it('FR-46: an expense due today is not overdue', async () => {
    const t = await setup();
    await makeExpense(t.wedding.id, { dueDate: new Date().toISOString().slice(0, 10) });
    const res = await api().get(`${t.base}/budget`).set(t.o);
    expect(res.body.overdueExpenses).toEqual([]);
  });

  it('FR-59: summary of an empty wedding is all zeros', async () => {
    const t = await setup('1234.50');
    const res = await api().get(`${t.base}/budget`).set(t.o);
    expect(res.body).toEqual({ totalBudget: '1234.50', committed: '0.00', paid: '0.00', outstanding: '0.00', remaining: '1234.50', overdueExpenses: [] });
  });

  it('BR-14: the summary only counts this wedding', async () => {
    const a = await setup('100.00');
    const b = await setup('100.00');
    await makeExpense(b.wedding.id, { agreedAmount: '999.00' });
    const res = await api().get(`${a.base}/budget`).set(a.o);
    expect(res.body.committed).toBe('0.00');
  });
});

describe('archived weddings', () => {
  it('BR-13: budget writes on an archived wedding → 409, reads still work', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id);
    await api().post(`${t.base}/archive`).set(t.o);
    expect((await api().post(`${t.base}/expenses`).set(t.o).send(newExpense)).status).toBe(409);
    expect((await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send(pay('1'))).status).toBe(409);
    expect((await api().get(`${t.base}/expenses`).set(t.o)).status).toBe(200);
    expect((await api().get(`${t.base}/budget`).set(t.o)).status).toBe(200);
  });
});

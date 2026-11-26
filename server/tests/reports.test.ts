import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  const wedding = await createWedding(owner.id, { totalBudget });
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  return { wedding, base: `/api/weddings/${wedding.id}`, o: bearer(owner.id), m: bearer(member.id) };
}

async function guest(
  weddingId: string,
  name: string,
  o: { rsvp?: 'PENDING' | 'ACCEPTED' | 'DECLINED'; diet?: string | null; inv?: { delivery: 'SENT' | 'FAILED' | 'PENDING'; revoked?: boolean } } = {},
) {
  const g = await prisma.guest.create({
    data: {
      weddingId, name, email: `${name.toLowerCase().replace(/\W/g, '')}@r.local`,
      rsvpStatus: o.rsvp ?? 'PENDING', dietaryRequirements: o.diet ?? null,
      respondedAt: o.rsvp && o.rsvp !== 'PENDING' ? new Date('2026-05-01T10:00:00Z') : null,
    },
  });
  if (o.inv) {
    await prisma.invitation.create({
      data: { guestId: g.id, tokenHash: `h-${randomUUID()}`, deliveryStatus: o.inv.delivery, revokedAt: o.inv.revoked ? new Date() : null },
    });
  }
  return g;
}

describe('guest report (FR-58)', () => {
  it('FR-58: summary, dietary list (non-empty only, by name) and guests sorted by name', async () => {
    const t = await setup();
    await guest(t.wedding.id, 'Zed', { rsvp: 'DECLINED', diet: 'no nuts', inv: { delivery: 'FAILED' } });
    await guest(t.wedding.id, 'Amy', { rsvp: 'ACCEPTED', diet: '  vegan  ', inv: { delivery: 'SENT' } });
    await guest(t.wedding.id, 'Bob', { rsvp: 'ACCEPTED', diet: '   ' });
    await guest(t.wedding.id, 'Cat', { diet: '', inv: { delivery: 'PENDING' } });
    await guest(t.wedding.id, 'Dan', { rsvp: 'ACCEPTED', inv: { delivery: 'SENT', revoked: true } });
    const res = await api().get(`${t.base}/reports/guests`).set(t.o);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 5, pending: 1, accepted: 3, declined: 1, responseRate: 80 });
    expect(res.body.dietary).toEqual([
      { name: 'Amy', rsvpStatus: 'ACCEPTED', dietaryRequirements: 'vegan' },
      { name: 'Zed', rsvpStatus: 'DECLINED', dietaryRequirements: 'no nuts' },
    ]);
    expect(res.body.guests.map((g: { name: string }) => g.name)).toEqual(['Amy', 'Bob', 'Cat', 'Dan', 'Zed']);
    expect(res.body.guests.map((g: { invitationStatus: string }) => g.invitationStatus)).toEqual([
      'SENT', 'NOT_SENT', 'NOT_SENT', 'REVOKED', 'FAILED',
    ]);
    expect(res.body.guests[0]).toEqual({
      name: 'Amy', email: 'amy@r.local', rsvpStatus: 'ACCEPTED', respondedAt: '2026-05-01T10:00:00.000Z',
      dietaryRequirements: 'vegan', invitationStatus: 'SENT',
    });
    expect(res.body.guests[2].respondedAt).toBeNull();
    expect(res.body.guests[1].dietaryRequirements).toBeNull(); // whitespace-only note counts as empty
  });

  it('FR-58: guest report exposes no ids, tokens or hashes', async () => {
    const t = await setup();
    await guest(t.wedding.id, 'Amy', { inv: { delivery: 'SENT' } });
    const res = await api().get(`${t.base}/reports/guests`).set(t.o);
    expect(Object.keys(res.body).sort()).toEqual(['dietary', 'guests', 'summary']);
    expect(Object.keys(res.body.guests[0]).sort()).toEqual(['dietaryRequirements', 'email', 'invitationStatus', 'name', 'respondedAt', 'rsvpStatus']);
    expect(Object.keys(res.body.dietary[0] ?? { name: 1, rsvpStatus: 1, dietaryRequirements: 1 }).sort()).toEqual(['dietaryRequirements', 'name', 'rsvpStatus']);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|"id"|h-[0-9a-f]{8}-/);
  });

  it('FR-58: empty wedding gives zeros and empty lists; other weddings do not leak', async () => {
    const t = await setup();
    const other = await setup();
    await guest(other.wedding.id, 'Other', { diet: 'x' });
    const res = await api().get(`${t.base}/reports/guests`).set(t.o);
    expect(res.body).toEqual({ summary: { total: 0, pending: 0, accepted: 0, declined: 0, responseRate: 0 }, dietary: [], guests: [] });
  });

  it('FR-60: team member can read the guest report', async () => {
    const t = await setup();
    await guest(t.wedding.id, 'Amy');
    const res = await api().get(`${t.base}/reports/guests`).set(t.m);
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(1);
  });
});

describe('budget report (FR-58)', () => {
  it('FR-58: categories group case-insensitively with exact Decimal sums, sorted by committed', async () => {
    const t = await setup('10000.00');
    const id = t.wedding.id;
    const v1 = await makeExpense(id, { description: 'v1', category: 'Venue', agreedAmount: '1000.00' });
    await makeExpense(id, { description: 'v2', category: 'Venue', agreedAmount: '200.00' });
    const v3 = await makeExpense(id, { description: 'v3', category: 'venue ', agreedAmount: '100.10' });
    await makeExpense(id, { description: 'v4', category: 'VENUE', agreedAmount: '0.20' });
    await makePayment(v1.id, '0.10');
    await makePayment(v3.id, '0.20');
    const c1 = await makeExpense(id, { description: 'c1', category: 'Catering', agreedAmount: '400.00' });
    await makeExpense(id, { description: 'c2', category: 'Catering', agreedAmount: '99.70' });
    await makePayment(c1.id, '400.00');

    const res = await api().get(`${t.base}/reports/budget`).set(t.o);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ totalBudget: '10000.00', committed: '1800.00', paid: '400.30', outstanding: '1399.70', remaining: '8200.00' });
    expect(res.body.byCategory).toEqual([
      { category: 'Venue', expenseCount: 4, committed: '1300.30', paid: '0.30', outstanding: '1300.00', shareOfCommitted: 72 },
      { category: 'Catering', expenseCount: 2, committed: '499.70', paid: '400.00', outstanding: '99.70', shareOfCommitted: 27 },
    ]);
  });

  it('FR-58: label is the most common spelling; ties are alphabetical', async () => {
    const t = await setup();
    const id = t.wedding.id;
    await makeExpense(id, { category: 'cake', agreedAmount: '10.00' });
    await makeExpense(id, { category: 'Cake', agreedAmount: '10.00' });
    await makeExpense(id, { category: 'FLOWERS', agreedAmount: '5.00' });
    await makeExpense(id, { category: 'flowers', agreedAmount: '5.00' });
    await makeExpense(id, { category: 'flowers', agreedAmount: '5.00' });
    const res = await api().get(`${t.base}/reports/budget`).set(t.o);
    expect(res.body.byCategory.map((c: { category: string; expenseCount: number }) => [c.category, c.expenseCount])).toEqual([
      ['Cake', 2],
      ['flowers', 3],
    ]);
  });

  it('FR-58: equal committed amounts sort by category name', async () => {
    const t = await setup();
    await makeExpense(t.wedding.id, { category: 'Music', agreedAmount: '50.00' });
    await makeExpense(t.wedding.id, { category: 'Decor', agreedAmount: '50.00' });
    const res = await api().get(`${t.base}/reports/budget`).set(t.o);
    expect(res.body.byCategory.map((c: { category: string }) => c.category)).toEqual(['Decor', 'Music']);
    expect(res.body.byCategory.map((c: { shareOfCommitted: number }) => c.shareOfCommitted)).toEqual([50, 50]);
  });

  it('FR-58: shareOfCommitted is 0 when nothing is committed; no expenses gives an empty list', async () => {
    const t = await setup('300.00');
    const empty = await api().get(`${t.base}/reports/budget`).set(t.m);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      totals: { totalBudget: '300.00', committed: '0.00', paid: '0.00', outstanding: '0.00', remaining: '300.00' },
      byCategory: [],
    });
    await makeExpense(t.wedding.id, { category: 'Gift', agreedAmount: '0.00' });
    const zero = await api().get(`${t.base}/reports/budget`).set(t.o);
    expect(zero.body.byCategory).toEqual([
      { category: 'Gift', expenseCount: 1, committed: '0.00', paid: '0.00', outstanding: '0.00', shareOfCommitted: 0 },
    ]);
  });

  it('FR-58: over-budget remaining is negative; totals equal the budget summary', async () => {
    const t = await setup('100.00');
    const e = await makeExpense(t.wedding.id, { agreedAmount: '250.00', dueDate: '2020-01-01' });
    await makePayment(e.id, '50.00');
    const report = await api().get(`${t.base}/reports/budget`).set(t.o);
    const budget = await api().get(`${t.base}/budget`).set(t.o);
    expect(report.body.totals.remaining).toBe('-150.00');
    expect(report.body.totals).toEqual({
      totalBudget: budget.body.totalBudget, committed: budget.body.committed, paid: budget.body.paid,
      outstanding: budget.body.outstanding, remaining: budget.body.remaining,
    });
  });

  it('BR-14: non-member gets 404 on both reports', async () => {
    const t = await setup();
    const { user: stranger } = await createUser();
    for (const p of ['reports/guests', 'reports/budget']) {
      expect((await api().get(`${t.base}/${p}`).set(bearer(stranger.id))).status).toBe(404);
    }
  });
});

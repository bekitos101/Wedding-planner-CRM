import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { makeExpense, makePayment } from './helpers/budgetFactories.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';
import { createScheduleItem } from './helpers/planningFactories.js';
import { dateStr, day, makeTask } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(() => setMailTransportForTests(undefined));

async function setup(totalBudget = '20000.00', offset = 100) {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const w = await createWedding(owner.id, { totalBudget });
  const wedding = await prisma.wedding.update({ where: { id: w.id }, data: { weddingDate: day(offset), rsvpDeadline: day(offset) } });
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  return { owner, member, wedding, base: `/api/weddings/${wedding.id}`, o: bearer(owner.id), m: bearer(member.id) };
}
type T = Awaited<ReturnType<typeof setup>>;
const get = async (t: T, path: string, h = t.o) => {
  const r = await api().get(`${t.base}/${path}`).set(h);
  expect(r.status, path).toBe(200);
  return r.body;
};
const inv = (guestId: string, deliveryStatus: 'SENT' | 'FAILED' | 'PENDING', revokedAt: Date | null = null) =>
  prisma.invitation.create({ data: { guestId, tokenHash: `h-${randomUUID()}`, deliveryStatus, revokedAt } });
const dec = (s: string) => new Prisma.Decimal(s);

describe('dashboard consistency (FR-59, NFR-14)', () => {
  it('FR-59: dashboard guests/tasks/budget equal the underlying list endpoints', async () => {
    const t = await setup();
    const id = t.wedding.id;
    const g1 = await createGuest(id, { name: 'A' });
    const g2 = await createGuest(id, { name: 'B' });
    await createGuest(id, { name: 'C' });
    await prisma.guest.update({ where: { id: g1.id }, data: { rsvpStatus: 'ACCEPTED' } });
    await prisma.guest.update({ where: { id: g2.id }, data: { rsvpStatus: 'DECLINED' } });
    await makeTask(id, { status: 'TODO', dueDate: day(-3) });
    await makeTask(id, { status: 'IN_PROGRESS', dueDate: day(-1) });
    await makeTask(id, { status: 'COMPLETED', dueDate: day(-9) });
    await makeTask(id, { status: 'TODO', dueDate: day(4) });
    const e = await makeExpense(id, { agreedAmount: '333.33', dueDate: dateStr(-2) });
    await makePayment(e.id, '100.01');

    const d = await get(t, 'dashboard');
    const gl = await get(t, 'guests');
    expect({ total: d.guests.total, pending: d.guests.pending, accepted: d.guests.accepted, declined: d.guests.declined }).toEqual(gl.summary);

    const tasks = (await get(t, 'tasks')) as { status: string; isOverdue: boolean }[];
    expect(d.tasks.total).toBe(tasks.length);
    expect(d.tasks.completed).toBe(tasks.filter((x) => x.status === 'COMPLETED').length);
    expect(d.tasks.todo).toBe(tasks.filter((x) => x.status === 'TODO').length);
    expect(d.tasks.inProgress).toBe(tasks.filter((x) => x.status === 'IN_PROGRESS').length);
    expect(d.tasks.overdue).toBe(tasks.filter((x) => x.isOverdue).length);
    expect(d.tasks.overdue).toBe(2);

    const list = await api().get('/api/weddings').set(t.o);
    const mine = list.body.find((w: { id: string }) => w.id === id);
    expect(d.tasks.percentComplete).toBe(mine.progress.percent);

    const b = await get(t, 'budget');
    const { overdueExpenses, ...totals } = b;
    expect(d.budget).toEqual({ ...totals, overdueExpenseCount: overdueExpenses.length });
    expect(d.budget.outstanding).toBe('233.32');
  });

  it('FR-58: reports/budget totals equal GET /budget and category sums add up exactly', async () => {
    const t = await setup('1000.00');
    const id = t.wedding.id;
    const a = await makeExpense(id, { category: 'Venue', agreedAmount: '0.10' });
    const b = await makeExpense(id, { category: ' VENUE', agreedAmount: '0.20' });
    const c = await makeExpense(id, { category: 'venue ', agreedAmount: '333.33' });
    const d = await makeExpense(id, { category: 'Catering', agreedAmount: '99.99' });
    const e = await makeExpense(id, { category: 'Flowers', agreedAmount: '0.01' });
    await makePayment(a.id, '0.07');
    await makePayment(b.id, '0.20');
    await makePayment(c.id, '0.03');
    await makePayment(d.id, '50.55');
    const rep = await get(t, 'reports/budget');
    const bud = await get(t, 'budget');
    expect(rep.totals).toEqual({
      totalBudget: bud.totalBudget, committed: bud.committed, paid: bud.paid, outstanding: bud.outstanding, remaining: bud.remaining,
    });
    expect(e.id).toBeTruthy();
    expect(rep.byCategory).toHaveLength(3);
    type Row = { committed: string; paid: string; outstanding: string; shareOfCommitted: number };
    const rows = rep.byCategory as Row[];
    const sum = (k: 'committed' | 'paid' | 'outstanding') => rows.reduce((s, r) => s.plus(r[k]), dec('0'));
    expect(sum('committed').toFixed(2)).toBe(rep.totals.committed);
    expect(sum('paid').toFixed(2)).toBe(rep.totals.paid);
    expect(sum('outstanding').toFixed(2)).toBe(rep.totals.outstanding);
    expect(rep.totals).toMatchObject({ committed: '433.63', paid: '50.85', outstanding: '382.78' });
    expect(rows.reduce((s, r) => s + r.shareOfCommitted, 0)).toBeLessThanOrEqual(100);
  });

  it('FR-58: whitespace-only differences merge into one category; zero-payment category is listed', async () => {
    const t = await setup();
    const id = t.wedding.id;
    await makeExpense(id, { category: 'Venue', agreedAmount: '10.00' });
    await makeExpense(id, { category: 'venue ', agreedAmount: '10.00' });
    await makeExpense(id, { category: ' VENUE', agreedAmount: '10.00' });
    await makeExpense(id, { category: 'Catering', agreedAmount: '5.00' });
    const rep = await get(t, 'reports/budget');
    expect(rep.byCategory).toHaveLength(2);
    expect(rep.byCategory[0]).toMatchObject({ expenseCount: 3, committed: '30.00', paid: '0.00', outstanding: '30.00' });
    expect(rep.byCategory[1]).toMatchObject({ category: 'Catering', paid: '0.00', outstanding: '5.00' });
  });

  it('FR-58: three equal categories give floor shares 33/33/33 (sum never above 100)', async () => {
    const t = await setup();
    for (const c of ['A', 'B', 'C']) await makeExpense(t.wedding.id, { category: c, agreedAmount: '10.00' });
    const rep = await get(t, 'reports/budget');
    expect(rep.byCategory.map((r: { shareOfCommitted: number }) => r.shareOfCommitted)).toEqual([33, 33, 33]);
  });

  it('NFR-14: concurrent payments never produce a dashboard where committed - paid != outstanding', async () => {
    const t = await setup('50000.00');
    const e = await makeExpense(t.wedding.id, { agreedAmount: '1000.00' });
    const writes = Array.from({ length: 12 }, (_, i) =>
      api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send({ amount: '10.05', paymentDate: '2026-01-01', notes: `p${i}` }),
    );
    const reads = Array.from({ length: 12 }, () => api().get(`${t.base}/dashboard`).set(t.o));
    const reports = Array.from({ length: 6 }, () => api().get(`${t.base}/reports/budget`).set(t.o));
    const [w, r, rp] = await Promise.all([Promise.all(writes), Promise.all(reads), Promise.all(reports)]);
    w.forEach((x) => expect(x.status).toBe(201));
    for (const res of r) {
      expect(res.status).toBe(200);
      const b = res.body.budget;
      expect(dec(b.committed).minus(b.paid).toFixed(2)).toBe(b.outstanding);
      expect(dec(b.totalBudget).minus(b.committed).toFixed(2)).toBe(b.remaining);
    }
    for (const res of rp) {
      expect(res.status).toBe(200);
      const tt = res.body.totals;
      expect(dec(tt.committed).minus(tt.paid).toFixed(2)).toBe(tt.outstanding);
      const c = res.body.byCategory[0];
      expect(dec(c.committed).minus(c.paid).toFixed(2)).toBe(c.outstanding);
    }
    const final = await get(t, 'dashboard');
    expect(final.budget).toMatchObject({ paid: '120.60', outstanding: '879.40' });
  });
});

describe('invitation counting edge cases (FR-57, BR-05)', () => {
  it('BR-05: PENDING counts as notSent, revoked+FAILED only revoked, counts sum to total', async () => {
    const t = await setup();
    const id = t.wedding.id;
    const gs = [];
    for (let i = 0; i < 6; i++) gs.push(await createGuest(id, { name: `G${i}` }));
    await inv(gs[0]!.id, 'PENDING');
    await inv(gs[1]!.id, 'FAILED', new Date());
    await inv(gs[2]!.id, 'SENT', new Date());
    await inv(gs[3]!.id, 'PENDING', new Date());
    await inv(gs[4]!.id, 'FAILED');
    const d = await get(t, 'dashboard');
    expect(d.guests.invitations).toEqual({ notSent: 2, sent: 0, failed: 1, revoked: 3 });
    const s = d.guests.invitations;
    expect(s.notSent + s.sent + s.failed + s.revoked).toBe(d.guests.total);
  });

  it('BR-05: revoke then resend moves the guest revoked -> sent, with a single invitation', async () => {
    setMailTransportForTests({ async sendMail() { return { messageId: 'x' }; } });
    const t = await setup();
    const g = await createGuest(t.wedding.id, { name: 'Rev' });
    await createGuest(t.wedding.id, { name: 'Other' });
    expect((await api().post(`${t.base}/guests/${g.id}/invitation/send`).set(t.o)).status).toBe(200);
    expect((await api().post(`${t.base}/guests/${g.id}/invitation/revoke`).set(t.o)).status).toBe(200);
    expect((await get(t, 'dashboard')).guests.invitations).toEqual({ notSent: 1, sent: 0, failed: 0, revoked: 1 });
    expect((await api().post(`${t.base}/guests/${g.id}/invitation/send`).set(t.o)).status).toBe(200);
    const d = await get(t, 'dashboard');
    expect(d.guests.invitations).toEqual({ notSent: 1, sent: 1, failed: 0, revoked: 0 });
    expect(await prisma.invitation.count({ where: { guestId: g.id } })).toBe(1);
  });

  it('BR-05: a failed send shows as failed on dashboard and as FAILED in the guest report', async () => {
    setMailTransportForTests({ async sendMail() { throw new Error('smtp down'); } });
    const t = await setup();
    const g = await createGuest(t.wedding.id, { name: 'Fail' });
    await api().post(`${t.base}/guests/${g.id}/invitation/send`).set(t.o);
    expect((await get(t, 'dashboard')).guests.invitations).toEqual({ notSent: 0, sent: 0, failed: 1, revoked: 0 });
    expect((await get(t, 'reports/guests')).guests[0].invitationStatus).toBe('FAILED');
  });
});

describe('isolation (BR-14, FR-11)', () => {
  it('BR-14: another wedding\'s guests, tasks, expenses, schedule and suppliers never leak', async () => {
    const t = await setup();
    const other = await setup('99999.00');
    const oid = other.wedding.id;
    const g = await createGuest(oid, { name: 'Leak' });
    await prisma.guest.update({ where: { id: g.id }, data: { rsvpStatus: 'ACCEPTED', dietaryRequirements: 'secret diet' } });
    await inv(g.id, 'SENT');
    await makeTask(oid, { assigneeId: t.owner.id, dueDate: day(-1) });
    const e = await makeExpense(oid, { category: 'Leak', agreedAmount: '777.00', dueDate: dateStr(-1) });
    await makePayment(e.id, '7.00');
    await createScheduleItem(oid, 'X', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    await prisma.supplier.create({ data: { weddingId: oid, name: 'S', category: 'c' } });

    const d = await get(t, 'dashboard');
    expect(d.guests).toMatchObject({ total: 0, accepted: 0, invitations: { sent: 0 } });
    expect(d.tasks).toMatchObject({ total: 0, overdue: 0, myOpenTasks: 0 });
    expect(d.budget).toMatchObject({ committed: '0.00', paid: '0.00', remaining: '20000.00', overdueExpenseCount: 0 });
    expect(d.schedule).toEqual({ items: 0, overlappingItems: 0 });
    expect(d.suppliers.total).toBe(0);
    expect(d.upcomingTasks).toEqual([]);
    const gr = await get(t, 'reports/guests');
    expect(gr.guests).toEqual([]);
    expect(JSON.stringify(gr)).not.toContain('secret diet');
    const br = await get(t, 'reports/budget');
    expect(br.byCategory).toEqual([]);
    expect(JSON.stringify(br)).not.toContain('Leak');
  });

  it('BR-14: myOpenTasks counts only the caller\'s open tasks in THIS wedding', async () => {
    const t = await setup();
    const other = await setup();
    await makeTask(t.wedding.id, { assigneeId: t.owner.id });
    await makeTask(t.wedding.id, { assigneeId: t.owner.id, status: 'COMPLETED' });
    await makeTask(t.wedding.id, { assigneeId: t.member.id });
    await prisma.weddingMember.create({ data: { weddingId: other.wedding.id, userId: t.owner.id } });
    await makeTask(other.wedding.id, { assigneeId: t.owner.id });
    await makeTask(other.wedding.id, { assigneeId: t.owner.id });
    expect((await get(t, 'dashboard')).tasks.myOpenTasks).toBe(1);
    expect((await get(t, 'dashboard', t.m)).tasks.myOpenTasks).toBe(1);
  });

  it('FR-13: a revoked member gets 404 on dashboard and both reports; a stranger and anonymous are rejected', async () => {
    const t = await setup();
    const { user: stranger } = await createUser();
    for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
      expect((await api().get(`${t.base}/${p}`).set(t.m)).status, p).toBe(200);
    }
    expect((await api().delete(`${t.base}/members/${t.member.id}`).set(t.o)).status).toBe(204);
    for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
      expect((await api().get(`${t.base}/${p}`).set(t.m)).status, p).toBe(404);
      expect((await api().get(`${t.base}/${p}`).set(bearer(stranger.id))).status, p).toBe(404);
      expect((await api().get(`${t.base}/${p}`).set({ Authorization: 'Bearer garbage' })).status, p).toBe(401);
    }
  });

  it('BR-14: unknown or malformed wedding id gives 404 (not 500) on dashboard and reports', async () => {
    const t = await setup();
    for (const wid of [randomUUID(), 'not-a-uuid']) {
      for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
        const r = await api().get(`/api/weddings/${wid}/${p}`).set(t.o);
        expect([400, 404], `${wid} ${p}`).toContain(r.status);
      }
    }
  });

  it('FR-18: dashboard and reports are read-only (POST/PATCH/DELETE are not routed)', async () => {
    const t = await setup();
    for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
      for (const m of ['post', 'patch', 'delete'] as const) {
        const r = await api()[m](`${t.base}/${p}`).set(t.o).send({});
        expect(r.status, `${m} ${p}`).toBeGreaterThanOrEqual(400);
        expect(r.status, `${m} ${p}`).toBeLessThan(500);
      }
    }
  });
});

describe('date edge cases (FR-35, FR-57)', () => {
  it('FR-35: task due today is dueNext7Days and not overdue; due yesterday + COMPLETED is neither overdue nor unfinished', async () => {
    const t = await setup();
    await makeTask(t.wedding.id, { title: 'today', dueDate: day(0) });
    await makeTask(t.wedding.id, { title: 'done', dueDate: day(-1), status: 'COMPLETED' });
    const d = await get(t, 'dashboard');
    expect(d.tasks).toMatchObject({ total: 2, overdue: 0, dueNext7Days: 1, unfinished: 1, completed: 1, percentComplete: 50 });
    const tasks = await get(t, 'tasks');
    expect(tasks.every((x: { isOverdue: boolean }) => !x.isOverdue)).toBe(true);
    expect(d.upcomingTasks.map((x: { title: string }) => x.title)).toEqual(['today']);
  });

  it('FR-57: wedding today has daysUntilWedding 0', async () => {
    const t = await setup('1000.00', 0);
    expect((await get(t, 'dashboard')).wedding.daysUntilWedding).toBe(0);
  });
});

describe('schedule counting (FR-55, BR-12)', () => {
  it('BR-12: A overlaps B and C (B, C disjoint) counts 3 overlapping items', async () => {
    const t = await setup();
    await createScheduleItem(t.wedding.id, 'A', '2027-06-19T10:00:00Z', '2027-06-19T14:00:00Z');
    await createScheduleItem(t.wedding.id, 'B', '2027-06-19T10:30:00Z', '2027-06-19T11:00:00Z');
    await createScheduleItem(t.wedding.id, 'C', '2027-06-19T12:00:00Z', '2027-06-19T13:00:00Z');
    await createScheduleItem(t.wedding.id, 'D', '2027-06-19T15:00:00Z', '2027-06-19T16:00:00Z');
    expect((await get(t, 'dashboard')).schedule).toEqual({ items: 4, overlappingItems: 3 });
  });

  it('BR-12: back-to-back items do not overlap', async () => {
    const t = await setup();
    await createScheduleItem(t.wedding.id, 'A', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    await createScheduleItem(t.wedding.id, 'B', '2027-06-19T11:00:00Z', '2027-06-19T12:00:00Z');
    expect((await get(t, 'dashboard')).schedule).toEqual({ items: 2, overlappingItems: 0 });
  });

  it('FR-59: dashboard overlap count matches the schedule list overlapsWith', async () => {
    const t = await setup();
    await createScheduleItem(t.wedding.id, 'A', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    await createScheduleItem(t.wedding.id, 'B', '2027-06-19T10:30:00Z', '2027-06-19T11:30:00Z');
    await createScheduleItem(t.wedding.id, 'C', '2027-06-19T18:00:00Z', '2027-06-19T19:00:00Z');
    const list = await get(t, 'schedule');
    const items = (Array.isArray(list) ? list : list.items) as { overlapsWith: string[] }[];
    expect((await get(t, 'dashboard')).schedule.overlappingItems).toBe(items.filter((i) => i.overlapsWith.length > 0).length);
  });
});

describe('guest report leakage (FR-30, NFR-06, NFR-08)', () => {
  it('FR-58: blank dietary notes are excluded; no id/token/tokenHash keys anywhere in the payload', async () => {
    const t = await setup();
    const id = t.wedding.id;
    const mk = async (name: string, diet: string | null) => {
      const g = await createGuest(id, { name });
      await prisma.guest.update({ where: { id: g.id }, data: { dietaryRequirements: diet } });
      await inv(g.id, 'SENT');
    };
    await mk('Empty', '');
    await mk('Spaces', '   ');
    await mk('Tabs', '\t \n');
    await mk('Real', 'gluten free');
    const res = await api().get(`${t.base}/reports/guests`).set(t.m);
    expect(res.status).toBe(200);
    expect(res.body.dietary.map((x: { name: string }) => x.name)).toEqual(['Real']);
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(res.body);
    for (const bad of ['id', 'guestId', 'token', 'tokenHash', 'invitationId', 'weddingId']) expect(keys.has(bad), bad).toBe(false);
    walk((await get(t, 'dashboard', t.m)).guests);
    expect(keys.has('tokenHash')).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/h-[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

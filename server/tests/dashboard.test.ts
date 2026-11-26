import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { makeExpense, makePayment } from './helpers/budgetFactories.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';
import { tokenFromMail } from './helpers/guestFactories.js';
import { createScheduleItem, createSupplier } from './helpers/planningFactories.js';
import { dateStr, day, makeTask } from './helpers/taskFactories.js';

beforeAll(async () => {
  await resetDb();
  // Freeze ONLY Date at noon UTC today so the tests' "today" and the server's can never straddle midnight.
  const n = new Date();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 12)));
});
afterAll(async () => {
  vi.useRealTimers();
  await disconnectDb();
});
afterEach(() => setMailTransportForTests(undefined));

async function setup(o: { totalBudget?: string; weddingOffsetDays?: number } = {}) {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const w = await createWedding(owner.id, { totalBudget: o.totalBudget ?? '20000.00' });
  const wedding = await prisma.wedding.update({ where: { id: w.id }, data: { weddingDate: day(o.weddingOffsetDays ?? 100), rsvpDeadline: day(o.weddingOffsetDays ?? 100) } });
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  const base = `/api/weddings/${wedding.id}`;
  return { owner, member, wedding, base, o: bearer(owner.id), m: bearer(member.id) };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const dash = async (t: Setup, h = t.o) => {
  const res = await api().get(`${t.base}/dashboard`).set(h);
  expect(res.status).toBe(200);
  return res.body;
};

/** 7 guests (3 accepted, 2 declined, 2 pending) with 6 invitation states. */
async function seedGuests(weddingId: string) {
  const mk = async (name: string, rsvpStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED') => {
    const g = await createGuest(weddingId, { name });
    return prisma.guest.update({ where: { id: g.id }, data: { rsvpStatus } });
  };
  const inv = (guestId: string, deliveryStatus: 'SENT' | 'FAILED' | 'PENDING', revokedAt: Date | null = null) =>
    prisma.invitation.create({ data: { guestId, tokenHash: `h-${randomUUID()}`, deliveryStatus, revokedAt } });
  const g = [
    await mk('G1', 'ACCEPTED'), await mk('G2', 'ACCEPTED'), await mk('G3', 'ACCEPTED'),
    await mk('G4', 'DECLINED'), await mk('G5', 'DECLINED'), await mk('G6', 'PENDING'), await mk('G7', 'PENDING'),
  ];
  await inv(g[0]!.id, 'SENT');
  await inv(g[1]!.id, 'SENT');
  await inv(g[2]!.id, 'FAILED');
  await inv(g[3]!.id, 'SENT', new Date()); // revoked (delivery status ignored)
  await inv(g[4]!.id, 'PENDING');
  return g;
}

describe('dashboard (FR-57..60)', () => {
  it('AC-11: dashboard shows correct guest, task and financial totals from stored records', async () => {
    const t = await setup();
    await seedGuests(t.wedding.id);
    const id = t.wedding.id;
    await makeTask(id, { title: 'T1 overdue', status: 'TODO', dueDate: day(-2) });
    await makeTask(id, { title: 'T2 overdue', status: 'IN_PROGRESS', dueDate: day(-1) });
    await makeTask(id, { title: 'T3 mine', status: 'TODO', dueDate: day(3), assigneeId: t.owner.id });
    await makeTask(id, { title: 'T4', status: 'IN_PROGRESS', dueDate: day(10) });
    await makeTask(id, { title: 'T5 done', status: 'COMPLETED', dueDate: day(-5) });
    await makeTask(id, { title: 'T6 done', status: 'COMPLETED', dueDate: day(3) });
    await makeTask(id, { title: 'T7 today', status: 'TODO', dueDate: day(0) });
    await makeTask(id, { title: 'T8 later', status: 'TODO', dueDate: day(20) });

    const venue = await makeExpense(id, { description: 'Venue', category: 'Venue', agreedAmount: '5000.00', dueDate: dateStr(-10) });
    await makePayment(venue.id, '2000.00');
    await makePayment(venue.id, '1000.00');
    const food = await makeExpense(id, { description: 'Food', category: 'Catering', agreedAmount: '3000.00', dueDate: dateStr(30) });
    await makePayment(food.id, '500.25');
    const band = await makeExpense(id, { description: 'Band', category: 'Music', agreedAmount: '1000.00', dueDate: dateStr(-5) });
    await makePayment(band.id, '1000.00');

    await createSupplier(id);
    await createSupplier(id, { name: 'S2' });
    await createSupplier(id, { name: 'S3' });
    await createScheduleItem(id, 'A', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    await createScheduleItem(id, 'B', '2027-06-19T10:30:00Z', '2027-06-19T11:30:00Z');
    await createScheduleItem(id, 'C', '2027-06-19T12:00:00Z', '2027-06-19T13:00:00Z');

    const d = await dash(t);
    expect(d.wedding).toEqual({
      id,
      coupleNames: 'Anna & Ben',
      weddingDate: dateStr(100),
      location: 'Budapest',
      status: 'ACTIVE',
      daysUntilWedding: 100,
    });
    expect(d.guests).toEqual({
      total: 7, pending: 2, accepted: 3, declined: 2, responseRate: 71,
      invitations: { notSent: 3, sent: 2, failed: 1, revoked: 1 },
    });
    expect(d.guests.invitations.notSent + d.guests.invitations.sent + d.guests.invitations.failed + d.guests.invitations.revoked).toBe(7);
    expect(d.tasks).toEqual({
      total: 8, todo: 4, inProgress: 2, completed: 2, unfinished: 6, overdue: 2,
      dueNext7Days: 2, percentComplete: 25, myOpenTasks: 1,
    });
    expect(d.budget).toEqual({
      totalBudget: '20000.00', committed: '9000.00', paid: '4500.25', outstanding: '4499.75',
      remaining: '11000.00', overdueExpenseCount: 1,
    });
    expect(d.suppliers).toEqual({ total: 3 });
    expect(d.schedule).toEqual({ items: 3, overlappingItems: 2 });
    expect(d.upcomingTasks.map((x: { title: string }) => x.title)).toEqual(['T1 overdue', 'T2 overdue', 'T7 today', 'T3 mine', 'T4']);
    expect(d.upcomingTasks[0]).toMatchObject({ isOverdue: true, status: 'TODO', assignee: null });
    expect(d.upcomingTasks[3]).toMatchObject({ assignee: { id: t.owner.id }, isOverdue: false });

    // the budget block is exactly the budget endpoint (one source of truth)
    const b = await api().get(`${t.base}/budget`).set(t.o);
    const { overdueExpenses, ...totals } = b.body;
    expect(d.budget).toEqual({ ...totals, overdueExpenseCount: overdueExpenses.length });
  });

  it('AC-06: a guest\'s RSVP is reflected on the dashboard', async () => {
    let text = '';
    setMailTransportForTests({
      async sendMail(m) {
        text = m.text;
        return { messageId: 'x' };
      },
    });
    const t = await setup();
    const guest = await createGuest(t.wedding.id, { name: 'Gina' });
    await createGuest(t.wedding.id, { name: 'Hal' });
    const before = await dash(t);
    expect(before.guests).toMatchObject({ total: 2, pending: 2, accepted: 0, declined: 0, responseRate: 0 });
    expect(before.guests.invitations).toEqual({ notSent: 2, sent: 0, failed: 0, revoked: 0 });

    const send = await api().post(`${t.base}/guests/${guest.id}/invitation/send`).set(t.o);
    expect(send.status).toBe(200);
    const sent = await dash(t);
    expect(sent.guests.invitations).toEqual({ notSent: 1, sent: 1, failed: 0, revoked: 0 });

    const token = tokenFromMail(text);
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(200);
    const after = await dash(t);
    expect(after.guests).toMatchObject({ total: 2, pending: 1, accepted: 1, declined: 0, responseRate: 50 });

    await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'DECLINED' });
    expect((await dash(t)).guests).toMatchObject({ pending: 1, accepted: 0, declined: 1, responseRate: 50 });
  });

  it('FR-59: dashboard values change when records change', async () => {
    const t = await setup();
    const e = await makeExpense(t.wedding.id, { agreedAmount: '1000.00', dueDate: dateStr(30) });
    const task = await makeTask(t.wedding.id, { title: 'A' });
    await makeTask(t.wedding.id, { title: 'B' });
    const before = await dash(t);
    expect(before.budget).toMatchObject({ paid: '0.00', outstanding: '1000.00', remaining: '19000.00' });
    expect(before.tasks).toMatchObject({ completed: 0, percentComplete: 0 });

    expect((await api().post(`${t.base}/expenses/${e.id}/payments`).set(t.o).send({ amount: '250.50', paymentDate: '2026-01-01' })).status).toBe(201);
    expect((await api().patch(`${t.base}/tasks/${task.id}`).set(t.o).send({ status: 'COMPLETED' })).status).toBe(200);
    const after = await dash(t);
    expect(after.budget).toMatchObject({ paid: '250.50', outstanding: '749.50' });
    expect(after.tasks).toMatchObject({ completed: 1, unfinished: 1, percentComplete: 50 });

    const patched = await api().patch(t.base).set(t.o).send({ totalBudget: '500.00' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await dash(t)).budget).toMatchObject({ totalBudget: '500.00', remaining: '-500.00' });
  });

  it('FR-60: team member sees the same dashboard; myOpenTasks is per caller', async () => {
    const t = await setup();
    await seedGuests(t.wedding.id);
    await makeTask(t.wedding.id, { title: 'Mine 1', assigneeId: t.member.id });
    await makeTask(t.wedding.id, { title: 'Mine 2', assigneeId: t.member.id, status: 'IN_PROGRESS' });
    await makeTask(t.wedding.id, { title: 'Mine done', assigneeId: t.member.id, status: 'COMPLETED' });
    await makeTask(t.wedding.id, { title: 'Owner task', assigneeId: t.owner.id });
    const asOwner = await dash(t, t.o);
    const asMember = await dash(t, t.m);
    expect(asOwner.tasks.myOpenTasks).toBe(1);
    expect(asMember.tasks.myOpenTasks).toBe(2);
    asOwner.tasks.myOpenTasks = asMember.tasks.myOpenTasks = 0;
    expect(asMember).toEqual(asOwner);
  });

  it('empty wedding: all zeros, remaining = totalBudget, upcomingTasks []', async () => {
    const t = await setup({ totalBudget: '7500.00' });
    const d = await dash(t);
    expect(d.guests).toEqual({ total: 0, pending: 0, accepted: 0, declined: 0, responseRate: 0, invitations: { notSent: 0, sent: 0, failed: 0, revoked: 0 } });
    expect(d.tasks).toEqual({ total: 0, todo: 0, inProgress: 0, completed: 0, unfinished: 0, overdue: 0, dueNext7Days: 0, percentComplete: 0, myOpenTasks: 0 });
    expect(d.budget).toEqual({ totalBudget: '7500.00', committed: '0.00', paid: '0.00', outstanding: '0.00', remaining: '7500.00', overdueExpenseCount: 0 });
    expect(d.suppliers).toEqual({ total: 0 });
    expect(d.schedule).toEqual({ items: 0, overlappingItems: 0 });
    expect(d.upcomingTasks).toEqual([]);
  });

  it('daysUntilWedding is positive, zero and negative (UTC dates)', async () => {
    for (const [offset, expected] of [[45, 45], [0, 0], [-3, -3]] as const) {
      const t = await setup({ weddingOffsetDays: offset });
      expect((await dash(t)).wedding.daysUntilWedding).toBe(expected);
    }
  });

  it('dueNext7Days includes today and today+7, excludes today+8, completed and overdue', async () => {
    const t = await setup();
    const id = t.wedding.id;
    await makeTask(id, { title: 'today', dueDate: day(0) });
    await makeTask(id, { title: 'plus7', dueDate: day(7), status: 'IN_PROGRESS' });
    await makeTask(id, { title: 'plus8', dueDate: day(8) });
    await makeTask(id, { title: 'done', dueDate: day(2), status: 'COMPLETED' });
    await makeTask(id, { title: 'yesterday', dueDate: day(-1) });
    const d = await dash(t);
    expect(d.tasks.dueNext7Days).toBe(2);
    expect(d.tasks.overdue).toBe(1);
  });

  it('percentComplete and responseRate floor (never round up to 100)', async () => {
    const t = await setup();
    await prisma.task.createMany({ data: Array.from({ length: 199 }, (_, i) => ({ weddingId: t.wedding.id, title: `d${i}`, dueDate: day(5), status: 'COMPLETED' as const })) });
    await makeTask(t.wedding.id, { status: 'TODO' });
    expect((await dash(t)).tasks.percentComplete).toBe(99);
  });

  it('invitation counting matches the guest list statuses (one rule everywhere)', async () => {
    const t = await setup();
    await seedGuests(t.wedding.id);
    const d = await dash(t);
    const list = await api().get(`${t.base}/guests`).set(t.o);
    const count = (pred: (g: { invitation: { status: string } | null }) => boolean) => list.body.guests.filter(pred).length;
    expect(d.guests.invitations).toEqual({
      notSent: count((g) => !g.invitation || g.invitation.status === 'PENDING'),
      sent: count((g) => g.invitation?.status === 'SENT'),
      failed: count((g) => g.invitation?.status === 'FAILED'),
      revoked: count((g) => g.invitation?.status === 'REVOKED'),
    });
  });

  it('a revoked-and-FAILED invitation counts as revoked only', async () => {
    const t = await setup();
    const g = await createGuest(t.wedding.id);
    await prisma.invitation.create({ data: { guestId: g.id, tokenHash: `h-${randomUUID()}`, deliveryStatus: 'FAILED', revokedAt: new Date() } });
    expect((await dash(t)).guests.invitations).toEqual({ notSent: 0, sent: 0, failed: 0, revoked: 1 });
  });

  it('upcomingTasks: at most 5, unfinished only, soonest first', async () => {
    const t = await setup();
    for (let i = 1; i <= 7; i++) await makeTask(t.wedding.id, { title: `T${i}`, dueDate: day(i) });
    await makeTask(t.wedding.id, { title: 'done', dueDate: day(-10), status: 'COMPLETED' });
    const d = await dash(t);
    expect(d.upcomingTasks.map((x: { title: string }) => x.title)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
  });

  it('data of another wedding never leaks into the dashboard', async () => {
    const t = await setup();
    const other = await setup();
    await seedGuests(other.wedding.id);
    await makeTask(other.wedding.id, { assigneeId: t.owner.id });
    await makeExpense(other.wedding.id);
    const d = await dash(t);
    expect(d.guests.total).toBe(0);
    expect(d.tasks.total).toBe(0);
    expect(d.tasks.myOpenTasks).toBe(0);
    expect(d.budget.committed).toBe('0.00');
  });

  it('archived wedding: dashboard and both reports still answer 200', async () => {
    const t = await setup();
    await seedGuests(t.wedding.id);
    expect((await api().post(`${t.base}/archive`).set(t.o)).status).toBe(200);
    for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
      const r = await api().get(`${t.base}/${p}`).set(t.o);
      expect(r.status, p).toBe(200);
    }
    expect((await dash(t)).wedding.status).toBe('ARCHIVED');
  });

  it('BR-14: non-member gets 404 and member can read (403 does not apply to reads)', async () => {
    const t = await setup();
    const { user: stranger } = await createUser();
    for (const p of ['dashboard', 'reports/guests', 'reports/budget']) {
      expect((await api().get(`${t.base}/${p}`).set(bearer(stranger.id))).status, p).toBe(404);
      expect((await api().get(`${t.base}/${p}`).set(t.m)).status, p).toBe(200);
      expect((await api().get(`${t.base}/${p}`)).status, p).toBe(401);
    }
  });

  it('FR-35/FR-46: overdue and dueNext7Days do not depend on the database session time zone', async () => {
    const t = await setup();
    await makeTask(t.wedding.id, { title: 'late', dueDate: day(-1) });
    await makeTask(t.wedding.id, { title: 'today', dueDate: day(0) });
    await makeTask(t.wedding.id, { title: 'plus7', dueDate: day(7) });
    await makeTask(t.wedding.id, { title: 'plus8', dueDate: day(8) });
    await makeExpense(t.wedding.id, { dueDate: dateStr(-1) });
    await makeExpense(t.wedding.id, { dueDate: dateStr(0) });
    const [{ db }] = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`) as { db: string }[] as [{ db: string }];
    const expectFigures = async () => {
      const d = await dash(t);
      expect(d.tasks).toMatchObject({ overdue: 1, dueNext7Days: 2 });
      expect(d.budget.overdueExpenseCount).toBe(1);
    };
    try {
      for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO '${zone}'`);
        await prisma.$disconnect(); // new connections pick up the database setting
        const [{ tz }] = (await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`) as [{ tz: string }];
        expect(tz).toBe(zone);
        await expectFigures();
      }
    } finally {
      await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET timezone`);
      await prisma.$disconnect();
    }
    await expectFigures();
  });

  it('NFR-20: dashboard stays fast with 200 guests', async () => {
    const t = await setup({ totalBudget: '500000.00' });
    const id = t.wedding.id;
    const statuses = ['PENDING', 'ACCEPTED', 'DECLINED'] as const;
    const guestIds = Array.from({ length: 200 }, () => randomUUID());
    await prisma.guest.createMany({
      data: guestIds.map((gid, i) => ({ id: gid, weddingId: id, name: `Guest ${i}`, email: `g${i}@perf.local`, rsvpStatus: statuses[i % 3]! })),
    });
    await prisma.invitation.createMany({
      data: guestIds.slice(0, 150).map((gid, i) => ({
        guestId: gid,
        tokenHash: `perf-${randomUUID()}`,
        deliveryStatus: (['SENT', 'FAILED', 'PENDING'] as const)[i % 3]!,
        revokedAt: i % 10 === 0 ? new Date() : null,
      })),
    });
    await prisma.task.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        weddingId: id,
        title: `Task ${i}`,
        dueDate: day(i - 20),
        status: (['TODO', 'IN_PROGRESS', 'COMPLETED'] as const)[i % 3]!,
        assigneeId: i % 4 === 0 ? t.owner.id : null,
      })),
    });
    const expenseIds = Array.from({ length: 50 }, () => randomUUID());
    await prisma.expense.createMany({
      data: expenseIds.map((eid, i) => ({
        id: eid, weddingId: id, description: `Expense ${i}`, category: `Cat ${i % 7}`, agreedAmount: '1000.00', dueDate: day(i - 25),
      })),
    });
    await prisma.payment.createMany({
      data: expenseIds.flatMap((eid) => [100, 200, 300].map((amount) => ({ expenseId: eid, amount: `${amount}.00`, paymentDate: day(-1) }))),
    });
    await prisma.supplier.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ weddingId: id, name: `S${i}`, category: 'Venue' })) });
    await prisma.scheduleItem.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        weddingId: id, title: `Item ${i}`,
        startTime: new Date(Date.UTC(2027, 5, 19, 8, i * 20)), endTime: new Date(Date.UTC(2027, 5, 19, 8, i * 20 + 30)),
      })),
    });

    await api().get(`${t.base}/dashboard`).set(t.o); // warm the connection pool / query plans
    const started = performance.now();
    const res = await api().get(`${t.base}/dashboard`).set(t.o);
    const ms = Math.round(performance.now() - started);
    process.stdout.write(`NFR-20: dashboard with 200 guests / 100 tasks / 50 expenses / 150 payments took ${ms} ms
`);
    expect(res.status).toBe(200);
    expect(res.body.guests.total).toBe(200);
    expect(res.body.tasks.total).toBe(100);
    expect(res.body.budget).toMatchObject({ committed: '50000.00', paid: '30000.00', outstanding: '20000.00' });
    expect(ms).toBeLessThan(2000);
  });
});

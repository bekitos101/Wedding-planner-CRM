import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createExpense, createGuest, createUser, createWedding } from './helpers/factories.js';
import { tokenFromMail } from './helpers/guestFactories.js';
import { makeExpense, makePayment } from './helpers/budgetFactories.js';
import { createScheduleItem, createSupplier } from './helpers/planningFactories.js';
import { dateStr, day, makeTask, setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(() => setMailTransportForTests(undefined));

let lastText = '';
const installMail = () =>
  setMailTransportForTests({
    async sendMail(m) {
      lastText = m.text;
      return { messageId: 'x' };
    },
  });

const w = (id: string, rest = '') => `/api/weddings/${id}${rest}`;

async function twoWeddings() {
  const { user: ownerA } = await createUser();
  const { user: ownerB } = await createUser();
  const A = await createWedding(ownerA.id);
  const B = await createWedding(ownerB.id);
  return { ownerA, ownerB, A, B, h: bearer(ownerA.id) };
}

describe('AC/BR coverage gaps', () => {
  it("AC-04: team member cannot update another member's task via direct API (403, unchanged)", async () => {
    const { member, other, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: other.id });
    const res = await api().patch(w(wedding.id, `/tasks/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(res.status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('TODO');
  });

  it('BR-11: a failed invitation email is recorded as FAILED and can be retried via resend', async () => {
    const { user: owner } = await createUser();
    const wedding = await createWedding(owner.id);
    const guest = await createGuest(wedding.id);
    setMailTransportForTests({
      async sendMail() {
        throw new Error('smtp down');
      },
    });
    const url = w(wedding.id, `/guests/${guest.id}/invitation/send`);
    const first = await api().post(url).set(bearer(owner.id));
    expect(first.status).toBe(200);
    expect(first.body.invitation.status).toBe('FAILED');
    installMail();
    const retry = await api().post(url).set(bearer(owner.id));
    expect(retry.body.invitation.status).toBe('SENT');
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1);
  });
});

describe('IDOR across tracks (BR-14)', () => {
  it('BR-14: ids of wedding B under wedding A (as A owner) → 404 and B unchanged', async () => {
    const { ownerB, A, B, h } = await twoWeddings();
    const guest = await createGuest(B.id, { name: 'Bee' });
    const task = await makeTask(B.id, { title: 'B task' });
    const exp = await makeExpense(B.id);
    const pay = await makePayment(exp.id, '100.00');
    const sup = await createSupplier(B.id, { name: 'B sup' });
    const item = await createScheduleItem(B.id, 'B item', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    const base = w(A.id);
    const cases: [string, string, object?][] = [
      ['get', `/expenses/${exp.id}`],
      ['patch', `/guests/${guest.id}`, { name: 'Hacked' }],
      ['delete', `/guests/${guest.id}`],
      ['patch', `/tasks/${task.id}`, { title: 'Hacked' }],
      ['delete', `/tasks/${task.id}`],
      ['patch', `/expenses/${exp.id}`, { description: 'Hacked' }],
      ['delete', `/expenses/${exp.id}`],
      ['post', `/expenses/${exp.id}/payments`, { amount: '1.00', paymentDate: '2026-01-01' }],
      ['patch', `/expenses/${exp.id}/payments/${pay.id}`, { amount: '1.00' }],
      ['delete', `/expenses/${exp.id}/payments/${pay.id}`],
      ['patch', `/suppliers/${sup.id}`, { name: 'Hacked' }],
      ['delete', `/suppliers/${sup.id}`],
      ['patch', `/schedule/${item.id}`, { title: 'Hacked' }],
      ['delete', `/schedule/${item.id}`],
    ];
    for (const [m, path, body] of cases) {
      const r = await (api() as any)[m](base + path).set(h).send(body);
      expect(r.status, `${m} ${path}`).toBe(404);
    }
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).name).toBe('Bee');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe('B task');
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: exp.id } })).description).toBe('Venue');
    expect(Number((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).amount)).toBe(100);
    expect(await prisma.payment.count({ where: { expenseId: exp.id } })).toBe(1);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: sup.id } })).name).toBe('B sup');
    expect((await prisma.scheduleItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe('B item');
    const list = await api().get(w(B.id, '/expenses')).set(bearer(ownerB.id));
    expect(list.body).toHaveLength(1);
  });

  it('BR-14: payment of expense X addressed under expense Y of the same wedding → 404', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const x = await createExpense(wd.id);
    const y = await createExpense(wd.id);
    const p = await makePayment(x.id, '50.00');
    const h = bearer(owner.id);
    expect((await api().patch(w(wd.id, `/expenses/${y.id}/payments/${p.id}`)).set(h).send({ amount: '1.00' })).status).toBe(404);
    expect((await api().delete(w(wd.id, `/expenses/${y.id}/payments/${p.id}`)).set(h)).status).toBe(404);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.expenseId).toBe(x.id);
    expect(Number(row.amount)).toBe(50);
  });
});

describe('revoke interplay (FR-13 + BR-03)', () => {
  it('BR-03: revoked member loses access to their tasks; re-adding does not reassign', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    const o = bearer(owner.id);
    expect((await api().delete(w(wedding.id, `/members/${member.id}`)).set(o)).status).toBe(204);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBeNull();
    const r = await api().patch(w(wedding.id, `/tasks/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(r.status).toBe(404);
    expect((await api().get(w(wedding.id, '/tasks')).set(bearer(member.id))).status).toBe(404);
    const re = await api().post(w(wedding.id, '/members')).set(o).send({ email: member.email });
    expect([200, 201]).toContain(re.status);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
    const again = await api().patch(w(wedding.id, `/tasks/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(again.status).toBe(403);
  });

  it('BR-03: owner assigning a task to a revoked member → 400', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id);
    await api().delete(w(wedding.id, `/members/${member.id}`)).set(bearer(owner.id));
    const r = await api().patch(w(wedding.id, `/tasks/${t.id}`)).set(bearer(owner.id)).send({ assigneeId: member.id });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.assigneeId).toBeDefined();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).assigneeId).toBeNull();
  });
});

describe('archive interplay (BR-13)', () => {
  it('BR-13: after archiving every phase-3 write → 409, reads 200, public RSVP 410, send 409', async () => {
    installMail();
    const { owner, member, wedding } = await setupTaskWedding();
    const o = bearer(owner.id);
    const guest = await createGuest(wedding.id);
    const sent = await api().post(w(wedding.id, `/guests/${guest.id}/invitation/send`)).set(o);
    expect(sent.status).toBe(200);
    const token = tokenFromMail(lastText);
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    const exp = await makeExpense(wedding.id);
    const pay = await makePayment(exp.id, '10.00');
    const sup = await createSupplier(wedding.id);
    const item = await createScheduleItem(wedding.id, 'x', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    const tpl = await prisma.checklistTemplate.create({
      data: { name: 'T', items: { create: [{ sortOrder: 1, title: 'i', daysBeforeWedding: 3 }] } },
    });
    expect((await api().post(w(wedding.id, '/archive')).set(o)).status).toBe(200);

    const writes: [string, string, object?][] = [
      ['post', '/guests', { name: 'N', email: 'n@test.local' }],
      ['patch', `/guests/${guest.id}`, { name: 'X' }],
      ['delete', `/guests/${guest.id}`],
      ['post', `/guests/${guest.id}/invitation/send`],
      ['post', `/guests/${guest.id}/invitation/revoke`],
      ['post', '/tasks', { title: 'T', dueDate: dateStr(5) }],
      ['patch', `/tasks/${task.id}`, { title: 'X' }],
      ['delete', `/tasks/${task.id}`],
      ['post', `/checklist-templates/${tpl.id}/apply`, {}],
      ['post', '/expenses', { description: 'd', category: 'c', agreedAmount: '5', dueDate: dateStr(5) }],
      ['patch', `/expenses/${exp.id}`, { description: 'X' }],
      ['delete', `/expenses/${exp.id}`],
      ['post', `/expenses/${exp.id}/payments`, { amount: '1', paymentDate: dateStr(-1) }],
      ['patch', `/expenses/${exp.id}/payments/${pay.id}`, { amount: '2' }],
      ['delete', `/expenses/${exp.id}/payments/${pay.id}`],
      ['post', '/suppliers', { name: 'S', category: 'C' }],
      ['patch', `/suppliers/${sup.id}`, { name: 'X' }],
      ['delete', `/suppliers/${sup.id}`],
      ['post', '/schedule', { title: 'S', startTime: '2027-06-19T12:00:00Z', endTime: '2027-06-19T13:00:00Z' }],
      ['patch', `/schedule/${item.id}`, { title: 'X' }],
      ['delete', `/schedule/${item.id}`],
    ];
    for (const [m, p, body] of writes) {
      const r = await (api() as any)[m](w(wedding.id, p)).set(o).send(body);
      expect(r.status, `${m} ${p}`).toBe(409);
    }
    expect(
      (await api().patch(w(wedding.id, `/tasks/${task.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status,
    ).toBe(409);
    for (const p of ['/guests', '/tasks', '/expenses', `/expenses/${exp.id}`, '/budget', '/suppliers', '/schedule']) {
      expect((await api().get(w(wedding.id, p)).set(o)).status, p).toBe(200);
    }
    expect(await prisma.guest.count({ where: { weddingId: wedding.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { expenseId: exp.id } })).toBe(1);
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(410);
    const post = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' });
    expect(post.status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });
});

describe('RSVP boundaries and token lifecycle (AC-07, BR-06, FR-30)', () => {
  async function inviteWithDeadline(offsetDays: number) {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    await prisma.wedding.update({ where: { id: wd.id }, data: { rsvpDeadline: day(offsetDays) } });
    const guest = await createGuest(wd.id, { name: 'Gina', email: 'gina@test.local' });
    const token = generateToken();
    await prisma.invitation.create({
      data: { guestId: guest.id, tokenHash: hashToken(token), deliveryStatus: 'SENT', attemptCount: 1 },
    });
    return { owner, wd, guest, token };
  }

  it('AC-07: deadline = today (UTC) is still open for GET and POST', async () => {
    const { token } = await inviteWithDeadline(0);
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(200);
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(200);
  });

  it('AC-07: deadline = yesterday → 410 for GET and POST, answer unchanged', async () => {
    const { token, guest } = await inviteWithDeadline(-1);
    const g = await api().get(`/api/rsvp/${token}`);
    expect(g.status).toBe(410);
    expect(g.body.error.code).toBe('RSVP_CLOSED');
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('AC-07: deadline = tomorrow is open', async () => {
    const { token } = await inviteWithDeadline(1);
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(200);
  });

  it('AC-07: RSVP after the guest was deleted → 404 and the invitation row is gone', async () => {
    const { owner, wd, guest, token } = await inviteWithDeadline(5);
    expect((await api().delete(w(wd.id, `/guests/${guest.id}`)).set(bearer(owner.id))).status).toBe(204);
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(404);
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(404);
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(0);
  });

  it('BR-05: after resend the old token → 404, the new one works', async () => {
    installMail();
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const guest = await createGuest(wd.id);
    const url = w(wd.id, `/guests/${guest.id}/invitation/send`);
    await api().post(url).set(bearer(owner.id));
    const oldTok = tokenFromMail(lastText);
    await api().post(url).set(bearer(owner.id));
    const newTok = tokenFromMail(lastText);
    expect(newTok).not.toBe(oldTok);
    expect((await api().get(`/api/rsvp/${oldTok}`)).status).toBe(404);
    expect((await api().post(`/api/rsvp/${oldTok}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(404);
    expect((await api().get(`/api/rsvp/${newTok}`)).status).toBe(200);
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('FR-30: RsvpView has exactly the documented keys, no ids/emails/other guests', async () => {
    const { token, wd } = await inviteWithDeadline(5);
    await createGuest(wd.id, { name: 'Other Person', email: 'other@test.local' });
    const res = await api().get(`/api/rsvp/${token}`);
    expect(Object.keys(res.body).sort()).toEqual([
      'coupleNames',
      'dietaryRequirements',
      'guestName',
      'location',
      'rsvpDeadline',
      'rsvpStatus',
      'weddingDate',
    ]);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('other@test.local');
    expect(text).not.toContain('gina@test.local');
    expect(text).not.toContain('Other Person');
    expect(text).not.toContain(wd.id);
    const post = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'DECLINED' });
    expect(Object.keys(post.body).sort()).toEqual(Object.keys(res.body).sort());
  });

  it('AC-07: tampered token variants → 404 with no data', async () => {
    const { token } = await inviteWithDeadline(5);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const t of [flipped, token + 'x', 'xxxxx', '%00', "' OR 1=1 --"]) {
      const r = await api().get(`/api/rsvp/${encodeURIComponent(t)}`);
      expect(r.status, t).toBe(404);
    }
  });

  it('AC-07: a stored hash is not usable as a token', async () => {
    const { token } = await inviteWithDeadline(5);
    expect((await api().get(`/api/rsvp/${encodeURIComponent(hashToken(token))}`)).status).toBe(404);
  });
});

describe('task member PATCH edge cases (BR-03)', () => {
  it('BR-03: empty body as member never 500s and changes nothing', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id, title: 'Keep', progressNotes: 'n' });
    const r = await api().patch(w(wedding.id, `/tasks/${t.id}`)).set(bearer(member.id)).send({});
    expect([200, 400]).toContain(r.status);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ title: 'Keep', progressNotes: 'n', status: 'TODO', assigneeId: member.id, priority: 'MEDIUM' });
  });

  it('BR-03: {status, progressNotes, assigneeId:null} → 403 and nothing changes', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    const r = await api()
      .patch(w(wedding.id, `/tasks/${t.id}`))
      .set(bearer(member.id))
      .send({ status: 'COMPLETED', progressNotes: 'x', assigneeId: null });
    expect(r.status).toBe(403);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: 'TODO', progressNotes: null, assigneeId: member.id });
  });

  it('BR-03: member sending protected keys with unchanged values → 403 (each key)', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    const extras = [{ title: 'Task' }, { priority: 'MEDIUM' }, { dueDate: dateStr(10) }, { description: null }, { completedAt: null }];
    for (const body of extras) {
      const r = await api()
        .patch(w(wedding.id, `/tasks/${t.id}`))
        .set(bearer(member.id))
        .send({ status: 'IN_PROGRESS', ...body });
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('TODO');
  });
});

describe('budget exactness (BR-07, BR-08, FR-45)', () => {
  it('BR-08: payment edits lowering then raising keep totals exact', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id, { totalBudget: '5000.00' });
    const e = await makeExpense(wd.id, { agreedAmount: '1000.10' });
    const h = bearer(owner.id);
    const p1 = await api().post(w(wd.id, `/expenses/${e.id}/payments`)).set(h).send({ amount: '0.10', paymentDate: '2026-01-01' });
    const p2 = await api().post(w(wd.id, `/expenses/${e.id}/payments`)).set(h).send({ amount: '0.20', paymentDate: '2026-01-02' });
    expect(p2.body).toMatchObject({ totalPaid: '0.30', outstanding: '999.80' });
    const pid = p1.body.payments[0].id;
    const lower = await api().patch(w(wd.id, `/expenses/${e.id}/payments/${pid}`)).set(h).send({ amount: '0.01' });
    expect(lower.body).toMatchObject({ totalPaid: '0.21', outstanding: '999.89' });
    const raise = await api().patch(w(wd.id, `/expenses/${e.id}/payments/${pid}`)).set(h).send({ amount: '800.10' });
    expect(raise.body).toMatchObject({ totalPaid: '800.30', outstanding: '199.80' });
    const b = await api().get(w(wd.id, '/budget')).set(h);
    expect(b.body).toMatchObject({
      totalBudget: '5000.00',
      committed: '1000.10',
      paid: '800.30',
      outstanding: '199.80',
      remaining: '3999.90',
    });
  });

  it('AC-08: zero, negative, and malformed payment amounts → 400 and nothing stored', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const e = await makeExpense(wd.id);
    for (const amount of ['0', 0, '-5', -0.01, 'abc', '1.234', null]) {
      const r = await api()
        .post(w(wd.id, `/expenses/${e.id}/payments`))
        .set(bearer(owner.id))
        .send({ amount, paymentDate: '2026-01-01' });
      expect(r.status, String(amount)).toBe(400);
    }
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(0);
  });

  it('BR-08: deleting an expense removes its payments from the summary', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id, { totalBudget: '3000.00' });
    const e1 = await makeExpense(wd.id, { agreedAmount: '1000.00' });
    const e2 = await makeExpense(wd.id, { agreedAmount: '500.00' });
    await makePayment(e1.id, '400.00');
    await makePayment(e2.id, '100.00');
    const h = bearer(owner.id);
    expect((await api().get(w(wd.id, '/budget')).set(h)).body).toMatchObject({
      committed: '1500.00',
      paid: '500.00',
      outstanding: '1000.00',
      remaining: '1500.00',
    });
    expect((await api().delete(w(wd.id, `/expenses/${e1.id}`)).set(h)).status).toBe(204);
    expect((await api().get(w(wd.id, '/budget')).set(h)).body).toMatchObject({
      committed: '500.00',
      paid: '100.00',
      outstanding: '400.00',
      remaining: '2500.00',
    });
    expect(await prisma.payment.count({ where: { expenseId: e1.id } })).toBe(0);
  });

  it('FR-45: wedding without expenses → all zeros, remaining = totalBudget, no overdue', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id, { totalBudget: '7777.70' });
    const r = await api().get(w(wd.id, '/budget')).set(bearer(owner.id));
    expect(r.body).toEqual({
      totalBudget: '7777.70',
      committed: '0.00',
      paid: '0.00',
      outstanding: '0.00',
      remaining: '7777.70',
      overdueExpenses: [],
    });
  });

  it('FR-46: overdue only when outstanding > 0 and due date passed; fully paid or due today is not overdue', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const late = await makeExpense(wd.id, { description: 'Late', dueDate: dateStr(-3), agreedAmount: '100.00' });
    const paid = await makeExpense(wd.id, { description: 'Paid', dueDate: dateStr(-3), agreedAmount: '100.00' });
    await makePayment(paid.id, '100.00');
    await makeExpense(wd.id, { description: 'Today', dueDate: dateStr(0), agreedAmount: '100.00' });
    const r = await api().get(w(wd.id, '/budget')).set(bearer(owner.id));
    expect(r.body.overdueExpenses.map((x: any) => x.id)).toEqual([late.id]);
  });
});

describe('schedule edge cases (FR-54..56, BR-12)', () => {
  it('BR-12: an item spanning midnight is valid and overlaps items on both days', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const h = bearer(owner.id);
    const late = await api()
      .post(w(wd.id, '/schedule'))
      .set(h)
      .send({ title: 'Party', startTime: '2027-06-19T22:00:00Z', endTime: '2027-06-20T02:00:00Z' });
    expect(late.status).toBe(201);
    const next = await api()
      .post(w(wd.id, '/schedule'))
      .set(h)
      .send({ title: 'Breakfast', startTime: '2027-06-20T01:00:00Z', endTime: '2027-06-20T03:00:00Z' });
    expect(next.body.warnings).toHaveLength(1);
    expect(next.body.warnings[0].itemId).toBe(late.body.item.id);
    const bad = await api()
      .post(w(wd.id, '/schedule'))
      .set(h)
      .send({ title: 'Neg', startTime: '2027-06-20T02:00:00Z', endTime: '2027-06-19T22:00:00Z' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.endTime).toBeDefined();
  });

  it('BR-12: three-way overlap and removing an overlap updates others on next GET', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const h = bearer(owner.id);
    const mk = async (title: string, s: string, e: string) =>
      (
        await api()
          .post(w(wd.id, '/schedule'))
          .set(h)
          .send({ title, startTime: `2027-06-19T${s}:00Z`, endTime: `2027-06-19T${e}:00Z` })
      ).body.item;
    const a = await mk('A', '10:00', '14:00');
    const b = await mk('B', '11:00', '12:00');
    const c = await mk('C', '13:00', '15:00');
    const get = async () => {
      const r = await api().get(w(wd.id, '/schedule')).set(h);
      return Object.fromEntries(r.body.map((i: any) => [i.title, [...i.overlapsWith].sort()]));
    };
    expect(await get()).toEqual({ A: [b.id, c.id].sort(), B: [a.id], C: [a.id] });
    const upd = await api().patch(w(wd.id, `/schedule/${a.id}`)).set(h).send({ endTime: '2027-06-19T10:30:00Z' });
    expect(upd.status).toBe(200);
    expect(upd.body.warnings).toEqual([]);
    expect(await get()).toEqual({ A: [], B: [], C: [] });
    const order = (await api().get(w(wd.id, '/schedule')).set(h)).body.map((i: any) => i.title);
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

describe('template apply clamping (FR-37, AC-09)', () => {
  it('AC-09: wedding closer than daysBeforeWedding → due dates clamped to today, none in the past', async () => {
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    await prisma.wedding.update({ where: { id: wd.id }, data: { weddingDate: day(5) } });
    const tpl = await prisma.checklistTemplate.create({
      data: {
        name: 'Clamp',
        items: {
          create: [
            { sortOrder: 1, title: 'Far', daysBeforeWedding: 30 },
            { sortOrder: 2, title: 'Near', daysBeforeWedding: 2 },
            { sortOrder: 3, title: 'Day of', daysBeforeWedding: 0 },
          ],
        },
      },
    });
    const r = await api().post(w(wd.id, `/checklist-templates/${tpl.id}/apply`)).set(bearer(owner.id)).send({});
    expect(r.status).toBe(201);
    const byTitle = Object.fromEntries(r.body.created.map((t: any) => [t.title, t]));
    expect(byTitle['Far'].dueDate).toBe(dateStr(0));
    expect(byTitle['Near'].dueDate).toBe(dateStr(3));
    expect(byTitle['Day of'].dueDate).toBe(dateStr(5));
    for (const t of r.body.created) {
      expect(t.dueDate >= dateStr(0)).toBe(true);
      expect(t.isOverdue).toBe(false);
      expect(t.status).toBe('TODO');
    }
  });
});

describe('error bodies do not leak internals (NFR-04, NFR-06, NFR-10)', () => {
  it('NFR-10: sampled 400/404/409/410 bodies carry no stack, SQL/Prisma text, token or hash', async () => {
    installMail();
    const { user: owner } = await createUser();
    const wd = await createWedding(owner.id);
    const guest = await createGuest(wd.id);
    const h = bearer(owner.id);
    await api().post(w(wd.id, `/guests/${guest.id}/invitation/send`)).set(h);
    const token = tokenFromMail(lastText);
    const hash = hashToken(token);
    const exp = await makeExpense(wd.id);
    const t = await makeTask(wd.id);
    const responses = [
      await api().post(w(wd.id, '/guests')).set(h).send({ name: '', email: 'bad' }),
      await api().post(w(wd.id, '/tasks')).set(h).send({ title: 'x', dueDate: 'nope' }),
      await api().post(w(wd.id, `/expenses/${exp.id}/payments`)).set(h).send({ amount: '-1', paymentDate: 'x' }),
      await api().post(w(wd.id, '/schedule')).set(h).send({ title: 'x', startTime: 'a', endTime: 'b' }),
      await api().post(w(wd.id, '/suppliers')).set(h).send({ name: 'x'.repeat(999) }),
      await api().get(w(wd.id, `/tasks/${encodeURIComponent("'; DROP TABLE \"Task\";--")}`)).set(h),
      await api().patch(w(wd.id, '/guests/not-a-uuid')).set(h).send({ name: 'x' }),
      await api().get('/api/rsvp/bogus'),
      await api().post(w(wd.id, `/expenses/${exp.id}/payments`)).set(h).send({ amount: '99999.00', paymentDate: '2026-01-01' }),
      await api().patch(w(wd.id, `/tasks/${t.id}`)).set(h).send({ assigneeId: '11111111-1111-4111-8111-111111111111' }),
    ];
    await api().post(w(wd.id, `/guests/${guest.id}/invitation/revoke`)).set(h);
    responses.push(await api().get(`/api/rsvp/${token}`));
    await api().post(w(wd.id, '/archive')).set(h);
    responses.push(await api().post(w(wd.id, '/tasks')).set(h).send({ title: 'x', dueDate: dateStr(3) }));
    const seen = new Set<number>();
    for (const r of responses) {
      seen.add(r.status);
      const text = JSON.stringify(r.body);
      expect(r.body.error?.message, text).toEqual(expect.any(String));
      expect(text).not.toMatch(/\bat .*\(.*:\d+:\d+\)|node_modules|PrismaClient|prisma\.|Invalid `|SELECT |INSERT |violates|P20\d\d/i);
      expect(text).not.toContain(token);
      expect(text).not.toContain(hash);
      expect(text).not.toContain('tokenHash');
    }
    for (const s of [400, 404, 409, 410]) expect(seen.has(s), `status ${s} sampled`).toBe(true);
  });
});

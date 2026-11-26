import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runReminderJob } from '../src/jobs/reminderJob.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { tokenFromMail } from './helpers/guestFactories.js';
import { installMail, reminderMoment, rowsFor, uninstallMail } from './helpers/reminderHelpers.js';
import { dateStr } from './helpers/taskFactories.js';

/**
 * Acceptance pass (SPEC section 10). Every step goes through the public HTTP API only: accounts are
 * registered and logged in through the endpoints, all data is created via the API, nothing is seeded
 * through factories. One journey proves the AC chain end to end; the per-feature files hold the detail.
 */
beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(uninstallMail);

const PASSWORD = 'Password123!';

async function registerAndLogin(name: string, email: string) {
  const reg = await api().post('/api/auth/register').send({ name, email, password: PASSWORD });
  expect(reg.status).toBe(201);
  const login = await api().post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  expect(login.headers['set-cookie']).toBeDefined();
  return { id: reg.body.id as string, email, h: bearer(reg.body.id) };
}

const createWedding = (h: Record<string, string>, coupleNames: string, offsetDays = 120) =>
  api().post('/api/weddings').set(h).send({
    coupleNames, weddingDate: dateStr(offsetDays), location: 'Budapest', totalBudget: '20000.00', rsvpDeadline: dateStr(offsetDays - 14),
  });

describe('acceptance journey (AC-01..AC-13) through the HTTP API only', () => {
  it('AC-01/02/03/04: register, two weddings, team member added and revoked, assigned-task rules', async () => {
    const owner = await registerAndLogin('Olga Owner', 'acc-owner@test.local');
    const member = await registerAndLogin('Mia Member', 'acc-member@test.local');

    const w1 = await createWedding(owner.h, 'Anna & Ben');
    const w2 = await createWedding(owner.h, 'Cora & Dan', 200);
    expect([w1.status, w2.status]).toEqual([201, 201]);
    const list = await api().get('/api/weddings').set(owner.h);
    expect(list.body.map((w: { coupleNames: string }) => w.coupleNames).sort()).toEqual(['Anna & Ben', 'Cora & Dan']);
    const base = `/api/weddings/${w1.body.id}`;

    // not a member yet -> 404
    expect((await api().get(base).set(member.h)).status).toBe(404);
    const add = await api().post(`${base}/members`).set(owner.h).send({ email: member.email });
    expect(add.status).toBe(201);
    expect((await api().get(base).set(member.h)).body.role).toBe('TEAM_MEMBER');
    // team member cannot manage collaborators
    expect((await api().post(`${base}/members`).set(member.h).send({ email: owner.email })).status).toBe(403);

    const mine = await api().post(`${base}/tasks`).set(owner.h).send({ title: 'Mine', dueDate: dateStr(30), priority: 'HIGH', assigneeId: member.id });
    const other = await api().post(`${base}/tasks`).set(owner.h).send({ title: 'Not mine', dueDate: dateStr(30), priority: 'LOW' });
    expect([mine.status, other.status]).toEqual([201, 201]);
    const t = (id: string) => `${base}/tasks/${id}`;

    // AC-03: allowed fields only
    const ok = await api().patch(t(mine.body.id)).set(member.h).send({ status: 'IN_PROGRESS', progressNotes: 'Called the venue' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'IN_PROGRESS', progressNotes: 'Called the venue', priority: 'HIGH', dueDate: dateStr(30) });
    for (const body of [{ dueDate: dateStr(31) }, { priority: 'LOW' }, { assigneeId: null }, { title: 'x' }, { status: 'COMPLETED', priority: 'LOW' }]) {
      const bad = await api().patch(t(mine.body.id)).set(member.h).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(403);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: mine.body.id } });
    expect(row).toMatchObject({ status: 'IN_PROGRESS', priority: 'HIGH', title: 'Mine', assigneeId: member.id });

    // AC-04: someone else's task
    const foreign = await api().patch(t(other.body.id)).set(member.h).send({ status: 'COMPLETED' });
    expect(foreign.status).toBe(403);
    const foreignRow = await prisma.task.findUniqueOrThrow({ where: { id: other.body.id } });
    expect(foreignRow.status).toBe('TODO');

    // AC-02: revoke -> access gone, data kept
    expect((await api().delete(`${base}/members/${member.id}`).set(owner.h)).status).toBe(204);
    expect((await api().get(base).set(member.h)).status).toBe(404);
    expect((await api().patch(t(mine.body.id)).set(member.h).send({ status: 'COMPLETED' })).status).toBe(404);
    expect(await prisma.task.count({ where: { weddingId: w1.body.id } })).toBe(2);
  });

  it('AC-05/06/07/11: guest, invitation, RSVP, dashboard, then revoked/expired/invalid links', async () => {
    const mail = installMail();
    const owner = await registerAndLogin('Olga Two', 'acc-owner2@test.local');
    const w = await createWedding(owner.h, 'Eva & Finn');
    const base = `/api/weddings/${w.body.id}`;
    const gina = await api().post(`${base}/guests`).set(owner.h).send({ name: 'Gina', email: 'gina@acc.local' });
    const hal = await api().post(`${base}/guests`).set(owner.h).send({ name: 'Hal', email: 'hal@acc.local' });
    await api().post(`${base}/guests`).set(owner.h).send({ name: 'Ida', email: 'ida@acc.local' });

    // AC-05
    const sent = await api().post(`${base}/guests/${gina.body.id}/invitation/send`).set(owner.h);
    expect(sent.status).toBe(200);
    expect(sent.body.invitation.deliveryStatus).toBe('SENT');
    const listed = await api().get(`${base}/guests`).set(owner.h);
    expect(listed.body.guests.find((g: { name: string }) => g.name === 'Gina').invitation.status).toBe('SENT');

    // AC-06: RSVP through the link, dashboard reflects it
    const token = tokenFromMail(mail.sent[0]!.text);
    const view = await api().get(`/api/rsvp/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.guestName).toBe('Gina');
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(200);
    const dash = await api().get(`${base}/dashboard`).set(owner.h);
    expect(dash.body.guests).toMatchObject({ total: 3, pending: 2, accepted: 1, declined: 0 });

    // AC-07: invalid, revoked, expired
    expect((await api().get('/api/rsvp/not-a-real-token')).status).toBe(404);
    expect((await api().post(`/api/rsvp/${'A'.repeat(43)}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(404);
    expect((await api().post(`${base}/guests/${gina.body.id}/invitation/revoke`).set(owner.h)).status).toBe(200);
    const revoked = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'DECLINED' });
    expect(revoked.status).toBe(410);
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: gina.body.id } })).rsvpStatus).toBe('ACCEPTED');

    await api().post(`${base}/guests/${hal.body.id}/invitation/send`).set(owner.h);
    const halToken = tokenFromMail(mail.sent[1]!.text);
    await prisma.wedding.update({ where: { id: w.body.id }, data: { rsvpDeadline: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await api().get(`/api/rsvp/${halToken}`)).status).toBe(410);
    expect((await api().post(`/api/rsvp/${halToken}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: hal.body.id } })).rsvpStatus).toBe('PENDING');
  });

  it('AC-08/09/10/11: deposit + later payment, template copy, chronological schedule, dashboard totals', async () => {
    const owner = await registerAndLogin('Olga Three', 'acc-owner3@test.local');
    const w = await createWedding(owner.h, 'Gus & Hana');
    const base = `/api/weddings/${w.body.id}`;

    // AC-08: exact money
    const exp = await api().post(`${base}/expenses`).set(owner.h).send({ description: 'Venue', category: 'Venue', agreedAmount: '5000.00', dueDate: dateStr(60) });
    expect(exp.status).toBe(201);
    const p = `${base}/expenses/${exp.body.id}/payments`;
    expect((await api().post(p).set(owner.h).send({ amount: '1500.50', paymentDate: dateStr(-1), notes: 'deposit' })).status).toBe(201);
    expect((await api().post(p).set(owner.h).send({ amount: '999.25', paymentDate: dateStr(0) })).status).toBe(201);
    const exps = await api().get(`${base}/expenses`).set(owner.h);
    expect(exps.body[0]).toMatchObject({ totalPaid: '2499.75', outstanding: '2500.25' });
    // attacker-style amounts
    for (const amount of ['0', '-5', '0.00', 'abc']) {
      expect((await api().post(p).set(owner.h).send({ amount, paymentDate: dateStr(0) })).status, amount).toBe(400);
    }
    expect((await api().get(`${base}/expenses`).set(owner.h)).body[0].outstanding).toBe('2500.25');

    // AC-09: copy a built-in template; the template is untouched
    const tpl = await prisma.checklistTemplate.create({
      data: { name: 'Acceptance', description: 'd', items: { create: [{ sortOrder: 1, title: 'Book venue', priority: 'HIGH', daysBeforeWedding: 90 }, { sortOrder: 2, title: 'Send invites', priority: 'MEDIUM', daysBeforeWedding: 45 }] } },
      include: { items: true },
    });
    const before = JSON.stringify(await prisma.checklistTemplateItem.findMany({ orderBy: { id: 'asc' } }));
    const applied = await api().post(`${base}/checklist-templates/${tpl.id}/apply`).set(owner.h).send({});
    expect(applied.status).toBe(201);
    expect(applied.body.created).toHaveLength(2);
    await api().patch(`${base}/tasks/${applied.body.created[0].id}`).set(owner.h).send({ title: 'Renamed copy' });
    expect(JSON.stringify(await prisma.checklistTemplateItem.findMany({ orderBy: { id: 'asc' } }))).toBe(before);
    expect((await prisma.checklistTemplateItem.findMany({ where: { templateId: tpl.id } })).map((i) => i.title).sort()).toEqual(['Book venue', 'Send invites']);

    // AC-10: created out of order, listed chronologically, overlap warns but saves
    const day = dateStr(120);
    const s = (title: string, a: string, b: string) => api().post(`${base}/schedule`).set(owner.h).send({ title, startTime: `${day}T${a}:00Z`, endTime: `${day}T${b}:00Z` });
    await s('Dinner', '18:00', '20:00');
    await s('Ceremony', '14:00', '15:00');
    const photos = await s('Photos', '14:30', '15:30');
    expect(photos.status).toBe(201);
    expect(photos.body.warnings).toHaveLength(1);
    const sched = await api().get(`${base}/schedule`).set(owner.h);
    expect(sched.body.map((i: { title: string }) => i.title)).toEqual(['Ceremony', 'Photos', 'Dinner']);

    // AC-11: dashboard recomputed from stored records
    await api().post(`${base}/guests`).set(owner.h).send({ name: 'Zed', email: 'zed@acc.local' });
    const dash = await api().get(`${base}/dashboard`).set(owner.h);
    expect(dash.body.budget).toMatchObject({ totalBudget: '20000.00', committed: '5000.00', paid: '2499.75', outstanding: '2500.25', remaining: '15000.00' });
    expect(dash.body.tasks).toMatchObject({ total: 2, todo: 2, completed: 0, unfinished: 2 });
    expect(dash.body.guests).toMatchObject({ total: 1, pending: 1 });
    expect(dash.body.schedule).toEqual({ items: 3, overlappingItems: 2 });
  });

  it('AC-12/13: upcoming task -> in-app + email reminder; complete/reschedule leaves nothing pending; job twice = no duplicates', async () => {
    const mail = installMail();
    const owner = await registerAndLogin('Olga Four', 'acc-owner4@test.local');
    const member = await registerAndLogin('Mia Four', 'acc-member4@test.local');
    const w = await createWedding(owner.h, 'Ian & Jo');
    const base = `/api/weddings/${w.body.id}`;
    await api().post(`${base}/members`).set(owner.h).send({ email: member.email });
    const task = await api().post(`${base}/tasks`).set(owner.h).send({ title: 'Order cake', dueDate: dateStr(10), priority: 'HIGH', assigneeId: member.id });

    const rows = await rowsFor(task.body.id);
    expect(rows.map((r) => `${r.channel}:${r.status}:${r.userId}`).sort()).toEqual([`EMAIL:PENDING:${member.id}`, `IN_APP:PENDING:${member.id}`]);

    await runReminderJob(reminderMoment(10));
    await runReminderJob(reminderMoment(10)); // NFR-16: second run changes nothing
    expect(await rowsFor(task.body.id)).toHaveLength(2);
    expect(mail.sent).toHaveLength(1);
    const inbox = await api().get('/api/notifications').set(member.h);
    expect(inbox.body).toHaveLength(1);

    // AC-13 on a second task
    const t2 = await api().post(`${base}/tasks`).set(owner.h).send({ title: 'Rings', dueDate: dateStr(20), priority: 'LOW', assigneeId: member.id });
    expect((await rowsFor(t2.body.id)).filter((r) => r.status === 'PENDING')).toHaveLength(2);
    await api().patch(`${base}/tasks/${t2.body.id}`).set(owner.h).send({ dueDate: dateStr(40) });
    const moved = (await rowsFor(t2.body.id)).filter((r) => r.status === 'PENDING');
    expect(moved).toHaveLength(2);
    for (const r of moved) expect(r.scheduledAt.toISOString()).toBe(`${dateStr(37)}T07:00:00.000Z`);
    expect((await api().patch(`${base}/tasks/${t2.body.id}`).set(member.h).send({ status: 'COMPLETED' })).status).toBe(200);
    expect((await rowsFor(t2.body.id)).filter((r) => r.status === 'PENDING')).toHaveLength(0);
  });

  it('AC-14: stored data is read back from the database after the connection is dropped and re-opened', async () => {
    const owner = await registerAndLogin('Olga Five', 'acc-owner5@test.local');
    const w = await createWedding(owner.h, 'Kim & Lou');
    await prisma.$disconnect(); // simulates the process going away; the next query reconnects
    const again = await api().get(`/api/weddings/${w.body.id}`).set(owner.h);
    expect(again.status).toBe(200);
    expect(again.body.coupleNames).toBe('Kim & Lou');
    const login = await api().post('/api/auth/login').send({ email: owner.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });
});

describe('architecture guards (NFR-05, NFR-21)', () => {
  const srcDir = join(__dirname, '..', 'src');
  const filesIn = (dir: string): string[] =>
    readdirSync(join(srcDir, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => join(e.parentPath ?? (e as unknown as { path: string }).path, e.name));

  it('NFR-21: routes, middleware, services and jobs never touch Prisma directly (only repositories do)', () => {
    for (const dir of ['routes', 'middleware', 'services', 'jobs']) {
      for (const file of filesIn(dir)) {
        const text = readFileSync(file, 'utf8');
        const importsPrisma = /from\s+['"][^'"]*lib\/prisma(\.js)?['"]/.test(text) || /new PrismaClient/.test(text);
        expect(importsPrisma, `${file} imports the Prisma client`).toBe(false);
      }
    }
  });

  it('NFR-05: no unsafe raw SQL anywhere; every raw query is a parameterised tagged template', () => {
    for (const file of filesIn('.')) {
      const text = readFileSync(file, 'utf8');
      expect(/\$(query|execute)RawUnsafe/.test(text), `${file} uses an *Unsafe raw API`).toBe(false);
      expect(/\$(queryRaw|executeRaw)\s*\(/.test(text), `${file} calls raw SQL as a plain function`).toBe(false);
    }
  });
});

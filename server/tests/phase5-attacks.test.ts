import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runReminderJob } from '../src/jobs/reminderJob.js';
import { runRetryJob } from '../src/jobs/retryJob.js';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { reminderService } from '../src/services/reminderService.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { apiTask, installMail, patchTask, reminderMoment, rowsFor, uninstallMail } from './helpers/reminderHelpers.js';
import { dateStr, setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(uninstallMail);

let ctx: Awaited<ReturnType<typeof setupTaskWedding>>;
beforeEach(async () => {
  installMail(); // never reach a real SMTP server
  await resetDb();
  ctx = await setupTaskWedding();
});

const pending = <T extends { status: string }>(rows: T[]): T[] => rows.filter((r) => r.status === 'PENDING');
const bell = (userId: string) => api().get('/api/notifications').set(bearer(userId));
const count = async (userId: string) => (await api().get('/api/notifications/unread-count').set(bearer(userId))).body.count as number;

describe('phase 5 end to end through the API (AC-12, AC-13)', () => {
  it('AC-12: assigned task due in 10 days reaches the assignee bell and inbox exactly at scheduledAt, then mark read', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { title: 'Order cake', dueInDays: 10, assigneeId: member.id });

    expect((await bell(member.id)).body).toEqual([]);
    expect(await count(member.id)).toBe(0);

    await runReminderJob(new Date(reminderMoment(10).getTime() - 60_000));
    expect((await bell(member.id)).body).toEqual([]);
    expect(await count(member.id)).toBe(0);
    expect(mail.sent).toHaveLength(0);

    await runReminderJob(reminderMoment(10));
    const list = await bell(member.id);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].task.id).toBe(task.id);
    expect(await count(member.id)).toBe(1);
    expect(mail.sent.map((m) => m.to)).toEqual([member.email]);
    // The owner (not the recipient) sees nothing.
    expect((await bell(owner.id)).body).toEqual([]);

    const read = await api().post(`/api/notifications/${list.body[0].id}/read`).set(bearer(member.id));
    expect(read.status).toBe(200);
    expect(await count(member.id)).toBe(0);
  });

  it('AC-13: complete, reschedule, reassign and delete via the API leave exactly the right PENDING rows', async () => {
    const { owner, member, other, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });

    // reschedule: only the new pair pending, for the same recipient
    expect((await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(20) })).status).toBe(200);
    let rows = await rowsFor(task.id);
    expect(pending(rows)).toHaveLength(2);
    expect(pending(rows).every((r) => r.scheduledAt.toISOString() === `${dateStr(17)}T07:00:00.000Z` && r.userId === member.id)).toBe(true);

    // reassign: recipient changes
    await patchTask(wedding.id, task.id, owner.id, { assigneeId: other.id });
    rows = await rowsFor(task.id);
    expect(pending(rows).map((r) => r.userId)).toEqual([other.id, other.id]);
    expect(pending(rows.filter((r) => r.userId === member.id))).toHaveLength(0);

    // complete: nothing pending
    await patchTask(wedding.id, task.id, owner.id, { status: 'COMPLETED' });
    expect(pending(await rowsFor(task.id))).toHaveLength(0);

    // delete: rows gone
    expect((await api().delete(`/api/weddings/${wedding.id}/tasks/${task.id}`).set(bearer(owner.id))).status).toBe(204);
    expect(await rowsFor(task.id)).toHaveLength(0);
  });
});

describe('reminder lease and concurrency (NFR-15/16)', () => {
  it('NFR-16: five concurrent reminder runs over 20 due rows send each email exactly once', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    for (let i = 0; i < 10; i++) await apiTask(wedding.id, owner.id, { title: `Concurrent ${i}`, dueInDays: 10, assigneeId: member.id });
    const t = reminderMoment(10);

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => runReminderJob(t)));
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(20);
    expect(mail.sent).toHaveLength(10);
    expect(new Set(mail.sent.map((m) => m.subject)).size).toBe(10);
    expect(await prisma.notification.count()).toBe(20);
    expect(await prisma.notification.count({ where: { status: 'SENT', claimedAt: null } })).toBe(20);
  });

  it('NFR-16: the reminder job and the retry job running concurrently never double-send', async () => {
    const mail = installMail((to) => to === ctx.member.email);
    const { owner, member, other, wedding } = ctx;
    await apiTask(wedding.id, owner.id, { title: 'Failing first', dueInDays: 10, assigneeId: member.id });
    await apiTask(wedding.id, owner.id, { title: 'Fine', dueInDays: 10, assigneeId: other.id });
    const t = reminderMoment(10);
    await runReminderJob(t); // member email FAILED (attempt 1), other's sent
    expect(mail.sent).toHaveLength(1);

    mail.failFor = () => false;
    await apiTask(wedding.id, owner.id, { title: 'Due now too', dueInDays: 10, assigneeId: other.id });
    await Promise.all([runReminderJob(t), runRetryJob(t), runRetryJob(t), runReminderJob(t)]);

    const subjects = mail.sent.map((m) => m.subject);
    expect(subjects).toHaveLength(3);
    expect(new Set(subjects).size).toBe(3);
    expect(await prisma.notification.count({ where: { channel: 'EMAIL', status: 'SENT' } })).toBe(3);
    expect(await prisma.notification.count()).toBe(6);
  });

  it('NFR-16: a lease younger than 10 minutes blocks both jobs; one older than 10 minutes is recovered and sent once', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);

    await prisma.notification.updateMany({ where: { taskId: task.id }, data: { claimedAt: new Date(Date.now() - 9 * 60_000) } });
    expect(await runReminderJob(t)).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.sent).toHaveLength(0);

    await prisma.notification.updateMany({ where: { taskId: task.id }, data: { claimedAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await runReminderJob(t)).toEqual({ sent: 2, failed: 0, cancelled: 0 });
    expect(await runReminderJob(t)).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.sent).toHaveLength(1);
  });

  it('NFR-16: a FAILED row with a fresh lease is not picked up by the retry job', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    await runReminderJob(t);
    const attempts = mail.attempts;
    await prisma.notification.updateMany({ where: { taskId: task.id, channel: 'EMAIL' }, data: { claimedAt: new Date(Date.now() - 2 * 60_000) } });
    mail.failFor = () => false;
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.attempts).toBe(attempts);
  });

  it('NFR-16/BR-13: a wedding archived while its reminder is in flight leaves the row CANCELLED (CAS no-op)', async () => {
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    let entered: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (entered = r));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setMailTransportForTests({
      async sendMail() {
        entered();
        await gate;
        return { messageId: 'x' };
      },
    });

    const job = runReminderJob(reminderMoment(10));
    await inFlight;
    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    release();
    await job;

    const rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    // The in-app row may already have been delivered before the archive; the in-flight email must not be recorded as SENT.
    expect(rows.find((r) => r.channel === 'EMAIL')!.status).toBe('CANCELLED');
    expect(rows.some((r) => r.status === 'PENDING' || r.status === 'FAILED')).toBe(false);
  });

  it('NFR-16: if another worker re-claimed the row during a slow send, this run records nothing', async () => {
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    let entered: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (entered = r));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setMailTransportForTests({
      async sendMail() {
        entered();
        await gate;
        return { messageId: 'x' };
      },
    });
    const job = runReminderJob(reminderMoment(10));
    await inFlight;
    const stolen = new Date(Date.now() + 1234);
    await prisma.notification.updateMany({ where: { taskId: task.id, channel: 'EMAIL' }, data: { claimedAt: stolen } });
    release();
    await job;
    const email = (await rowsFor(task.id)).find((r) => r.channel === 'EMAIL')!;
    expect(email.status).toBe('PENDING');
    expect(email.claimedAt?.getTime()).toBe(stolen.getTime());
  });
});

describe('retry policy (BR-11, FR-64)', () => {
  it('BR-11: attemptCount goes 1, 2, 3 and then the retry job never tries again', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    const counts: number[] = [];
    await runReminderJob(t);
    for (let i = 0; i < 5; i++) {
      counts.push((await rowsFor(task.id)).find((r) => r.channel === 'EMAIL')!.attemptCount);
      await runRetryJob(t);
    }
    expect(counts).toEqual([1, 2, 3, 3, 3]);
    expect(mail.attempts).toBe(3);
  });

  it('BR-11/FR-64: after the 3rd failed attempt the guest list shows invitation FAILED with a friendly error', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const created = await api().post(`/api/weddings/${wedding.id}/guests`).set(bearer(owner.id)).send({ name: 'Gina Guest', email: 'gina@test.local' });
    expect(created.status).toBe(201);
    const send = await api().post(`/api/weddings/${wedding.id}/guests/${created.body.id}/invitation/send`).set(bearer(owner.id));
    expect(send.status).toBe(200); // mail failure never breaks the request (NFR-17)

    await runRetryJob(new Date());
    await runRetryJob(new Date());
    await runRetryJob(new Date());
    const attempts = mail.attempts;
    expect(attempts).toBe(3);

    const list = await api().get(`/api/weddings/${wedding.id}/guests`).set(bearer(owner.id));
    const guest = (list.body.guests ?? list.body).find((g: { id: string }) => g.id === created.body.id);
    expect(guest.invitation).toMatchObject({ status: 'FAILED', deliveryStatus: 'FAILED', attemptCount: 3 });
    expect(guest.invitation.lastError).toEqual(expect.any(String));
    expect(guest.invitation.lastError).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|Error:/);
  });

  it('BR-06/BR-11: a FAILED invitation is not retried after the guest link was revoked via the API', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const created = await api().post(`/api/weddings/${wedding.id}/guests`).set(bearer(owner.id)).send({ name: 'Rev', email: 'rev@test.local' });
    await api().post(`/api/weddings/${wedding.id}/guests/${created.body.id}/invitation/send`).set(bearer(owner.id));
    const attempts = mail.attempts;
    mail.failFor = () => false;
    expect((await api().post(`/api/weddings/${wedding.id}/guests/${created.body.id}/invitation/revoke`).set(bearer(owner.id))).status).toBe(200);
    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mail.attempts).toBe(attempts);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('isolation and input attacks on notifications', () => {
  it("BR-14: a user who is a revoked member of wedding A and owner of B sees only B's notifications", async () => {
    const { owner, member, wedding } = ctx;
    const myWedding = await createWedding(member.id, { coupleNames: 'Mine & Mine' });
    const a = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    const b = await apiTask(myWedding.id, member.id, { dueInDays: 10 });
    await runReminderJob(reminderMoment(10));
    expect((await bell(member.id)).body).toHaveLength(2);

    await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    const after = await bell(member.id);
    expect(after.body.map((n: { task: { id: string } }) => n.task.id)).toEqual([b.id]);
    expect(await count(member.id)).toBe(1);
    expect(a.id).not.toBe(b.id);
  });

  it("BR-14: marking another user's notification read answers 404 and never changes their readAt; ids that are not uuids never 500", async () => {
    const { owner, member, wedding } = ctx;
    await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    await runReminderJob(reminderMoment(10));
    const n = (await bell(member.id)).body[0];

    for (const attacker of [owner.id, ctx.other.id]) {
      const res = await api().post(`/api/notifications/${n.id}/read`).set(bearer(attacker));
      expect(res.status).toBe(404);
    }
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).toBeNull();
    for (const bad of ['x', '1', "'; DROP TABLE \"Notification\"; --", '%00', 'null', 'unread-count']) {
      const res = await api().post(`/api/notifications/${encodeURIComponent(bad)}/read`).set(bearer(member.id));
      expect([400, 404]).toContain(res.status);
    }
    expect(await prisma.notification.count()).toBe(2);
  });

  it('NFR-04: invalid unread query values are 400, never 500', async () => {
    const { member } = ctx;
    for (const v of ['maybe', 'yes', '2', 'true&unread=zzz']) {
      const res = await api().get(`/api/notifications?unread=${v}`).set(bearer(member.id));
      expect(res.status, v).toBeLessThan(500);
    }
    expect((await api().get('/api/notifications?unread=maybe').set(bearer(member.id))).status).toBe(400);
  });

  it('NFR-02: a forged or garbage bearer token gets 401 on the notification routes', async () => {
    for (const path of ['/api/notifications', '/api/notifications/unread-count']) {
      const res = await api().get(path).set('Authorization', 'Bearer not.a.jwt');
      expect(res.status).toBe(401);
    }
    expect((await api().post('/api/notifications/read-all').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });
});

describe('archive, templates, backfill (BR-13, FR-37, FR-63, NFR-16)', () => {
  it("BR-13: archiving one wedding cancels only its pending reminders; the job still sends the other wedding's", async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const { user: o2 } = await createUser();
    const w2 = await createWedding(o2.id);
    const a = await apiTask(wedding.id, owner.id, { title: 'In archived', dueInDays: 10 });
    const b = await apiTask(w2.id, o2.id, { title: 'In active', dueInDays: 10 });

    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    expect((await rowsFor(a.id)).every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(pending(await rowsFor(b.id))).toHaveLength(2);

    await runReminderJob(reminderMoment(10));
    expect(mail.sent.map((m) => m.to)).toEqual([o2.email]);
    expect(mail.sent[0]!.subject).toContain('In active');
    expect((await bell(owner.id)).body).toEqual([]);
    expect((await bell(o2.id)).body).toHaveLength(1);
  });

  it('FR-37/BR-10: template-created tasks get a reminder pair for the owner (unassigned); past-due items get none', async () => {
    const { owner, wedding } = ctx;
    const tpl = await prisma.checklistTemplate.create({
      data: {
        name: 'Mixed',
        items: {
          create: [
            { title: 'Near', daysBeforeWedding: 10, sortOrder: 1 },
            { title: 'Far', daysBeforeWedding: 30, sortOrder: 2 },
            { title: 'Ancient', daysBeforeWedding: 400, sortOrder: 3 }, // wedding is ~6 months away -> past due
          ],
        },
      },
    });
    const res = await api().post(`/api/weddings/${wedding.id}/checklist-templates/${tpl.id}/apply`).set(bearer(owner.id)).send({});
    expect(res.status).toBe(201);
    const created: { id: string; title: string; dueDate: string }[] = res.body.created;
    const today = dateStr(0);
    for (const t of created) {
      const rows = await rowsFor(t.id);
      const due = t.dueDate.slice(0, 10);
      if (due < today) {
        expect(rows, t.title).toHaveLength(0);
      } else {
        expect(rows, t.title).toHaveLength(2);
        expect(rows.every((r) => r.userId === owner.id && r.status === 'PENDING')).toBe(true);
      }
    }
    expect(created.some((t) => t.dueDate.slice(0, 10) >= today)).toBe(true);
  });

  it('FR-63/NFR-16: a task due today is reminded on the next run exactly once, even with repeated backfills and edits', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const y = await apiTask(wedding.id, owner.id, { title: 'Yesterday', dueInDays: -1 });
    const task = await apiTask(wedding.id, owner.id, { title: 'Today', dueInDays: 0 });
    expect(await rowsFor(y.id)).toHaveLength(0);
    const rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.scheduledAt.getTime() <= Date.now() + 5)).toBe(true);

    const run = new Date(Date.now() + 2000);
    await runReminderJob(run);
    await reminderService.syncAllReminders();
    await patchTask(wedding.id, task.id, owner.id, { title: 'Today renamed' });
    await reminderService.syncAllReminders();
    await runReminderJob(new Date(run.getTime() + 60_000));
    await runRetryJob(new Date(run.getTime() + 600_000));

    expect(mail.sent).toHaveLength(1);
    expect(await rowsFor(task.id)).toHaveLength(2);
    expect(await rowsFor(y.id)).toHaveLength(0);
    expect((await bell(owner.id)).body).toHaveLength(1);
  });

  it('NFR-16: syncAllReminders twice plus the job twice leaves a stable row count and one email per reminder', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    await apiTask(wedding.id, owner.id, { title: 'One', dueInDays: 10, assigneeId: member.id });
    await apiTask(wedding.id, owner.id, { title: 'Two', dueInDays: 10 });
    const before = await prisma.notification.count();
    await reminderService.syncAllReminders();
    await reminderService.syncAllReminders();
    expect(await prisma.notification.count()).toBe(before);
    const t = reminderMoment(10);
    await runReminderJob(t);
    await runReminderJob(t);
    await reminderService.syncAllReminders();
    expect(await prisma.notification.count()).toBe(before);
    expect(before).toBe(4);
    expect(mail.sent).toHaveLength(2);
    expect(new Set(mail.sent.map((m) => m.subject)).size).toBe(2);
  });
});

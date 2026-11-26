import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runReminderJob } from '../src/jobs/reminderJob.js';
import { prisma } from '../src/lib/prisma.js';
import { reminderService } from '../src/services/reminderService.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { dateStr, day, makeTask, setupTaskWedding } from './helpers/taskFactories.js';
import { apiTask, installMail, patchTask, reminderMoment, rowsFor, uninstallMail } from './helpers/reminderHelpers.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(uninstallMail);

let ctx: Awaited<ReturnType<typeof setupTaskWedding>>;
beforeEach(async () => {
  installMail(); // never let a test reach the real SMTP server (Mailpit); tests re-install to inspect mail
  await resetDb();
  ctx = await setupTaskWedding();
});

const pending = <T extends { status: string }>(rows: T[]): T[] => rows.filter((r) => r.status === 'PENDING');

describe('reminders: scheduling (FR-61..63, BR-09/10)', () => {
  it('AC-12: an eligible upcoming task produces an in-app notification and a scheduled email reminder', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { title: 'Book the <venue>', dueInDays: 10, assigneeId: member.id });

    const rows = await rowsFor(task.id);
    expect(rows.map((r) => `${r.channel}:${r.status}:${r.userId}`).sort()).toEqual([`EMAIL:PENDING:${member.id}`, `IN_APP:PENDING:${member.id}`]);
    for (const r of rows) expect(r.scheduledAt.toISOString()).toBe(`${dateStr(7)}T07:00:00.000Z`);

    // Not yet visible, nothing sent before the reminder moment.
    expect((await api().get('/api/notifications').set(bearer(member.id))).body).toEqual([]);
    await runReminderJob(new Date(reminderMoment(10).getTime() - 60_000));
    expect(mail.sent).toHaveLength(0);

    const counts = await runReminderJob(reminderMoment(10));
    expect(counts).toEqual({ sent: 2, failed: 0, cancelled: 0 });
    const after = await rowsFor(task.id);
    expect(after.every((r) => r.status === 'SENT' && r.sentAt)).toBe(true);
    expect(after.find((r) => r.channel === 'EMAIL')!.attemptCount).toBe(1);

    const list = await api().get('/api/notifications').set(bearer(member.id));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      type: 'TASK_DEADLINE_REMINDER',
      title: 'Task due in 10 days', // built at read time from the real today
      link: `/weddings/${wedding.id}/tasks`,
      readAt: null,
      task: { id: task.id, title: 'Book the <venue>', dueDate: dateStr(10), status: 'TODO' },
      wedding: { id: wedding.id, coupleNames: wedding.coupleNames },
    });

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe(member.email);
    expect(mail.sent[0]!.subject).toMatch(/^Reminder: "Book the <venue>" is due on \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(mail.sent[0]!.text).toContain(`/weddings/${wedding.id}/tasks`);
    expect(mail.sent[0]!.html).toContain('&lt;venue&gt;');
    expect(mail.sent[0]!.html).not.toContain('<venue>');
  });

  it('AC-13: completing or rescheduling a task leaves no obsolete pending reminder', async () => {
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    expect(pending(await rowsFor(task.id))).toHaveLength(2);

    // complete (as the assigned member, allowed fields) -> CANCELLED
    expect((await patchTask(wedding.id, task.id, member.id, { status: 'COMPLETED' })).status).toBe(200);
    let rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);

    // reopen -> the CANCELLED rows are revived, no duplicates
    await patchTask(wedding.id, task.id, owner.id, { status: 'TODO' });
    rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    expect(pending(rows)).toHaveLength(2);

    // reschedule -> old CANCELLED, new PENDING
    await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(12) });
    rows = await rowsFor(task.id);
    expect(rows).toHaveLength(4);
    expect(pending(rows).map((r) => r.scheduledAt.toISOString())).toEqual([`${dateStr(9)}T07:00:00.000Z`, `${dateStr(9)}T07:00:00.000Z`]);
    expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(2);

    // reschedule back -> the CANCELLED row is revived (attemptCount reset), still only 4 rows
    await prisma.notification.updateMany({ where: { taskId: task.id, status: 'CANCELLED' }, data: { attemptCount: 2 } });
    await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(10) });
    rows = await rowsFor(task.id);
    expect(rows).toHaveLength(4);
    const live = pending(rows);
    expect(live.map((r) => r.scheduledAt.toISOString())).toEqual([`${dateStr(7)}T07:00:00.000Z`, `${dateStr(7)}T07:00:00.000Z`]);
    expect(live.every((r) => r.attemptCount === 0 && r.sentAt === null && r.lastError === null)).toBe(true);
    expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(2);
  });

  it('BR-09: a task created as COMPLETED gets no reminders; reopening creates them', async () => {
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, status: 'COMPLETED' });
    expect(await rowsFor(task.id)).toHaveLength(0);
    await patchTask(wedding.id, task.id, owner.id, { status: 'IN_PROGRESS' });
    expect(pending(await rowsFor(task.id))).toHaveLength(2);
  });

  it('BR-10: reassigning moves the reminders to the new assignee; unassigning moves them to the owner', async () => {
    const { owner, member, other, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    expect(pending(await rowsFor(task.id)).every((r) => r.userId === owner.id)).toBe(true); // unassigned -> owner

    await patchTask(wedding.id, task.id, owner.id, { assigneeId: member.id });
    let rows = await rowsFor(task.id);
    expect(pending(rows).map((r) => r.userId)).toEqual([member.id, member.id]);
    expect(rows.filter((r) => r.status === 'CANCELLED').every((r) => r.userId === owner.id)).toBe(true);

    await patchTask(wedding.id, task.id, owner.id, { assigneeId: other.id });
    expect(pending(await rowsFor(task.id)).map((r) => r.userId)).toEqual([other.id, other.id]);

    await patchTask(wedding.id, task.id, owner.id, { assigneeId: null });
    rows = await rowsFor(task.id);
    expect(pending(rows).map((r) => r.userId)).toEqual([owner.id, owner.id]);
    expect(rows).toHaveLength(6); // owner pair revived, not duplicated
  });

  it('FR-63: no reminder for a task whose deadline has passed; due today/tomorrow is scheduled for now', async () => {
    const { owner, wedding } = ctx;
    const past = await apiTask(wedding.id, owner.id, { dueInDays: -1 });
    expect(await rowsFor(past.id)).toHaveLength(0);

    const before = Date.now();
    const today = await apiTask(wedding.id, owner.id, { dueInDays: 0 });
    const tomorrow = await apiTask(wedding.id, owner.id, { dueInDays: 1 });
    const after = Date.now();
    for (const t of [today, tomorrow]) {
      const rows = await rowsFor(t.id);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.status).toBe('PENDING');
        expect(r.scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 5);
        expect(r.scheduledAt.getTime()).toBeLessThanOrEqual(after + 5);
      }
    }
    // Rescheduling an open task into the past removes its pending reminders.
    await patchTask(wedding.id, today.id, owner.id, { dueDate: dateStr(-2) });
    expect(pending(await rowsFor(today.id))).toHaveLength(0);
  });

  it('FR-63: a reminder that was never sent is cancelled, not sent, once the deadline has passed', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 5 });
    const counts = await runReminderJob(new Date(`${dateStr(7)}T12:00:00.000Z`)); // two days after the deadline
    expect(counts).toEqual({ sent: 0, failed: 0, cancelled: 2 });
    expect(mail.sent).toHaveLength(0);
    expect((await rowsFor(task.id)).every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('BR-13: archiving cancels pending reminders, the job skips archived weddings, none are created afterwards', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    expect(pending(await rowsFor(task.id))).toHaveLength(2);

    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    expect((await rowsFor(task.id)).every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(await runReminderJob(reminderMoment(10))).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.sent).toHaveLength(0);

    // Backfill never revives anything on an archived wedding.
    await reminderService.syncAllReminders();
    expect(pending(await rowsFor(task.id))).toHaveLength(0);
    // Writes to an archived wedding are rejected, so no new reminders can appear.
    const create = await api().post(`/api/weddings/${wedding.id}/tasks`).set(bearer(owner.id)).send({ title: 'Late', dueDate: dateStr(20) });
    expect(create.status).toBe(409);
  });

  it('BR-13: the job cancels (does not send) a pending reminder whose wedding got archived behind its back', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    await prisma.wedding.update({ where: { id: wedding.id }, data: { status: 'ARCHIVED' } });
    expect(await runReminderJob(reminderMoment(10))).toEqual({ sent: 0, failed: 0, cancelled: 2 });
    expect(mail.sent).toHaveLength(0);
    expect((await rowsFor(task.id)).every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('BR-10/FR-62: revoking a member moves the reminders of their tasks to the owner', async () => {
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    expect((await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id))).status).toBe(204);

    const rows = await rowsFor(task.id);
    expect(pending(rows).map((r) => r.userId)).toEqual([owner.id, owner.id]);
    expect(rows.filter((r) => r.userId === member.id).every((r) => r.status === 'CANCELLED')).toBe(true);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(t.assigneeId).toBeNull();
  });

  it('FR-37: tasks created from a checklist template get reminders; deleting a task removes them', async () => {
    const { owner, wedding } = ctx;
    const tpl = await prisma.checklistTemplate.create({
      data: { name: 'Tiny', items: { create: [{ title: 'Soon', daysBeforeWedding: 10, sortOrder: 1 }, { title: 'Later', daysBeforeWedding: 2, sortOrder: 2 }] } },
    });
    const res = await api().post(`/api/weddings/${wedding.id}/checklist-templates/${tpl.id}/apply`).set(bearer(owner.id)).send({});
    expect(res.status).toBe(201);
    const ids: string[] = res.body.created.map((t: { id: string }) => t.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await rowsFor(id)).toHaveLength(2);

    expect((await api().delete(`/api/weddings/${wedding.id}/tasks/${ids[0]}`).set(bearer(owner.id))).status).toBe(204);
    expect(await rowsFor(ids[0]!)).toHaveLength(0);
    expect(await rowsFor(ids[1]!)).toHaveLength(2);
  });

  it('NFR-16: syncing again (startup backfill) creates no duplicates, also for late reminders', async () => {
    const { owner, wedding } = ctx;
    const future = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const late = await apiTask(wedding.id, owner.id, { dueInDays: 1 });
    const legacy = await makeTask(wedding.id, { title: 'Created before phase 5', dueDate: day(20) });
    expect(await rowsFor(legacy.id)).toHaveLength(0);

    const total = () => prisma.notification.count();
    await reminderService.syncAllReminders();
    const first = await total();
    expect(first).toBe(6);
    expect(await rowsFor(legacy.id)).toHaveLength(2);
    await reminderService.syncAllReminders();
    await reminderService.syncAllReminders(new Date(Date.now() + 5 * 60_000));
    expect(await total()).toBe(first);
    expect(await rowsFor(future.id)).toHaveLength(2);
    expect(await rowsFor(late.id)).toHaveLength(2);
  });

  it('NFR-16: concurrent syncs of a late task (two processes at startup) create one pair of reminders, not two', async () => {
    const { owner, wedding } = ctx;
    const tasks = [];
    for (let i = 0; i < 5; i++) tasks.push(await makeTask(wedding.id, { title: `Late ${i}`, assigneeId: owner.id, dueDate: day(1) }));
    await Promise.all([reminderService.syncAllReminders(), reminderService.syncAllReminders(), reminderService.syncAllReminders()]);
    for (const t of tasks) expect(await rowsFor(t.id)).toHaveLength(2);
    expect(await prisma.notification.count()).toBe(10);
  });

  it('a delivered reminder is left alone: rescheduling to the same date does not re-send it', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    await runReminderJob(reminderMoment(10));
    expect(mail.sent).toHaveLength(1);

    // "Reschedule" to the same date, change other fields, resync from every angle.
    await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(10), priority: 'LOW' });
    await reminderService.syncAllReminders();
    const rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
    await runReminderJob(new Date(reminderMoment(10).getTime() + 3_600_000));
    expect(mail.sent).toHaveLength(1);
  });

  it('a late reminder that was already delivered is not created again when the task is edited', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 1 });
    await runReminderJob(new Date(Date.now() + 1000));
    expect(mail.sent).toHaveLength(1);
    await patchTask(wedding.id, task.id, owner.id, { title: 'Renamed' });
    const rows = await rowsFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
  });

  it('rescheduling after delivery creates new reminders for the new date', async () => {
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    await runReminderJob(reminderMoment(10));
    await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(30) });
    const rows = await rowsFor(task.id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(2);
    expect(pending(rows)).toHaveLength(2);
  });

  it('a task of another wedding is never touched (reminders are scoped by task)', async () => {
    const { owner, wedding } = ctx;
    const { user: other } = await createUser();
    const otherWedding = await createWedding(other.id);
    const a = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const b = await apiTask(otherWedding.id, other.id, { dueInDays: 10 });
    await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id));
    expect(pending(await rowsFor(a.id))).toHaveLength(0);
    expect(pending(await rowsFor(b.id))).toHaveLength(2);
  });
});

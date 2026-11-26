import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { invitationService } from '../src/services/invitationService.js';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { patchTask } from './helpers/reminderHelpers.js';
import { dateStr } from './helpers/taskFactories.js';
import { guarded } from '../src/jobs/index.js';
import { runReminderJob } from '../src/jobs/reminderJob.js';
import { runRetryJob } from '../src/jobs/retryJob.js';
import { prisma } from '../src/lib/prisma.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';
import { createWeddingWithPastDeadline } from './helpers/guestFactories.js';
import { apiTask, captureLogger, installMail, reminderMoment, rowsFor, uninstallMail } from './helpers/reminderHelpers.js';
import { setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(uninstallMail);

let ctx: Awaited<ReturnType<typeof setupTaskWedding>>;
beforeEach(async () => {
  installMail(); // never reach the real SMTP server; tests re-install to inspect mail
  await resetDb();
  ctx = await setupTaskWedding();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const emailRow = async (taskId: string) => (await rowsFor(taskId)).find((r) => r.channel === 'EMAIL')!;

describe('reminder job (NFR-15/16/17)', () => {
  it('NFR-16: running the reminder job twice creates no duplicate reminders and sends each email once', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    const t = reminderMoment(10);

    const first = await runReminderJob(t);
    const second = await runReminderJob(t);
    expect(first).toEqual({ sent: 2, failed: 0, cancelled: 0 });
    expect(second).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(await rowsFor(task.id)).toHaveLength(2);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('NFR-16: two concurrent reminder job runs still send exactly once', async () => {
    const mail = installMail();
    const { owner, member, wedding } = ctx;
    const tasks = [];
    for (let i = 0; i < 6; i++) tasks.push(await apiTask(wedding.id, owner.id, { title: `Task ${i}`, dueInDays: 10, assigneeId: member.id }));
    const t = reminderMoment(10);

    const [a, b] = await Promise.all([runReminderJob(t), runReminderJob(t)]);
    expect(a.sent + b.sent).toBe(12); // 6 in-app + 6 email, each handled by exactly one run
    expect(mail.sent).toHaveLength(6);
    expect(new Set(mail.sent.map((m) => m.subject)).size).toBe(6);
    for (const task of tasks) expect((await rowsFor(task.id)).every((r) => r.status === 'SENT' && r.attemptCount <= 1)).toBe(true);
  });

  it('BR-11/FR-64: failed reminder emails are retried up to 3 attempts, then stay FAILED', async () => {
    const mail = installMail(() => true);
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10, assigneeId: member.id });
    const t = reminderMoment(10);

    expect(await runReminderJob(t)).toEqual({ sent: 1, failed: 1, cancelled: 0 }); // in-app delivered, email failed
    let row = await emailRow(task.id);
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: 1, lastError: 'The email server could not be reached.' });

    // The reminder job never picks FAILED rows up again; only the retry job does.
    await runReminderJob(t);
    expect(mail.attempts).toBe(1);

    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 1, cancelled: 0 });
    row = await emailRow(task.id);
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: 2 });
    await runRetryJob(t);
    row = await emailRow(task.id);
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: 3 });

    // Limit reached: no more attempts, row stays FAILED and visible.
    const attempts = mail.attempts;
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.attempts).toBe(attempts);
    expect((await emailRow(task.id)).status).toBe('FAILED');
  });

  it('BR-11: a retry that succeeds marks the reminder SENT', async () => {
    let failing = true;
    const mail = installMail(() => failing);
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    await runReminderJob(t);
    expect((await emailRow(task.id)).status).toBe('FAILED');

    failing = false;
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 1, failed: 0, cancelled: 0 });
    const row = await emailRow(task.id);
    expect(row).toMatchObject({ status: 'SENT', attemptCount: 2, lastError: null });
    expect(row.sentAt).not.toBeNull();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe(owner.email);
  });

  it('BR-11: the retry job cancels (not sends) a failed reminder whose task was completed meanwhile', async () => {
    let failing = true;
    const mail = installMail(() => failing);
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    await runReminderJob(t);
    await prisma.task.update({ where: { id: task.id }, data: { status: 'COMPLETED' } });
    failing = false;
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 0, cancelled: 1 });
    expect((await emailRow(task.id)).status).toBe('CANCELLED');
    expect(mail.sent).toHaveLength(0);
  });

  it('NFR-17: a mail failure never breaks the job (one failing + one succeeding email in the same batch)', async () => {
    const mail = installMail((to) => to === ctx.member.email);
    const { owner, member, wedding } = ctx;
    const bad = await apiTask(wedding.id, owner.id, { title: 'Fails', dueInDays: 10, assigneeId: member.id });
    const good = await apiTask(wedding.id, owner.id, { title: 'Works', dueInDays: 10 });

    const counts = await runReminderJob(reminderMoment(10));
    expect(counts).toEqual({ sent: 3, failed: 1, cancelled: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual([owner.email]);
    expect(await emailRow(bad.id)).toMatchObject({ status: 'FAILED', attemptCount: 1 });
    expect(await emailRow(good.id)).toMatchObject({ status: 'SENT', attemptCount: 1 });
    // Wedding data is untouched.
    const tasks = await prisma.task.findMany({ where: { weddingId: wedding.id }, orderBy: { title: 'asc' } });
    expect(tasks.map((t) => [t.title, t.status, t.assigneeId])).toEqual([['Fails', 'TODO', member.id], ['Works', 'TODO', null]]);
  });

  it('NFR-17: a failing email does not break the retry job either', async () => {
    installMail(() => true);
    const { owner, wedding } = ctx;
    await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    await runReminderJob(reminderMoment(10));
    await expect(runRetryJob(reminderMoment(10))).resolves.toBeDefined();
  });

  it('NFR-06: job logs contain no tokens, links or email bodies', async () => {
    const mail = installMail((to) => to === 'fail@test.local');
    const { owner, wedding } = ctx;
    const { log, output } = captureLogger();
    const guest = await createGuest(wedding.id, { name: 'Gina Guest', email: 'fail@test.local' });
    await prisma.invitation.create({ data: { guestId: guest.id, tokenHash: sha('seed-token'), deliveryStatus: 'FAILED', attemptCount: 1 } });
    await apiTask(wedding.id, owner.id, { title: 'Secret plans', dueInDays: 10 });
    const t = reminderMoment(10);

    await runReminderJob(t, log);
    await runRetryJob(t, log);
    // Sent invitation retry after the failure, to see the new token in the mail but not in the logs.
    mail.failFor = () => false;
    await prisma.invitation.updateMany({ where: { guestId: guest.id }, data: { deliveryStatus: 'FAILED', attemptCount: 1 } });
    await runRetryJob(t, log);

    const token = /\/rsvp\/([A-Za-z0-9_-]+)/.exec(mail.sent.find((m) => m.text.includes('/rsvp/'))!.text)![1]!;
    const logs = output();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(sha(token));
    expect(logs).not.toMatch(/\/rsvp\/|http:\/\/localhost:4200|tasks"|Open the task list|Dear |Hello /);
  });

  it('BR-10: a FAILED reminder email is cancelled by a reschedule or reassignment and never retried for the old date', async () => {
    const mail = installMail(() => true);
    const { owner, member, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    await runReminderJob(t);
    expect((await emailRow(task.id)).status).toBe('FAILED');

    mail.failFor = () => false;
    await patchTask(wedding.id, task.id, owner.id, { dueDate: dateStr(30) }); // reschedule
    expect((await rowsFor(task.id)).filter((r) => r.status === 'FAILED')).toHaveLength(0);
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 0, cancelled: 0 });
    expect(mail.sent).toHaveLength(0);

    // reassign: the FAILED row of the old recipient is cancelled too
    mail.failFor = () => true;
    await runReminderJob(reminderMoment(30));
    expect((await rowsFor(task.id)).filter((r) => r.status === 'FAILED')).toHaveLength(1);
    await patchTask(wedding.id, task.id, owner.id, { assigneeId: member.id });
    expect((await rowsFor(task.id)).filter((r) => r.status === 'FAILED')).toHaveLength(0);
  });

  it('BR-10: the retry job itself cancels a FAILED row whose recipient or date no longer fits the task', async () => {
    const mail = installMail(() => true);
    const { owner, member, wedding } = ctx;
    const a = await apiTask(wedding.id, owner.id, { title: 'A', dueInDays: 10 });
    const b = await apiTask(wedding.id, owner.id, { title: 'B', dueInDays: 10 });
    const t = reminderMoment(10);
    await runReminderJob(t);
    mail.failFor = () => false;
    // Change the tasks behind the sync's back (direct DB writes): only the delivery re-check can catch it.
    await prisma.task.update({ where: { id: a.id }, data: { assigneeId: member.id } });
    await prisma.task.update({ where: { id: b.id }, data: { dueDate: new Date(`${dateStr(40)}T00:00:00.000Z`) } });
    expect((await runRetryJob(t)).reminders).toEqual({ sent: 0, failed: 0, cancelled: 2 });
    expect(mail.sent).toHaveLength(0);
    expect((await emailRow(a.id)).status).toBe('CANCELLED');
    expect((await emailRow(b.id)).status).toBe('CANCELLED');
  });

  it('NFR-16: a task write while a reminder is claimed but not yet recorded completes quickly; the reminder is not duplicated', async () => {
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const sent: string[] = [];
    let entered: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (entered = r));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setMailTransportForTests({
      async sendMail(m) {
        entered();
        await gate; // slow SMTP
        sent.push(m.to);
        return { messageId: 'x' };
      },
    });

    const job = runReminderJob(reminderMoment(10));
    await inFlight; // the email row is claimed, the send has started, nothing is recorded yet
    const started = Date.now();
    const res = await patchTask(wedding.id, task.id, owner.id, { status: 'COMPLETED' });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3000); // no waiting on the claimed rows, no 500
    release();
    const counts = await job;

    const rows = await rowsFor(task.id);
    expect(rows.some((r) => r.status === 'PENDING' || r.status === 'FAILED')).toBe(false);
    expect(rows.find((r) => r.channel === 'EMAIL')!.status).toBe('CANCELLED'); // the CAS no-opped
    expect(counts.failed).toBe(0);
    expect(sent.length).toBeLessThanOrEqual(1); // at most the one in flight
    expect(await prisma.notification.count()).toBe(2); // never duplicated
  });

  it('NFR-15/16: a claim (lease) keeps other runs off a row; an expired lease is claimed again; recording clears the lease', async () => {
    const mail = installMail();
    const { owner, wedding } = ctx;
    const task = await apiTask(wedding.id, owner.id, { dueInDays: 10 });
    const t = reminderMoment(10);
    await prisma.notification.updateMany({ where: { taskId: task.id }, data: { claimedAt: new Date(Date.now() - 5 * 60_000) } });
    expect(await runReminderJob(t)).toEqual({ sent: 0, failed: 0, cancelled: 0 }); // fresh lease: skipped
    expect(mail.sent).toHaveLength(0);

    await prisma.notification.updateMany({ where: { taskId: task.id }, data: { claimedAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await runReminderJob(t)).toEqual({ sent: 2, failed: 0, cancelled: 0 }); // lease expired: claimed again
    expect(mail.sent).toHaveLength(1);
    expect((await rowsFor(task.id)).every((r) => r.status === 'SENT' && r.claimedAt === null)).toBe(true);
  });

  it('the cron wrapper skips a tick while the previous run is still going and survives a failing run', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const tick = guarded('test', async () => {
      calls++;
      await gate;
    });
    const first = tick();
    await tick(); // skipped
    release();
    await first;
    expect(calls).toBe(1);
    await expect(guarded('boom', async () => { throw new Error('db down'); })()).resolves.toBeUndefined();
  });
});

describe('invitation retry (FR-64, BR-05, BR-11)', () => {
  async function failedInvitation(weddingId: string, attemptCount = 1, email = 'gina@test.local') {
    const guest = await createGuest(weddingId, { name: 'Gina', email });
    const oldHash = sha(`old-${guest.id}`);
    const inv = await prisma.invitation.create({
      data: { guestId: guest.id, tokenHash: oldHash, deliveryStatus: 'FAILED', attemptCount, lastError: 'The email server could not be reached.' },
    });
    return { guest, inv, oldHash };
  }

  it('BR-11: a FAILED invitation is retried with a rotated token and attemptCount + 1, then SENT', async () => {
    const mail = installMail();
    const { wedding } = ctx;
    const { guest, inv, oldHash } = await failedInvitation(wedding.id, 1);

    const res = await runRetryJob(new Date());
    expect(res.invitations).toEqual({ sent: 1, failed: 0, skipped: 0 });
    const after = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after).toMatchObject({ deliveryStatus: 'SENT', attemptCount: 2, lastError: null, revokedAt: null });
    expect(after.lastSentAt).not.toBeNull();
    expect(after.tokenHash).not.toBe(oldHash);
    expect(await prisma.invitation.count({ where: { tokenHash: oldHash } })).toBe(0); // old link gone
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1); // still one per guest (BR-05)

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe('gina@test.local');
    const token = /\/rsvp\/([A-Za-z0-9_-]+)/.exec(mail.sent[0]!.text)![1]!;
    expect(sha(token)).toBe(after.tokenHash);

    // Nothing left to retry.
    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mail.sent).toHaveLength(1);
  });

  it('BR-11/FR-64: failed invitation retries stop at 3 attempts and stay FAILED', async () => {
    const mail = installMail(() => true);
    const { wedding } = ctx;
    const { inv } = await failedInvitation(wedding.id, 1);

    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ deliveryStatus: 'FAILED', attemptCount: 2, lastError: 'The email server could not be reached.' });
    await runRetryJob(new Date());
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).attemptCount).toBe(3);

    const attempts = mail.attempts;
    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(mail.attempts).toBe(attempts);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).deliveryStatus).toBe('FAILED');
  });

  it('BR-06/BR-13: retries skip revoked invitations, past-deadline weddings and archived weddings', async () => {
    const mail = installMail();
    const { wedding } = ctx;
    const revoked = await failedInvitation(wedding.id, 1, 'revoked@test.local');
    await prisma.invitation.update({ where: { id: revoked.inv.id }, data: { revokedAt: new Date() } });

    const { user: o2 } = await createUser();
    const pastWedding = await createWeddingWithPastDeadline(o2.id);
    const past = await failedInvitation(pastWedding.id, 1, 'past@test.local');

    const { user: o3 } = await createUser();
    const archivedWedding = await createWedding(o3.id);
    await prisma.wedding.update({ where: { id: archivedWedding.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    const archived = await failedInvitation(archivedWedding.id, 1, 'archived@test.local');

    expect(await runRetryJob(new Date())).toMatchObject({ invitations: { sent: 0, failed: 0, skipped: 0 } });
    expect(mail.sent).toHaveLength(0);
    for (const i of [revoked, past, archived]) {
      expect(await prisma.invitation.findUniqueOrThrow({ where: { id: i.inv.id } })).toMatchObject({ attemptCount: 1, tokenHash: i.oldHash });
    }
  });

  it('NFR-16: two concurrent retry runs retry an invitation once', async () => {
    const mail = installMail();
    const { wedding } = ctx;
    const { inv } = await failedInvitation(wedding.id, 1);
    await Promise.all([runRetryJob(new Date()), runRetryJob(new Date())]);
    expect(mail.sent).toHaveLength(1);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).attemptCount).toBe(2);
  });

  it('BR-05/FR-64: a manual resend after 3 failed attempts resets the counter to 1 and the retry job picks it up again', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const { guest, inv } = await failedInvitation(wedding.id, 3);
    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 0, failed: 0, skipped: 0 }); // exhausted

    const res = await api().post(`/api/weddings/${wedding.id}/guests/${guest.id}/invitation/send`).set(bearer(owner.id));
    expect(res.status).toBe(200);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).attemptCount).toBe(1); // reset by the resend
    mail.failFor = () => false;
    expect((await runRetryJob(new Date())).invitations).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ deliveryStatus: 'SENT', attemptCount: 2 });
  });

  it('BR-05: a retry racing a manual resend backs off (token hash changed) and sends nothing', async () => {
    const mail = installMail(() => true);
    const { owner, wedding } = ctx;
    const { guest, inv } = await failedInvitation(wedding.id, 1);
    const [candidate] = await invitationService.listRetryCandidates(new Date(), [], 10);
    expect(candidate!.id).toBe(inv.id);

    // The planner resends (still failing): same attemptCount (1), NEW token hash.
    await api().post(`/api/weddings/${wedding.id}/guests/${guest.id}/invitation/send`).set(bearer(owner.id));
    const afterResend = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(afterResend.attemptCount).toBe(1);
    expect(afterResend.tokenHash).not.toBe(candidate!.tokenHash);
    const attempts = mail.attempts;

    const { log } = captureLogger();
    expect(await invitationService.retryDelivery(candidate!, new Date(), log)).toBe('skipped');
    expect(mail.attempts).toBe(attempts);
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ tokenHash: afterResend.tokenHash, attemptCount: 1 });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { dateStr, day, makeTask, setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

let ctx: Awaited<ReturnType<typeof setupTaskWedding>>;
beforeEach(async () => {
  await resetDb();
  ctx = await setupTaskWedding();
});

let seq = 0;
/** A delivered (or otherwise) reminder row, inserted directly. */
async function notify(
  taskId: string,
  userId: string,
  o: Partial<{ channel: 'IN_APP' | 'EMAIL'; status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'; sentAt: Date; readAt: Date | null }> = {},
) {
  seq += 1;
  const status = o.status ?? 'SENT';
  return prisma.notification.create({
    data: {
      taskId,
      userId,
      type: 'TASK_DEADLINE_REMINDER',
      channel: o.channel ?? 'IN_APP',
      status,
      scheduledAt: new Date(Date.UTC(2026, 0, 1, 7, seq)),
      sentAt: status === 'SENT' ? (o.sentAt ?? new Date(Date.UTC(2026, 0, 1, 7, seq))) : null,
      readAt: o.readAt ?? null,
    },
  });
}

describe('notifications API (FR-61, phase 5)', () => {
  it('401 without a login on every notifications route', async () => {
    expect((await api().get('/api/notifications')).status).toBe(401);
    expect((await api().get('/api/notifications/unread-count')).status).toBe(401);
    expect((await api().post('/api/notifications/read-all')).status).toBe(401);
    expect((await api().post('/api/notifications/00000000-0000-4000-8000-000000000000/read')).status).toBe(401);
  });

  it('lists only my own delivered IN_APP notifications, newest first, with the contract shape', async () => {
    const { owner, member, wedding } = ctx;
    const task = await makeTask(wedding.id, { title: 'Book the venue', assigneeId: member.id, dueDate: day(3) });
    const older = await notify(task.id, member.id, { sentAt: new Date('2026-01-01T07:00:00Z') });
    const newer = await notify(task.id, member.id, { sentAt: new Date('2026-02-01T07:00:00Z') });
    await notify(task.id, member.id, { channel: 'EMAIL' }); // email: never listed
    await notify(task.id, member.id, { status: 'PENDING' }); // not delivered yet
    await notify(task.id, member.id, { status: 'CANCELLED' });
    await notify(task.id, owner.id); // someone else's

    const res = await api().get('/api/notifications').set(bearer(member.id));
    expect(res.status).toBe(200);
    expect(res.body.map((n: { id: string }) => n.id)).toEqual([newer.id, older.id]);
    expect(res.body[0]).toEqual({
      id: newer.id,
      type: 'TASK_DEADLINE_REMINDER',
      title: 'Task due in 3 days',
      message: expect.stringMatching(/^"Book the venue" is due on \d{1,2} [A-Z][a-z]{2} \d{4} — Anna & Ben\.$/),
      link: `/weddings/${wedding.id}/tasks`,
      createdAt: '2026-02-01T07:00:00.000Z',
      readAt: null,
      task: { id: task.id, title: 'Book the venue', dueDate: dateStr(3), status: 'TODO' },
      wedding: { id: wedding.id, coupleNames: 'Anna & Ben' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/userId|attemptCount|lastError|scheduledAt/);

    const ownerList = await api().get('/api/notifications').set(bearer(owner.id));
    expect(ownerList.body).toHaveLength(1);
  });

  it('limits the list to the newest 50', async () => {
    const { member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    await prisma.notification.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        taskId: task.id,
        userId: member.id,
        type: 'TASK_DEADLINE_REMINDER' as const,
        channel: 'IN_APP' as const,
        status: 'SENT' as const,
        scheduledAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        sentAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });
    const res = await api().get('/api/notifications').set(bearer(member.id));
    expect(res.body).toHaveLength(50);
    expect(res.body[0].createdAt).toBe('2026-01-01T00:54:00.000Z');
  });

  it('?unread=true filters read ones out; unread-count follows', async () => {
    const { member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    const a = await notify(task.id, member.id);
    await notify(task.id, member.id, { readAt: new Date() });
    await notify(task.id, member.id);

    const unread = await api().get('/api/notifications?unread=true').set(bearer(member.id));
    expect(unread.body).toHaveLength(2);
    expect(unread.body.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);
    expect((await api().get('/api/notifications').set(bearer(member.id))).body).toHaveLength(3);
    expect((await api().get('/api/notifications/unread-count').set(bearer(member.id))).body).toEqual({ count: 2 });

    await api().post(`/api/notifications/${a.id}/read`).set(bearer(member.id));
    expect((await api().get('/api/notifications/unread-count').set(bearer(member.id))).body).toEqual({ count: 1 });
    expect((await api().get('/api/notifications?unread=maybe').set(bearer(member.id))).status).toBe(400);
  });

  it('mark read is idempotent and keeps the first read time', async () => {
    const { member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    const n = await notify(task.id, member.id);
    const first = await api().post(`/api/notifications/${n.id}/read`).set(bearer(member.id));
    expect(first.status).toBe(200);
    expect(first.body.readAt).toEqual(expect.any(String));
    await new Promise((r) => setTimeout(r, 15));
    const second = await api().post(`/api/notifications/${n.id}/read`).set(bearer(member.id));
    expect(second.status).toBe(200);
    expect(second.body.readAt).toBe(first.body.readAt);
  });

  it("mark read on someone else's, an undelivered or an unknown notification is 404", async () => {
    const { owner, member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    const mine = await notify(task.id, member.id);
    const pending = await notify(task.id, member.id, { status: 'PENDING' });
    const email = await notify(task.id, member.id, { channel: 'EMAIL' });

    const theirs = await api().post(`/api/notifications/${mine.id}/read`).set(bearer(owner.id));
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('NOT_FOUND');
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt).toBeNull();
    for (const id of [pending.id, email.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      expect((await api().post(`/api/notifications/${id}/read`).set(bearer(member.id))).status).toBe(404);
    }
  });

  it('read-all marks only my own visible notifications and answers 204', async () => {
    const { owner, member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    await notify(task.id, member.id);
    await notify(task.id, member.id);
    const ownersOne = await notify(task.id, owner.id);
    const pending = await notify(task.id, member.id, { status: 'PENDING' });

    const res = await api().post('/api/notifications/read-all').set(bearer(member.id));
    expect(res.status).toBe(204);
    expect((await api().get('/api/notifications/unread-count').set(bearer(member.id))).body).toEqual({ count: 0 });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: ownersOne.id } })).readAt).toBeNull();
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: pending.id } })).readAt).toBeNull();
    expect((await api().post('/api/notifications/read-all').set(bearer(member.id))).status).toBe(204); // repeatable
  });

  it("a revoked member's old notifications are hidden (list, count, read) and come back if re-added", async () => {
    const { owner, member, wedding } = ctx;
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    const n = await notify(task.id, member.id);
    expect((await api().get('/api/notifications').set(bearer(member.id))).body).toHaveLength(1);

    expect((await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id))).status).toBe(204);
    expect((await api().get('/api/notifications').set(bearer(member.id))).body).toEqual([]);
    expect((await api().get('/api/notifications/unread-count').set(bearer(member.id))).body).toEqual({ count: 0 });
    expect((await api().post(`/api/notifications/${n.id}/read`).set(bearer(member.id))).status).toBe(404);
    expect((await prisma.notification.count({ where: { id: n.id } }))).toBe(1); // data kept

    await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    expect((await api().get('/api/notifications').set(bearer(member.id))).body).toHaveLength(1);
  });

  it("a non-member never sees another wedding's notifications", async () => {
    const { member, wedding } = ctx;
    const { user: stranger } = await createUser();
    const other = await createWedding(stranger.id);
    const task = await makeTask(wedding.id, { assigneeId: member.id });
    await notify(task.id, member.id);
    const strangerTask = await makeTask(other.id, { assigneeId: stranger.id });
    const mine = await notify(strangerTask.id, stranger.id);
    const res = await api().get('/api/notifications').set(bearer(stranger.id));
    expect(res.body.map((x: { id: string }) => x.id)).toEqual([mine.id]);
  });

  it('a completed task reads "Task completed", not "due in N days"', async () => {
    const { member, wedding } = ctx;
    const t = await makeTask(wedding.id, { title: 'Done already', assigneeId: member.id, dueDate: day(5), status: 'COMPLETED' });
    await notify(t.id, member.id);
    const res = await api().get('/api/notifications').set(bearer(member.id));
    expect(res.body[0].title).toBe('Task completed');
    expect(res.body[0].message).toContain('"Done already" was due on');
  });

  it('the title is built at read time from the current task (due today / tomorrow / passed)', async () => {
    const { member, wedding } = ctx;
    const t0 = await makeTask(wedding.id, { title: 'Today', assigneeId: member.id, dueDate: day(0) });
    const t1 = await makeTask(wedding.id, { title: 'Tomorrow', assigneeId: member.id, dueDate: day(1) });
    const tp = await makeTask(wedding.id, { title: 'Past', assigneeId: member.id, dueDate: day(-2) });
    for (const t of [t0, t1, tp]) await notify(t.id, member.id);
    const res = await api().get('/api/notifications').set(bearer(member.id));
    const byTask = new Map<string, { title: string; message: string }>(res.body.map((n: { task: { title: string }; title: string; message: string }) => [n.task.title, n]));
    expect(byTask.get('Today')!.title).toBe('Task due today');
    expect(byTask.get('Tomorrow')!.title).toBe('Task due tomorrow');
    expect(byTask.get('Past')!.title).toBe('Task deadline passed');
    expect(byTask.get('Past')!.message).toContain('was due on');
  });
});

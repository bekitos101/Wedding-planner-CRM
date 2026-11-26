import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createTask, createUser, createWedding } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function setup() {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const wedding = await createWedding(owner.id);
  return { owner, member, wedding };
}

describe('collaborators', () => {
  it('AC-02: owner adds a registered team member and can revoke access', async () => {
    const { owner, member, wedding } = await setup();
    const add = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email.toUpperCase() });
    expect(add.status).toBe(201);
    expect(add.body).toEqual({
      userId: member.id,
      name: member.name,
      email: member.email,
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
      addedAt: expect.any(String),
      revokedAt: null,
    });
    expect((await api().get(`/api/weddings/${wedding.id}`).set(bearer(member.id))).status).toBe(200);

    const list = await api().get(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    expect(del.status).toBe(204);
    expect((await api().get(`/api/weddings/${wedding.id}`).set(bearer(member.id))).status).toBe(404);
    const after = await api().get(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id));
    expect(after.body[0]).toMatchObject({ userId: member.id, status: 'REVOKED', revokedAt: expect.any(String) });
  });

  it('FR-12: unknown email → 400 fields.email', async () => {
    const { owner, wedding } = await setup();
    const res = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: 'nobody@test.local' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBe('No registered planner with this email.');
  });

  it('FR-12: invalid or missing email → 400', async () => {
    const { owner, wedding } = await setup();
    expect((await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: 'nope' })).status).toBe(400);
    expect((await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({})).status).toBe(400);
  });

  it('BR-01: owner’s own email → 400 and no member row', async () => {
    const { owner, wedding } = await setup();
    const res = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: owner.email });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBe('You already own this wedding.');
    expect(await prisma.weddingMember.count({ where: { weddingId: wedding.id } })).toBe(0);
  });

  it('BR-02: adding an active member twice → 409', async () => {
    const { owner, member, wedding } = await setup();
    await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    const again = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
    expect(await prisma.weddingMember.count({ where: { weddingId: wedding.id } })).toBe(1);
  });

  it('BR-02: re-adding a revoked member re-activates the same row (200, still one row)', async () => {
    const { owner, member, wedding } = await setup();
    await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    const rowBefore = await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: wedding.id } });
    await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    const re = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    expect(re.status).toBe(200);
    expect(re.body).toMatchObject({ userId: member.id, status: 'ACTIVE', revokedAt: null });
    const rows = await prisma.weddingMember.findMany({ where: { weddingId: wedding.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(rowBefore.id);
    expect((await api().get(`/api/weddings/${wedding.id}`).set(bearer(member.id))).status).toBe(200);
  });

  it('FR-13: revoked member gets 404 immediately', async () => {
    const { owner, member, wedding } = await setup();
    await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    expect((await api().get(`/api/weddings/${wedding.id}`).set(bearer(member.id))).status).toBe(200);
    await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    expect((await api().get(`/api/weddings/${wedding.id}`).set(bearer(member.id))).status).toBe(404);
    expect((await api().get('/api/weddings').set(bearer(member.id))).body).toEqual([]);
  });

  it('FR-13: revoking an unknown, already-revoked or owner user → 404', async () => {
    const { owner, member, wedding } = await setup();
    const url = (id: string) => `/api/weddings/${wedding.id}/members/${id}`;
    expect((await api().delete(url(member.id)).set(bearer(owner.id))).status).toBe(404); // never a member
    expect((await api().delete(url('00000000-0000-4000-8000-0000000000ff')).set(bearer(owner.id))).status).toBe(404);
    expect((await api().delete(url('not-a-uuid')).set(bearer(owner.id))).status).toBe(404);
    expect((await api().delete(url(owner.id)).set(bearer(owner.id))).status).toBe(404);
    await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: member.email });
    expect((await api().delete(url(member.id)).set(bearer(owner.id))).status).toBe(204);
    expect((await api().delete(url(member.id)).set(bearer(owner.id))).status).toBe(404); // already revoked
  });

  it('FR-13/FR-62: revoke unassigns their tasks and cancels PENDING notifications, deleting nothing', async () => {
    const { owner, member, wedding } = await setup();
    const other = await createWedding(owner.id);
    await prisma.weddingMember.createMany({
      data: [
        { weddingId: wedding.id, userId: member.id },
        { weddingId: other.id, userId: member.id },
      ],
    });
    const mine = await createTask(wedding.id, { assigneeId: member.id });
    const inOther = await createTask(other.id, { assigneeId: member.id });
    const scheduledAt = new Date(Date.now() + 86400000);
    const mk = (taskId: string, channel: 'IN_APP' | 'EMAIL', status: 'PENDING' | 'SENT', at = scheduledAt) =>
      prisma.notification.create({ data: { taskId, userId: member.id, type: 'TASK_DEADLINE_REMINDER', channel, scheduledAt: at, status } });
    const pendingA = await mk(mine.id, 'IN_APP', 'PENDING');
    const pendingB = await mk(mine.id, 'EMAIL', 'PENDING');
    const sent = await mk(mine.id, 'EMAIL', 'SENT', new Date(Date.now() + 2 * 86400000));
    const otherPending = await mk(inOther.id, 'IN_APP', 'PENDING');

    const res = await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    expect(res.status).toBe(204);

    expect((await prisma.task.findUnique({ where: { id: mine.id } }))?.assigneeId).toBeNull();
    expect((await prisma.task.findUnique({ where: { id: inOther.id } }))?.assigneeId).toBe(member.id); // other wedding untouched
    const status = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(pendingA.id)).toBe('CANCELLED');
    expect(await status(pendingB.id)).toBe('CANCELLED');
    expect(await status(sent.id)).toBe('SENT');
    expect(await status(otherPending.id)).toBe('PENDING');
    // nothing deleted
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { taskId: mine.id, userId: member.id } })).toBe(3);
    // phase 5: the unassigned (still upcoming) task now carries the owner's reminders instead
    const ownerRows = await prisma.notification.findMany({ where: { taskId: mine.id, userId: owner.id } });
    expect(ownerRows.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
    expect(await prisma.weddingMember.count({ where: { weddingId: wedding.id } })).toBe(1);
    expect(await prisma.wedding.count({ where: { id: wedding.id } })).toBe(1);
  });

  it('FR-17: team member cannot list/add/revoke members (403)', async () => {
    const { member, wedding } = await setup();
    const { user: third } = await createUser();
    await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
    const list = await api().get(`/api/weddings/${wedding.id}/members`).set(bearer(member.id));
    const add = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(member.id)).send({ email: third.email });
    const del = await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(member.id));
    expect([list.status, add.status, del.status]).toEqual([403, 403, 403]);
    expect(list.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.weddingMember.count({ where: { weddingId: wedding.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('BR-14: non-member gets 404 on member write endpoints', async () => {
    const { member, wedding } = await setup();
    const { user: outsider } = await createUser();
    const add = await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(outsider.id)).send({ email: member.email });
    const del = await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(outsider.id));
    expect([add.status, del.status]).toEqual([404, 404]);
  });

  it('FR-12: list order is active first, then by name', async () => {
    const { owner, wedding } = await setup();
    const { user: zed } = await createUser({ name: 'Zed' });
    const { user: amy } = await createUser({ name: 'Amy' });
    const { user: bob } = await createUser({ name: 'Bob' });
    for (const u of [zed, amy, bob]) await api().post(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id)).send({ email: u.email });
    await api().delete(`/api/weddings/${wedding.id}/members/${amy.id}`).set(bearer(owner.id));
    const list = await api().get(`/api/weddings/${wedding.id}/members`).set(bearer(owner.id));
    expect(list.body.map((m: { name: string }) => m.name)).toEqual(['Bob', 'Zed', 'Amy']);
  });
});

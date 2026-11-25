import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { dateStr, day, makeTask, setupTaskWedding } from './helpers/taskFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const MEMBER_MSG = 'Team members can only change the status and progress notes of tasks assigned to them.';
const url = (weddingId: string, rest = '') => `/api/weddings/${weddingId}/tasks${rest}`;
const GHOST = '11111111-1111-4111-8111-111111111111';

describe('task CRUD (FR-31, FR-32, UC-07)', () => {
  it('FR-31: owner creates a task with defaults and gets the contract shape', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const res = await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: '  Book band  ', dueDate: dateStr(20) });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      title: 'Book band',
      description: null,
      dueDate: dateStr(20),
      priority: 'MEDIUM',
      status: 'TODO',
      progressNotes: null,
      assignee: null,
      isOverdue: false,
      completedAt: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('FR-32: validation errors → 400 with fields', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const bad = async (body: object) => api().post(url(wedding.id)).set(bearer(owner.id)).send(body);
    expect((await bad({ dueDate: dateStr(5) })).body.error.fields.title).toBeDefined();
    expect((await bad({ title: 'x' })).body.error.fields.dueDate).toBeDefined();
    expect((await bad({ title: 'x', dueDate: '2030-02-31' })).status).toBe(400);
    expect((await bad({ title: 'x', dueDate: '2030-01-01T10:00:00Z' })).status).toBe(400);
    expect((await bad({ title: 'x', dueDate: dateStr(5), priority: 'URGENT' })).body.error.fields.priority).toBeDefined();
    expect((await bad({ title: 'x', dueDate: dateStr(5), status: 'DONE' })).body.error.fields.status).toBeDefined();
    expect((await bad({ title: 'x'.repeat(201), dueDate: dateStr(5) })).status).toBe(400);
    expect((await bad({ title: 'x', dueDate: dateStr(5), assigneeId: 'nope' })).body.error.fields.assigneeId).toBeDefined();
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(0);
  });

  it('FR-31: owner edits every field, assigns, unassigns and deletes', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id);
    const patch = await api()
      .patch(url(wedding.id, `/${t.id}`))
      .set(bearer(owner.id))
      .send({ title: 'New', description: 'D', dueDate: dateStr(3), priority: 'HIGH', assigneeId: member.id, progressNotes: 'n' });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({
      title: 'New',
      description: 'D',
      dueDate: dateStr(3),
      priority: 'HIGH',
      progressNotes: 'n',
      assignee: { id: member.id, name: member.name },
    });
    const un = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(owner.id)).send({ assigneeId: null, description: '' });
    expect(un.body.assignee).toBeNull();
    expect(un.body.description).toBeNull();
    expect(un.body.title).toBe('New'); // untouched fields stay
    expect((await api().delete(url(wedding.id, `/${t.id}`)).set(bearer(owner.id))).status).toBe(204);
    expect(await prisma.task.count({ where: { id: t.id } })).toBe(0);
  });

  it('FR-33: completedAt is set when COMPLETED and cleared when status leaves COMPLETED', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id);
    const done = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(owner.id)).send({ status: 'COMPLETED' });
    expect(done.body.completedAt).toEqual(expect.any(String));
    const again = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(owner.id)).send({ status: 'COMPLETED' });
    expect(again.body.completedAt).toBe(done.body.completedAt); // not moved
    const reopened = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(owner.id)).send({ status: 'IN_PROGRESS' });
    expect(reopened.body.completedAt).toBeNull();
    const created = await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: 'Born done', dueDate: dateStr(1), status: 'COMPLETED' });
    expect(created.body.completedAt).toEqual(expect.any(String));
  });

  it('FR-35: overdue is computed from the due date and status, never stored', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const late = await makeTask(wedding.id, { title: 'late', dueDate: day(-1) });
    const lateDone = await makeTask(wedding.id, { title: 'late done', dueDate: day(-1), status: 'COMPLETED' });
    const today = await makeTask(wedding.id, { title: 'today', dueDate: day(0) });
    const list = (await api().get(url(wedding.id)).set(bearer(owner.id))).body as { id: string; isOverdue: boolean }[];
    const flag = (id: string) => list.find((t) => t.id === id)!.isOverdue;
    expect(flag(late.id)).toBe(true);
    expect(flag(lateDone.id)).toBe(false);
    expect(flag(today.id)).toBe(false); // due today is not overdue yet
    // Reschedule into the future: the flag follows without any stored value.
    const moved = await api().patch(url(wedding.id, `/${late.id}`)).set(bearer(owner.id)).send({ dueDate: dateStr(5) });
    expect(moved.body.isOverdue).toBe(false);
  });
});

describe('assignee rule (UC-07)', () => {
  it('UC-07: assignee may be the owner or an active member', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    for (const id of [owner.id, member.id]) {
      const res = await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: 't', dueDate: dateStr(4), assigneeId: id });
      expect(res.status).toBe(201);
      expect(res.body.assignee.id).toBe(id);
    }
  });

  it('UC-07: assignee must be owner or active member (revoked member, outsider and unknown user → 400)', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const { user: outsider } = await createUser();
    const { user: otherOwner } = await createUser();
    const otherWedding = await createWedding(otherOwner.id);
    await prisma.weddingMember.create({ data: { weddingId: otherWedding.id, userId: outsider.id } }); // member elsewhere only
    await prisma.weddingMember.update({
      where: { weddingId_userId: { weddingId: wedding.id, userId: member.id } },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const existing = await makeTask(wedding.id);
    for (const assigneeId of [member.id, outsider.id, otherOwner.id, GHOST]) {
      const create = await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: 't', dueDate: dateStr(4), assigneeId });
      expect(create.status, `create ${assigneeId}`).toBe(400);
      expect(create.body.error.fields.assigneeId).toBe('Assignee must be the owner or an active team member.');
      const patch = await api().patch(url(wedding.id, `/${existing.id}`)).set(bearer(owner.id)).send({ assigneeId });
      expect(patch.status, `patch ${assigneeId}`).toBe(400);
    }
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: existing.id } })).assigneeId).toBeNull();
  });

  it('UC-07: the assignee check is transactional - a member revoked before the write is rejected and nothing is saved', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const ok = await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: 'a', dueDate: dateStr(4), assigneeId: member.id });
    expect(ok.status).toBe(201);
    expect((await api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id))).status).toBe(204);
    // Revoking unassigned the member's tasks (FR-13) ...
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ok.body.id } })).assigneeId).toBeNull();
    // ... and re-assigning is now rejected.
    const again = await api().patch(url(wedding.id, `/${ok.body.id}`)).set(bearer(owner.id)).send({ assigneeId: member.id });
    expect(again.status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ok.body.id } })).assigneeId).toBeNull();
  });

  it('UC-07: concurrent assign + revoke never leaves a task assigned to a revoked member', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const creates = Array.from({ length: 12 }, (_, i) =>
      api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: `t${i}`, dueDate: dateStr(4), assigneeId: member.id }),
    );
    const revoke = api().delete(`/api/weddings/${wedding.id}/members/${member.id}`).set(bearer(owner.id));
    const results = await Promise.all([...creates.map((r) => r.then((x) => x.status)), revoke.then((x) => x.status)]);
    expect(results.every((s) => [201, 400, 204].includes(s))).toBe(true);
    expect(await prisma.task.count({ where: { weddingId: wedding.id, assigneeId: member.id } })).toBe(0);
  });
});

describe('team member updates (BR-03, FR-15, FR-16, AC-03, AC-04)', () => {
  it('AC-03: team member updates status and progress notes of an assigned task but not deadline, priority or assignment', async () => {
    const { owner, member, other, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id, title: 'Mine', dueDate: day(9), priority: 'HIGH' });
    const ok = await api()
      .patch(url(wedding.id, `/${t.id}`))
      .set(bearer(member.id))
      .send({ status: 'IN_PROGRESS', progressNotes: 'Called the florist' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'IN_PROGRESS', progressNotes: 'Called the florist', title: 'Mine', priority: 'HIGH' });

    const before = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    const forbidden: Record<string, unknown>[] = [
      { dueDate: dateStr(30) },
      { priority: 'LOW' },
      { assigneeId: other.id },
      { assigneeId: null },
      { title: 'Hacked' },
      { description: 'x' },
      { priority: 'HIGH' }, // unchanged value is still a forbidden key
      { status: 'COMPLETED', dueDate: dateStr(30) }, // allowed + forbidden mixed → whole request rejected
      { status: 'COMPLETED', unknownField: 1 },
      { completedAt: '2020-01-01T00:00:00Z' },
      { id: GHOST },
    ];
    for (const body of forbidden) {
      const res = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe(MEMBER_MSG);
    }
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).toEqual(before); // DB unchanged
    expect(owner.id).toBeDefined();
  });

  it("AC-04: team member cannot update another member's task via direct API", async () => {
    const { member, other, wedding } = await setupTaskWedding();
    const theirs = await makeTask(wedding.id, { assigneeId: other.id });
    const unassigned = await makeTask(wedding.id);
    for (const t of [theirs, unassigned]) {
      const res = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED', progressNotes: 'mine now' });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe(MEMBER_MSG);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(row).toMatchObject({ status: 'TODO', progressNotes: null, completedAt: null });
    }
  });

  it('BR-03: member status change sets completedAt; a member can reopen their task', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    const done = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(done.body.completedAt).not.toBeNull();
    const reopened = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ status: 'TODO', progressNotes: '' });
    expect(reopened.body).toMatchObject({ status: 'TODO', completedAt: null, progressNotes: null });
  });

  it('BR-03: member task validation (bad status → 400) and a task id from another wedding → 404', async () => {
    const { member, wedding } = await setupTaskWedding();
    const { user: o2 } = await createUser();
    const w2 = await createWedding(o2.id);
    const foreign = await makeTask(w2.id, { assigneeId: member.id });
    const mine = await makeTask(wedding.id, { assigneeId: member.id });
    expect((await api().patch(url(wedding.id, `/${mine.id}`)).set(bearer(member.id)).send({ status: 'DONE' })).status).toBe(400);
    expect((await api().patch(url(wedding.id, `/${foreign.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await api().patch(url(wedding.id, `/${GHOST}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe('TODO');
  });

  it('FR-16: member can read tasks (200) but cannot create or delete (403)', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id);
    expect((await api().get(url(wedding.id)).set(bearer(member.id))).status).toBe(200);
    const post = await api().post(url(wedding.id)).set(bearer(member.id)).send({ title: 'x', dueDate: dateStr(2) });
    expect(post.status).toBe(403);
    expect((await api().delete(url(wedding.id, `/${t.id}`)).set(bearer(member.id))).status).toBe(403);
    expect(await prisma.task.count({ where: { weddingId: wedding.id } })).toBe(1);
  });

  it('BR-14: non-member gets 404 on every task endpoint, revoked member too', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const { user: outsider } = await createUser();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    await prisma.weddingMember.update({
      where: { weddingId_userId: { weddingId: wedding.id, userId: member.id } },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    for (const u of [outsider, member]) {
      const h = bearer(u.id);
      expect((await api().get(url(wedding.id)).set(h)).status).toBe(404);
      expect((await api().post(url(wedding.id)).set(h).send({ title: 'x', dueDate: dateStr(2) })).status).toBe(404);
      expect((await api().patch(url(wedding.id, `/${t.id}`)).set(h).send({ status: 'COMPLETED' })).status).toBe(404);
      expect((await api().patch(url(wedding.id, `/${t.id}`)).set(h).send({ title: 'x' })).status).toBe(404);
      expect((await api().delete(url(wedding.id, `/${t.id}`)).set(h)).status).toBe(404);
    }
    expect(owner.id).toBeDefined();
  });

  it('BR-13: archived wedding is read-only for everyone (409), also for the assigned member', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    const memberRes = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(memberRes.status).toBe(409);
    // a forbidden field is still reported as 403 first
    expect((await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ priority: 'LOW' })).status).toBe(403);
    expect((await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(owner.id)).send({ title: 'x' })).status).toBe(409);
    expect((await api().post(url(wedding.id)).set(bearer(owner.id)).send({ title: 'x', dueDate: dateStr(2) })).status).toBe(409);
    expect((await api().delete(url(wedding.id, `/${t.id}`)).set(bearer(owner.id))).status).toBe(409);
    expect((await api().get(url(wedding.id)).set(bearer(member.id))).status).toBe(200);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: 'TODO', title: 'Task' });
  });
});

describe('member PATCH error precedence (401 > 404 > 403 > 409, rule 3 beats validation)', () => {
  it('BR-03: a forbidden key beats value validation - {status:"BAD", title:"x"} from a member → 403, not 400', async () => {
    const { member, wedding } = await setupTaskWedding();
    const t = await makeTask(wedding.id, { assigneeId: member.id });
    for (const body of [{ status: 'BAD', title: 'x' }, { title: 123 }, { dueDate: 'garbage', progressNotes: 'ok' }]) {
      const res = await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.message).toBe(MEMBER_MSG);
    }
    // allowed keys with a bad value are still a normal validation error
    expect((await api().patch(url(wedding.id, `/${t.id}`)).set(bearer(member.id)).send({ status: 'BAD' })).status).toBe(400);
  });

  it("BR-13: on an archived wedding a member's task that isn't theirs → 403 (not 409); their own task → 409", async () => {
    const { owner, member, other, wedding } = await setupTaskWedding();
    const mine = await makeTask(wedding.id, { assigneeId: member.id });
    const theirs = await makeTask(wedding.id, { assigneeId: other.id });
    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    const notMine = await api().patch(url(wedding.id, `/${theirs.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' });
    expect(notMine.status).toBe(403);
    expect(notMine.body.error.message).toBe(MEMBER_MSG);
    expect((await api().patch(url(wedding.id, `/${mine.id}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status).toBe(409);
    expect(await prisma.task.count({ where: { weddingId: wedding.id, status: 'COMPLETED' } })).toBe(0);
  });

  it('BR-14: a missing task → 404 for a member, also on an archived wedding', async () => {
    const { owner, member, wedding } = await setupTaskWedding();
    expect((await api().patch(url(wedding.id, `/${GHOST}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await api().post(`/api/weddings/${wedding.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    expect((await api().patch(url(wedding.id, `/${GHOST}`)).set(bearer(member.id)).send({ status: 'COMPLETED' })).status).toBe(404);
  });
});

describe('cross-wedding isolation and 404s', () => {
  it('BR-14: a task id from another wedding → 404 for PATCH and DELETE, and nothing changes', async () => {
    const { owner, wedding } = await setupTaskWedding();
    const { user: o2 } = await createUser();
    const w2 = await createWedding(o2.id);
    const foreign = await makeTask(w2.id, { title: 'Foreign' });
    const patch = await api().patch(url(wedding.id, `/${foreign.id}`)).set(bearer(owner.id)).send({ title: 'Changed' });
    expect(patch.status).toBe(404);
    expect(patch.body.error.message).toBe('Task not found.');
    expect((await api().delete(url(wedding.id, `/${foreign.id}`)).set(bearer(owner.id))).status).toBe(404);
    expect((await api().patch(url(wedding.id, '/not-a-uuid')).set(bearer(owner.id)).send({ title: 'x' })).status).toBe(404);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ title: 'Foreign' });
    const list = await api().get(url(wedding.id)).set(bearer(owner.id));
    expect(list.body).toEqual([]);
  });
});

describe('list filters and sort (FR-35)', () => {
  it('FR-32: sorted by due date, then priority (HIGH first), then title', async () => {
    const { owner, wedding } = await setupTaskWedding();
    await makeTask(wedding.id, { title: 'c-low', dueDate: day(5), priority: 'LOW' });
    await makeTask(wedding.id, { title: 'b-high', dueDate: day(5), priority: 'HIGH' });
    await makeTask(wedding.id, { title: 'a-high', dueDate: day(5), priority: 'HIGH' });
    await makeTask(wedding.id, { title: 'z-first', dueDate: day(1), priority: 'LOW' });
    await makeTask(wedding.id, { title: 'm-med', dueDate: day(5), priority: 'MEDIUM' });
    const res = await api().get(url(wedding.id)).set(bearer(owner.id));
    expect(res.body.map((t: { title: string }) => t.title)).toEqual(['z-first', 'a-high', 'b-high', 'm-med', 'c-low']);
  });

  it('FR-32: filters assignee=me|unassigned|<id>, status and overdue=true', async () => {
    const { owner, member, other, wedding } = await setupTaskWedding();
    const mine = await makeTask(wedding.id, { title: 'mine', assigneeId: member.id, status: 'IN_PROGRESS' });
    const theirs = await makeTask(wedding.id, { title: 'theirs', assigneeId: other.id });
    const free = await makeTask(wedding.id, { title: 'free', dueDate: day(-3) });
    const doneLate = await makeTask(wedding.id, { title: 'done late', dueDate: day(-3), status: 'COMPLETED' });
    const ids = async (q: string, as = owner.id) =>
      ((await api().get(url(wedding.id) + q).set(bearer(as))).body as { id: string }[]).map((t) => t.id).sort();
    expect(await ids('?assignee=me', member.id)).toEqual([mine.id]);
    expect(await ids('?assignee=me')).toEqual([]); // owner has none
    expect(await ids('?assignee=unassigned')).toEqual([free.id, doneLate.id].sort());
    expect(await ids(`?assignee=${other.id}`)).toEqual([theirs.id]);
    expect(await ids('?status=IN_PROGRESS')).toEqual([mine.id]);
    expect(await ids('?overdue=true')).toEqual([free.id]);
    expect(await ids('?overdue=true&status=COMPLETED')).toEqual([]);
    expect(await ids('?overdue=true&assignee=unassigned&status=TODO')).toEqual([free.id]);
    expect((await ids('?overdue=false')).length).toBe(4);
    expect((await api().get(url(wedding.id) + '?status=BOGUS').set(bearer(owner.id))).status).toBe(400);
    expect((await api().get(url(wedding.id) + '?assignee=nobody').set(bearer(owner.id))).status).toBe(400);
    expect((await api().get(url(wedding.id) + '?overdue=maybe').set(bearer(owner.id))).status).toBe(400);
  });
});

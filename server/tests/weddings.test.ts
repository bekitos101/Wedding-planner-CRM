import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createTask, createUser, createWedding } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const valid = {
  coupleNames: 'Emma & Daniel',
  weddingDate: '2027-06-12',
  location: 'Lake Balaton',
  totalBudget: '25000',
  rsvpDeadline: '2027-05-12',
};

describe('create wedding', () => {
  it('AC-01: planner can create at least two weddings and sees both in the list', async () => {
    const { user } = await createUser();
    const a = await api().post('/api/weddings').set(bearer(user.id)).send(valid);
    const b = await api()
      .post('/api/weddings')
      .set(bearer(user.id))
      .send({ ...valid, coupleNames: 'Sofia & Marco', weddingDate: '2027-09-01', rsvpDeadline: '2027-08-01', totalBudget: 18000.5 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body).toMatchObject({
      coupleNames: 'Emma & Daniel',
      totalBudget: '25000.00',
      weddingDate: '2027-06-12',
      status: 'ACTIVE',
      archivedAt: null,
      role: 'OWNER',
      owner: { id: user.id, name: user.name },
      progress: { completed: 0, total: 0, percent: 0 },
    });
    expect(b.body.totalBudget).toBe('18000.50');
    const list = await api().get('/api/weddings').set(bearer(user.id));
    expect(list.status).toBe(200);
    expect(list.body.map((w: { id: string }) => w.id)).toEqual([a.body.id, b.body.id]); // by weddingDate asc
  });

  it('BR-01: the creator is the owner and gets no member row', async () => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send(valid);
    expect(await prisma.wedding.findUnique({ where: { id: res.body.id } })).toMatchObject({ ownerId: user.id });
    expect(await prisma.weddingMember.count({ where: { weddingId: res.body.id } })).toBe(0);
  });

  it('FR-07: rsvpDeadline after weddingDate → 400 fields.rsvpDeadline', async () => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, rsvpDeadline: '2027-07-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.rsvpDeadline).toBeDefined();
  });

  it('FR-07: rsvpDeadline equal to weddingDate is allowed', async () => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, rsvpDeadline: valid.weddingDate });
    expect(res.status).toBe(201);
  });

  it.each([
    ['negative budget', { totalBudget: -1 }, 'totalBudget'],
    ['negative budget string', { totalBudget: '-5.00' }, 'totalBudget'],
    ['3-decimal budget', { totalBudget: '10.123' }, 'totalBudget'],
    ['float-noise budget', { totalBudget: 0.1 + 0.2 }, 'totalBudget'],
    ['non-numeric budget', { totalBudget: 'abc' }, 'totalBudget'],
    ['impossible date', { weddingDate: '2027-02-30' }, 'weddingDate'],
    ['date with time part', { weddingDate: '2027-06-12T10:00:00Z' }, 'weddingDate'],
    ['deadline with time part', { rsvpDeadline: '2027-05-12T00:00:00.000Z' }, 'rsvpDeadline'],
    ['padded date', { weddingDate: ' 2027-06-12' }, 'weddingDate'],
    ['non-padded date', { weddingDate: '2027-6-12' }, 'weddingDate'],
    ['date before 2000', { weddingDate: '1999-12-31', rsvpDeadline: '1999-12-01' }, 'weddingDate'],
    ['date after 2100', { weddingDate: '2101-01-01' }, 'weddingDate'],
    ['numeric date', { weddingDate: 20270612 }, 'weddingDate'],
    ['not a date', { weddingDate: 'tomorrow' }, 'weddingDate'],
    ['empty couple names', { coupleNames: '   ' }, 'coupleNames'],
    ['too long location', { location: 'x'.repeat(201) }, 'location'],
  ])('NFR-04: %s → 400', async (_label, override, field) => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.fields[field]).toBeDefined();
  });

  it('NFR-04: missing fields → 400 listing each field', async () => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send({});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['coupleNames', 'location', 'rsvpDeadline', 'totalBudget', 'weddingDate']);
  });

  it('NFR-04: zero budget is accepted', async () => {
    const { user } = await createUser();
    const res = await api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, totalBudget: 0 });
    expect(res.status).toBe(201);
    expect(res.body.totalBudget).toBe('0.00');
  });
});

describe('update wedding', () => {
  it('FR-08: owner edits wedding info', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const res = await api().patch(`/api/weddings/${w.id}`).set(bearer(user.id)).send({ coupleNames: 'New Names', totalBudget: '999.9' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ coupleNames: 'New Names', totalBudget: '999.90', location: 'Budapest' });
  });

  it('FR-08: PATCH checks the date rule against merged values', async () => {
    const { user } = await createUser();
    const created = await api().post('/api/weddings').set(bearer(user.id)).send(valid); // wedding 2027-06-12, deadline 2027-05-12
    const id = created.body.id as string;
    const bad1 = await api().patch(`/api/weddings/${id}`).set(bearer(user.id)).send({ weddingDate: '2027-04-01' });
    expect(bad1.status).toBe(400);
    expect(bad1.body.error.fields.rsvpDeadline).toBeDefined();
    const bad2 = await api().patch(`/api/weddings/${id}`).set(bearer(user.id)).send({ rsvpDeadline: '2027-06-13' });
    expect(bad2.status).toBe(400);
    const ok = await api().patch(`/api/weddings/${id}`).set(bearer(user.id)).send({ weddingDate: '2027-04-01', rsvpDeadline: '2027-03-01' });
    expect(ok.status).toBe(200);
    expect(ok.body.weddingDate).toBe('2027-04-01');
    expect(ok.body.rsvpDeadline).toBe('2027-03-01');
  });

  it('FR-17: PATCH ignores status, ownerId and id', async () => {
    const { user } = await createUser();
    const { user: other } = await createUser();
    const w = await createWedding(user.id);
    const res = await api()
      .patch(`/api/weddings/${w.id}`)
      .set(bearer(user.id))
      .send({ status: 'ARCHIVED', ownerId: other.id, id: '00000000-0000-4000-8000-0000000000aa', location: 'Vienna' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: w.id, status: 'ACTIVE', location: 'Vienna', owner: { id: user.id } });
    expect(await prisma.wedding.findUnique({ where: { id: w.id } })).toMatchObject({ ownerId: user.id, status: 'ACTIVE' });
  });

  it('FR-17: team member cannot PATCH or archive (403), outsider gets 404', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const { user: outsider } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    expect((await api().patch(`/api/weddings/${w.id}`).set(bearer(member.id)).send({ location: 'X' })).status).toBe(403);
    expect((await api().post(`/api/weddings/${w.id}/archive`).set(bearer(member.id))).status).toBe(403);
    expect((await api().patch(`/api/weddings/${w.id}`).set(bearer(outsider.id)).send({ location: 'X' })).status).toBe(404);
    expect((await api().post(`/api/weddings/${w.id}/archive`).set(bearer(outsider.id))).status).toBe(404);
    expect((await prisma.wedding.findUnique({ where: { id: w.id } }))?.location).toBe('Budapest');
  });
});

describe('list and roles', () => {
  it('FR-10: list shows progress (1 of 4 completed → 25, no tasks → 0)', async () => {
    const { user } = await createUser();
    const withTasks = await createWedding(user.id, { coupleNames: 'Has Tasks' });
    const empty = await createWedding(user.id, { coupleNames: 'No Tasks' });
    const done = await createTask(withTasks.id);
    await prisma.task.update({ where: { id: done.id }, data: { status: 'COMPLETED' } });
    await createTask(withTasks.id);
    await createTask(withTasks.id);
    const t = await createTask(withTasks.id);
    await prisma.task.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    const res = await api().get('/api/weddings').set(bearer(user.id));
    const by = (id: string) => res.body.find((w: { id: string }) => w.id === id);
    expect(by(withTasks.id).progress).toEqual({ completed: 1, total: 4, percent: 25 });
    expect(by(empty.id).progress).toEqual({ completed: 0, total: 0, percent: 0 });
    const one = await api().get(`/api/weddings/${withTasks.id}`).set(bearer(user.id));
    expect(one.body.progress).toEqual({ completed: 1, total: 4, percent: 25 });
  });

  it('FR-10: progress percent is floored', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const t = await createTask(w.id);
    await prisma.task.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });
    await createTask(w.id);
    await createTask(w.id);
    const res = await api().get(`/api/weddings/${w.id}`).set(bearer(user.id));
    expect(res.body.progress).toEqual({ completed: 1, total: 3, percent: 33 });
  });

  it('BR-13: archived wedding excluded from default list, shown with ?status=archived', async () => {
    const { user } = await createUser();
    const active = await createWedding(user.id);
    const toArchive = await createWedding(user.id);
    const arch = await api().post(`/api/weddings/${toArchive.id}/archive`).set(bearer(user.id));
    expect(arch.status).toBe(200);
    expect(arch.body.status).toBe('ARCHIVED');
    expect(arch.body.archivedAt).toEqual(expect.any(String));
    const def = await api().get('/api/weddings').set(bearer(user.id));
    expect(def.body.map((w: { id: string }) => w.id)).toEqual([active.id]);
    const archived = await api().get('/api/weddings?status=archived').set(bearer(user.id));
    expect(archived.body.map((w: { id: string }) => w.id)).toEqual([toArchive.id]);
    expect((await api().get('/api/weddings?status=bogus').set(bearer(user.id))).status).toBe(400);
    expect((await api().get(`/api/weddings/${toArchive.id}`).set(bearer(user.id))).status).toBe(200);
  });

  it('BR-13: archived wedding is read-only (PATCH → 409, add member → 409)', async () => {
    const { user } = await createUser();
    const { user: other } = await createUser();
    const w = await createWedding(user.id);
    await api().post(`/api/weddings/${w.id}/archive`).set(bearer(user.id));
    const patch = await api().patch(`/api/weddings/${w.id}`).set(bearer(user.id)).send({ location: 'Nowhere' });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toMatchObject({ code: 'CONFLICT', message: "This wedding is archived and can't be changed." });
    const add = await api().post(`/api/weddings/${w.id}/members`).set(bearer(user.id)).send({ email: other.email });
    expect(add.status).toBe(409);
    expect((await prisma.wedding.findUnique({ where: { id: w.id } }))?.location).toBe('Budapest');
  });

  it('BR-13: revoking a member is still allowed on an archived wedding (204)', async () => {
    const { user } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(user.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    await api().post(`/api/weddings/${w.id}/archive`).set(bearer(user.id));
    const del = await api().delete(`/api/weddings/${w.id}/members/${member.id}`).set(bearer(user.id));
    expect(del.status).toBe(204);
    expect((await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: w.id } })).status).toBe('REVOKED');
    expect((await api().get(`/api/weddings/${w.id}`).set(bearer(member.id))).status).toBe(404);
  });

  it('BR-13: archive is idempotent and keeps the first archivedAt', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const first = await api().post(`/api/weddings/${w.id}/archive`).set(bearer(user.id));
    const second = await api().post(`/api/weddings/${w.id}/archive`).set(bearer(user.id));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.archivedAt).toBe(first.body.archivedAt);
  });

  it('FR-14: member sees role TEAM_MEMBER, owner sees OWNER', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    const asOwner = await api().get(`/api/weddings/${w.id}`).set(bearer(owner.id));
    const asMember = await api().get(`/api/weddings/${w.id}`).set(bearer(member.id));
    expect(asOwner.body.role).toBe('OWNER');
    expect(asMember.status).toBe(200);
    expect(asMember.body.role).toBe('TEAM_MEMBER');
    expect(asMember.body.owner).toEqual({ id: owner.id, name: owner.name });
    const list = await api().get('/api/weddings').set(bearer(member.id));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].role).toBe('TEAM_MEMBER');
  });

  it('FR-11: list includes member-of weddings but not revoked ones or other planners’ weddings', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const { user: stranger } = await createUser();
    const joined = await createWedding(owner.id);
    const revoked = await createWedding(owner.id);
    await createWedding(stranger.id);
    await prisma.weddingMember.create({ data: { weddingId: joined.id, userId: member.id } });
    await prisma.weddingMember.create({ data: { weddingId: revoked.id, userId: member.id, status: 'REVOKED', revokedAt: new Date() } });
    const list = await api().get('/api/weddings').set(bearer(member.id));
    expect(list.body.map((w: { id: string }) => w.id)).toEqual([joined.id]);
  });
});

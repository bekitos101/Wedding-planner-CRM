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

describe('IDOR across weddings (BR-14)', () => {
  it('BR-14: owner A using wedding B id gets 404 on every route and nothing changes', async () => {
    const { user: a } = await createUser();
    const { user: b } = await createUser();
    const { user: bMember } = await createUser();
    const wB = await createWedding(b.id);
    await prisma.weddingMember.create({ data: { weddingId: wB.id, userId: bMember.id } });
    const base = `/api/weddings/${wB.id}`;
    const results = [
      await api().get(base).set(bearer(a.id)),
      await api().patch(base).set(bearer(a.id)).send({ location: 'Hacked' }),
      await api().post(`${base}/archive`).set(bearer(a.id)),
      await api().get(`${base}/members`).set(bearer(a.id)),
      await api().post(`${base}/members`).set(bearer(a.id)).send({ email: a.email }),
      await api().delete(`${base}/members/${bMember.id}`).set(bearer(a.id)),
    ];
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
    const w = await prisma.wedding.findUniqueOrThrow({ where: { id: wB.id } });
    expect(w).toMatchObject({ location: 'Budapest', status: 'ACTIVE', ownerId: b.id });
    expect(await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: wB.id } })).toMatchObject({ userId: bMember.id, status: 'ACTIVE', revokedAt: null });
  });

  it('BR-14: owner A deleting a member of wedding B via wedding A path → 404, B membership untouched', async () => {
    const { user: a } = await createUser();
    const { user: b } = await createUser();
    const { user: bMember } = await createUser();
    const wA = await createWedding(a.id);
    const wB = await createWedding(b.id);
    await prisma.weddingMember.create({ data: { weddingId: wB.id, userId: bMember.id } });
    const res = await api().delete(`/api/weddings/${wA.id}/members/${bMember.id}`).set(bearer(a.id));
    expect(res.status).toBe(404);
    expect(await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: wB.id } })).toMatchObject({ status: 'ACTIVE', revokedAt: null });
  });

  it('BR-14: adding a member of wedding B to wedding A works and does not affect B', async () => {
    const { user: a } = await createUser();
    const { user: b } = await createUser();
    const { user: shared } = await createUser();
    const wA = await createWedding(a.id);
    const wB = await createWedding(b.id);
    await prisma.weddingMember.create({ data: { weddingId: wB.id, userId: shared.id } });
    const res = await api().post(`/api/weddings/${wA.id}/members`).set(bearer(a.id)).send({ email: shared.email });
    expect(res.status).toBe(201);
    expect(await prisma.weddingMember.count({ where: { weddingId: wB.id, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.weddingMember.count({ where: { weddingId: wA.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('BR-14: 403/404/409 bodies leak no other wedding data or stack traces', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const { user: outsider } = await createUser();
    const w = await createWedding(owner.id, { coupleNames: 'SecretCouple' });
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    const r403 = await api().get(`/api/weddings/${w.id}/members`).set(bearer(member.id));
    const r404 = await api().get(`/api/weddings/${w.id}`).set(bearer(outsider.id));
    await api().post(`/api/weddings/${w.id}/archive`).set(bearer(owner.id));
    const r409 = await api().patch(`/api/weddings/${w.id}`).set(bearer(owner.id)).send({ location: 'X' });
    expect([r403.status, r404.status, r409.status]).toEqual([403, 404, 409]);
    for (const r of [r403, r404, r409]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain('SecretCouple');
      expect(text).not.toContain(owner.email);
      expect(text).not.toContain(owner.id);
      expect(text).not.toMatch(/\bat .*\.(ts|js):\d+/);
      expect(text).not.toContain('stack');
      expect(text).not.toContain('prisma');
      expect(Object.keys(r.body)).toEqual(['error']);
    }
  });
});

describe('membership cycles (BR-02, FR-13)', () => {
  it('BR-02: revoke then re-add regains access, with exactly one row across two cycles', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(owner.id);
    const url = `/api/weddings/${w.id}/members`;
    await api().post(url).set(bearer(owner.id)).send({ email: member.email });
    for (let i = 0; i < 2; i++) {
      expect((await api().delete(`${url}/${member.id}`).set(bearer(owner.id))).status).toBe(204);
      expect((await api().get(`/api/weddings/${w.id}`).set(bearer(member.id))).status).toBe(404);
      const re = await api().post(url).set(bearer(owner.id)).send({ email: member.email });
      expect(re.status).toBe(200);
      expect((await api().get(`/api/weddings/${w.id}`).set(bearer(member.id))).status).toBe(200);
    }
    expect(await prisma.weddingMember.count({ where: { weddingId: w.id, userId: member.id } })).toBe(1);
  });

  it('FR-13: revoking on wedding 1 does not affect same user on wedding 2', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w1 = await createWedding(owner.id);
    const w2 = await createWedding(owner.id);
    await prisma.weddingMember.createMany({
      data: [
        { weddingId: w1.id, userId: member.id },
        { weddingId: w2.id, userId: member.id },
      ],
    });
    expect((await api().delete(`/api/weddings/${w1.id}/members/${member.id}`).set(bearer(owner.id))).status).toBe(204);
    expect((await api().get(`/api/weddings/${w1.id}`).set(bearer(member.id))).status).toBe(404);
    expect((await api().get(`/api/weddings/${w2.id}`).set(bearer(member.id))).status).toBe(200);
    expect((await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: w2.id } })).status).toBe('ACTIVE');
  });

  it('BR-01: owner cannot be added as member even with different casing and spaces', async () => {
    const { user: owner } = await createUser();
    const w = await createWedding(owner.id);
    for (const email of [owner.email.toUpperCase(), `  ${owner.email}  `, ` ${owner.email.toUpperCase()} `]) {
      const res = await api().post(`/api/weddings/${w.id}/members`).set(bearer(owner.id)).send({ email });
      expect(res.status, email).toBe(400);
    }
    expect(await prisma.weddingMember.count({ where: { weddingId: w.id } })).toBe(0);
  });

  it('BR-01: owner cannot be revoked (DELETE with ownerId → 404) and keeps access', async () => {
    const { user: owner } = await createUser();
    const w = await createWedding(owner.id);
    const res = await api().delete(`/api/weddings/${w.id}/members/${owner.id}`).set(bearer(owner.id));
    expect(res.status).toBe(404);
    expect((await api().get(`/api/weddings/${w.id}`).set(bearer(owner.id))).body.role).toBe('OWNER');
  });
});

describe('privilege escalation (FR-17, FR-18)', () => {
  it('FR-17: team member cannot archive or PATCH ownerId/status (403) and DB is unchanged', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    const archive = await api().post(`/api/weddings/${w.id}/archive`).set(bearer(member.id));
    const patch = await api().patch(`/api/weddings/${w.id}`).set(bearer(member.id)).send({ ownerId: member.id, status: 'ARCHIVED' });
    expect([archive.status, patch.status]).toEqual([403, 403]);
    expect(await prisma.wedding.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ ownerId: owner.id, status: 'ACTIVE', archivedAt: null });
  });

  it('FR-17: owner PATCH with ownerId/status only is a no-op (DB unchanged)', async () => {
    const { user: owner } = await createUser();
    const { user: other } = await createUser();
    const w = await createWedding(owner.id);
    const res = await api().patch(`/api/weddings/${w.id}`).set(bearer(owner.id)).send({ ownerId: other.id, status: 'ARCHIVED', archivedAt: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(await prisma.wedding.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({ ownerId: owner.id, status: 'ACTIVE', archivedAt: null });
  });

  it('FR-18: revoked member cannot use owner routes (404, not 403)', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id, status: 'REVOKED', revokedAt: new Date() } });
    const res = await api().post(`/api/weddings/${w.id}/archive`).set(bearer(member.id));
    expect(res.status).toBe(404);
  });
});

describe('archived weddings (BR-13)', () => {
  it('BR-13: archived wedding stays readable for owner and member, hidden from member default list, in archived list', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    expect((await api().post(`/api/weddings/${w.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    const asOwner = await api().get(`/api/weddings/${w.id}`).set(bearer(owner.id));
    const asMember = await api().get(`/api/weddings/${w.id}`).set(bearer(member.id));
    expect([asOwner.status, asMember.status]).toEqual([200, 200]);
    expect(asMember.body.status).toBe('ARCHIVED');
    expect((await api().get('/api/weddings').set(bearer(member.id))).body).toEqual([]);
    const archived = await api().get('/api/weddings?status=archived').set(bearer(member.id));
    expect(archived.body.map((x: { id: string }) => x.id)).toEqual([w.id]);
  });

  it('BR-13: archiving twice returns 200; on an archived wedding list is 200, add/PATCH 409, revoke 204', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const { user: newbie } = await createUser();
    const w = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: w.id, userId: member.id } });
    await api().post(`/api/weddings/${w.id}/archive`).set(bearer(owner.id));
    expect((await api().post(`/api/weddings/${w.id}/archive`).set(bearer(owner.id))).status).toBe(200);
    expect((await api().get(`/api/weddings/${w.id}/members`).set(bearer(owner.id))).status).toBe(200);
    const add = await api().post(`/api/weddings/${w.id}/members`).set(bearer(owner.id)).send({ email: newbie.email });
    const del = await api().delete(`/api/weddings/${w.id}/members/${member.id}`).set(bearer(owner.id));
    const patch = await api().patch(`/api/weddings/${w.id}`).set(bearer(owner.id)).send({ location: 'Z' });
    expect([add.status, del.status, patch.status]).toEqual([409, 204, 409]);
    expect(await prisma.weddingMember.count({ where: { weddingId: w.id } })).toBe(1); // newbie was not added
    expect((await prisma.weddingMember.findFirstOrThrow({ where: { weddingId: w.id } })).status).toBe('REVOKED');
  });
});

describe('progress math (FR-10)', () => {
  const progressFor = async (ownerId: string, weddingId: string) =>
    (await api().get(`/api/weddings/${weddingId}`).set(bearer(ownerId))).body.progress;

  it('FR-10: 0 tasks → 0, 1/3 → 33, 2/3 → 66 (floor), all done → 100, other wedding tasks ignored', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const other = await createWedding(user.id);
    expect(await progressFor(user.id, w.id)).toEqual({ completed: 0, total: 0, percent: 0 });

    const t1 = await createTask(w.id);
    const t2 = await createTask(w.id);
    const t3 = await createTask(w.id);
    // noise in another wedding: all completed, must not count
    for (let i = 0; i < 5; i++) {
      const o = await createTask(other.id);
      await prisma.task.update({ where: { id: o.id }, data: { status: 'COMPLETED' } });
    }
    const done = (id: string) => prisma.task.update({ where: { id }, data: { status: 'COMPLETED' } });
    await done(t1.id);
    expect(await progressFor(user.id, w.id)).toEqual({ completed: 1, total: 3, percent: 33 });
    await done(t2.id);
    expect(await progressFor(user.id, w.id)).toEqual({ completed: 2, total: 3, percent: 66 });
    await done(t3.id);
    expect(await progressFor(user.id, w.id)).toEqual({ completed: 3, total: 3, percent: 100 });
    expect(await progressFor(user.id, other.id)).toEqual({ completed: 5, total: 5, percent: 100 });
  });
});

describe('progress floor (FR-10)', () => {
  it('FR-10: 199/200 → 99, never 100 until everything is done', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const due = new Date(Date.now() + 86400000);
    await prisma.task.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({ weddingId: w.id, title: `T${i}`, dueDate: due, status: i < 199 ? ('COMPLETED' as const) : ('TODO' as const) })),
    });
    const res = await api().get(`/api/weddings/${w.id}`).set(bearer(user.id));
    expect(res.body.progress).toEqual({ completed: 199, total: 200, percent: 99 });
  });
});

describe('money validation (NFR-04)', () => {
  const create = async (totalBudget: unknown) => {
    const { user } = await createUser();
    return api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, totalBudget });
  };

  it.each([
    ['"0"', '0', '0.00'],
    ['"0.00"', '0.00', '0.00'],
    ['number 12345678.9', 12345678.9, '12345678.90'],
    ['padded " 100 "', ' 100 ', '100.00'],
    ['"7.5"', '7.5', '7.50'],
    ['max 10 integer digits', '9999999999.99', '9999999999.99'],
  ])('NFR-04: accepts %s and returns a 2-decimal string', async (_l, input, expected) => {
    const res = await create(input);
    expect(res.status).toBe(201);
    expect(res.body.totalBudget).toBe(expected);
  });

  it.each([
    ['"1e3"', '1e3'],
    ['number 1e21', 1e21],
    ['11 integer digits', '10000000000'],
    ['huge number', 99999999999999],
    ['3 decimals', '1.234'],
    ['negative', '-0.01'],
    ['empty string', ''],
    ['plus sign', '+5'],
    ['comma decimal', '1,5'],
    ['null', null],
    ['boolean', true],
    ['array', [100]],
  ])('NFR-04: rejects %s with 400 (not 500)', async (_l, input) => {
    const res = await create(input);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.totalBudget).toBeDefined();
  });

  it('NFR-04: PATCH with out-of-range budget → 400 and value unchanged', async () => {
    const { user } = await createUser();
    const w = await createWedding(user.id);
    const res = await api().patch(`/api/weddings/${w.id}`).set(bearer(user.id)).send({ totalBudget: '100000000000.00' });
    expect(res.status).toBe(400);
    expect((await prisma.wedding.findUniqueOrThrow({ where: { id: w.id } })).totalBudget.toString()).toBe('10000');
  });

  it('NFR-04: responses always carry 2-decimal budget strings in GET and list', async () => {
    const { user } = await createUser();
    const created = await api().post('/api/weddings').set(bearer(user.id)).send({ ...valid, totalBudget: 5 });
    const one = await api().get(`/api/weddings/${created.body.id}`).set(bearer(user.id));
    const list = await api().get('/api/weddings').set(bearer(user.id));
    expect(one.body.totalBudget).toBe('5.00');
    expect(list.body[0].totalBudget).toBe('5.00');
  });
});

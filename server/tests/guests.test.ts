import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function setup() {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const { user: stranger } = await createUser();
  const wedding = await createWedding(owner.id);
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  return { owner, member, stranger, wedding };
}
const base = (weddingId: string) => `/api/weddings/${weddingId}/guests`;

describe('guests CRUD (FR-19..21, BR-04)', () => {
  it('FR-19/20: owner creates, edits, searches, filters and deletes guests', async () => {
    const { owner, wedding } = await setup();
    const h = bearer(owner.id);
    const a = await api().post(base(wedding.id)).set(h).send({ name: '  Alice Smith ', email: 'ALICE@Test.local', dietaryRequirements: 'Vegan' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      name: 'Alice Smith',
      email: 'alice@test.local',
      rsvpStatus: 'PENDING',
      dietaryRequirements: 'Vegan',
      respondedAt: null,
      invitation: null,
    });
    expect(JSON.stringify(a.body)).not.toMatch(/token/i);
    const b = await api().post(base(wedding.id)).set(h).send({ name: 'Bob Jones', email: 'bob@test.local', dietaryRequirements: '' });
    expect(b.body.dietaryRequirements).toBeNull();

    const list = await api().get(base(wedding.id)).set(h);
    expect(list.status).toBe(200);
    expect(list.body.guests.map((g: { name: string }) => g.name)).toEqual(['Alice Smith', 'Bob Jones']);
    expect(list.body.summary).toEqual({ total: 2, pending: 2, accepted: 0, declined: 0 });

    expect((await api().get(`${base(wedding.id)}?search=ALI`).set(h)).body.guests).toHaveLength(1);
    expect((await api().get(`${base(wedding.id)}?search=bob@test`).set(h)).body.guests).toHaveLength(1);

    const patch = await api().patch(`${base(wedding.id)}/${a.body.id}`).set(h).send({ name: 'Alice Brown', dietaryRequirements: '' });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ name: 'Alice Brown', dietaryRequirements: null, email: 'alice@test.local' });

    const manual = await api().patch(`${base(wedding.id)}/${b.body.id}`).set(h).send({ rsvpStatus: 'ACCEPTED' });
    expect(manual.body).toMatchObject({ rsvpStatus: 'ACCEPTED', respondedAt: expect.any(String) });
    const filtered = await api().get(`${base(wedding.id)}?rsvpStatus=ACCEPTED`).set(h);
    expect(filtered.body.guests).toHaveLength(1);
    expect(filtered.body.summary).toEqual({ total: 2, pending: 1, accepted: 1, declined: 0 }); // ignores filters
    const back = await api().patch(`${base(wedding.id)}/${b.body.id}`).set(h).send({ rsvpStatus: 'PENDING' });
    expect(back.body).toMatchObject({ rsvpStatus: 'PENDING', respondedAt: null });

    expect((await api().delete(`${base(wedding.id)}/${a.body.id}`).set(h)).status).toBe(204);
    expect((await api().get(base(wedding.id)).set(h)).body.guests).toHaveLength(1);
  });

  it('BR-04: two guests may share an email and stay separate records', async () => {
    const { owner, wedding } = await setup();
    const h = bearer(owner.id);
    const one = await api().post(base(wedding.id)).set(h).send({ name: 'Couple One', email: 'couple@test.local' });
    const two = await api().post(base(wedding.id)).set(h).send({ name: 'Couple Two', email: 'couple@test.local' });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(one.body.id).not.toBe(two.body.id);
    expect(await prisma.guest.count({ where: { weddingId: wedding.id, email: 'couple@test.local' } })).toBe(2);
  });

  it('NFR-04: invalid input → 400 with fields', async () => {
    const { owner, wedding } = await setup();
    const h = bearer(owner.id);
    const res = await api().post(base(wedding.id)).set(h).send({ name: '', email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toMatchObject({ name: expect.any(String), email: expect.any(String) });
    expect((await api().post(base(wedding.id)).set(h).send({ name: 'x'.repeat(151), email: 'a@b.co' })).status).toBe(400);
    expect((await api().post(base(wedding.id)).set(h).send({ name: 'A', email: 'a@b.co', dietaryRequirements: 'x'.repeat(501) })).status).toBe(400);
    const g = await createGuest(wedding.id);
    expect((await api().patch(`${base(wedding.id)}/${g.id}`).set(h).send({})).status).toBe(400);
    expect((await api().patch(`${base(wedding.id)}/${g.id}`).set(h).send({ rsvpStatus: 'MAYBE' })).status).toBe(400);
    expect((await api().get(`${base(wedding.id)}?rsvpStatus=MAYBE`).set(h)).status).toBe(400);
  });

  it('BR-14: non-member gets 404 on every guest route', async () => {
    const { stranger, wedding } = await setup();
    const g = await createGuest(wedding.id);
    const h = bearer(stranger.id);
    expect((await api().get(base(wedding.id)).set(h)).status).toBe(404);
    expect((await api().post(base(wedding.id)).set(h).send({ name: 'X', email: 'x@test.local' })).status).toBe(404);
    expect((await api().patch(`${base(wedding.id)}/${g.id}`).set(h).send({ name: 'Y' })).status).toBe(404);
    expect((await api().delete(`${base(wedding.id)}/${g.id}`).set(h)).status).toBe(404);
    expect((await api().post(`${base(wedding.id)}/${g.id}/invitation/send`).set(h)).status).toBe(404);
    expect((await api().post(`${base(wedding.id)}/${g.id}/invitation/revoke`).set(h)).status).toBe(404);
    expect(await prisma.guest.count({ where: { weddingId: wedding.id } })).toBe(1);
  });

  it('FR-18: team member can read guests but every write is 403', async () => {
    const { member, wedding } = await setup();
    const g = await createGuest(wedding.id);
    const h = bearer(member.id);
    const read = await api().get(base(wedding.id)).set(h);
    expect(read.status).toBe(200);
    expect(read.body.guests).toHaveLength(1);
    expect((await api().post(base(wedding.id)).set(h).send({ name: 'X', email: 'x@test.local' })).status).toBe(403);
    expect((await api().patch(`${base(wedding.id)}/${g.id}`).set(h).send({ name: 'Y' })).status).toBe(403);
    expect((await api().delete(`${base(wedding.id)}/${g.id}`).set(h)).status).toBe(403);
    expect((await api().post(`${base(wedding.id)}/${g.id}/invitation/send`).set(h)).status).toBe(403);
    expect((await api().post(`${base(wedding.id)}/${g.id}/invitation/revoke`).set(h)).status).toBe(403);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: g.id } })).name).toBe(g.name);
  });

  it('BR-14: a guest id from another wedding → 404 (read, patch, delete, send, revoke)', async () => {
    const { owner, wedding } = await setup();
    const other = await createWedding(owner.id);
    const foreign = await createGuest(other.id);
    const h = bearer(owner.id);
    const url = `${base(wedding.id)}/${foreign.id}`;
    expect((await api().patch(url).set(h).send({ name: 'Hacked' })).status).toBe(404);
    expect((await api().delete(url).set(h)).status).toBe(404);
    expect((await api().post(`${url}/invitation/send`).set(h)).status).toBe(404);
    expect((await api().post(`${url}/invitation/revoke`).set(h)).status).toBe(404);
    expect((await api().patch(`${base(wedding.id)}/not-a-uuid`).set(h).send({ name: 'x' })).status).toBe(404);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe(foreign.name);
  });

  it('BR-13: guest writes on an archived wedding → 409', async () => {
    const { owner, wedding } = await setup();
    const h = bearer(owner.id);
    await api().post(`/api/weddings/${wedding.id}/archive`).set(h);
    const res = await api().post(base(wedding.id)).set(h).send({ name: 'X', email: 'x@test.local' });
    expect(res.status).toBe(409);
    expect((await api().get(base(wedding.id)).set(h)).status).toBe(200);
  });

  it('FR-23: deleting a guest deletes its invitation so the link stops working', async () => {
    const { owner, wedding } = await setup();
    const g = await createGuest(wedding.id);
    await prisma.invitation.create({ data: { guestId: g.id, tokenHash: 'h'.repeat(64) } });
    expect((await api().delete(`${base(wedding.id)}/${g.id}`).set(bearer(owner.id))).status).toBe(204);
    expect(await prisma.invitation.count({ where: { guestId: g.id } })).toBe(0);
  });
});

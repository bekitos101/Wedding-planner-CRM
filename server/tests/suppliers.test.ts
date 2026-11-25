import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { createSupplier } from './helpers/planningFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function setup() {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const { user: stranger } = await createUser();
  const wedding = await createWedding(owner.id);
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  const base = `/api/weddings/${wedding.id}/suppliers`;
  return { owner, member, stranger, wedding, base };
}

const RANDOM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('suppliers', () => {
  it('FR-48: owner creates, edits, lists and deletes a supplier', async () => {
    const { owner, base } = await setup();
    const created = await api().post(base).set(bearer(owner.id)).send({ name: '  Wild Bloom ', category: 'Flowers', contactInfo: '+36 1 555', quotedPrice: 1300.5 });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Wild Bloom',
      category: 'Flowers',
      contactInfo: '+36 1 555',
      quotedPrice: '1300.50',
      notes: null,
      createdAt: expect.any(String),
    });
    const patched = await api().patch(`${base}/${created.body.id}`).set(bearer(owner.id)).send({ notes: 'Roses', quotedPrice: '999.99' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Wild Bloom', notes: 'Roses', quotedPrice: '999.99' });
    expect((await api().get(base).set(bearer(owner.id))).body).toHaveLength(1);
    expect((await api().delete(`${base}/${created.body.id}`).set(bearer(owner.id))).status).toBe(204);
    expect((await api().get(base).set(bearer(owner.id))).body).toHaveLength(0);
  });

  it('FR-49: quotedPrice optional (null allowed, can be cleared)', async () => {
    const { owner, base } = await setup();
    const a = await api().post(base).set(bearer(owner.id)).send({ name: 'Band', category: 'Music' });
    expect(a.status).toBe(201);
    expect(a.body.quotedPrice).toBeNull();
    const b = await api().post(base).set(bearer(owner.id)).send({ name: 'Cake', category: 'Cake', quotedPrice: '480' });
    expect(b.body.quotedPrice).toBe('480.00');
    const cleared = await api().patch(`${base}/${b.body.id}`).set(bearer(owner.id)).send({ quotedPrice: null });
    expect(cleared.body.quotedPrice).toBeNull();
  });

  it('FR-49: validation errors → 400 with fields', async () => {
    const { owner, base } = await setup();
    const res = await api().post(base).set(bearer(owner.id)).send({ name: '', quotedPrice: '-5' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['category', 'name', 'quotedPrice']);
    expect((await api().post(base).set(bearer(owner.id)).send({ name: 'x', category: 'y', quotedPrice: '1.234' })).status).toBe(400);
  });

  it('FR-48: supplier list sorts by category then name; search and category filter are case-insensitive', async () => {
    const { owner, base, wedding } = await setup();
    await createSupplier(wedding.id, { name: 'Zed', category: 'Venue', contactInfo: 'zed@example.com' });
    await createSupplier(wedding.id, { name: 'Alpha', category: 'Venue' });
    await createSupplier(wedding.id, { name: 'Mid', category: 'Catering', contactInfo: 'Call +36 20 123' });
    const all = await api().get(base).set(bearer(owner.id));
    expect(all.body.map((s: { name: string }) => s.name)).toEqual(['Mid', 'Alpha', 'Zed']);
    const byName = await api().get(`${base}?search=ALPH`).set(bearer(owner.id));
    expect(byName.body.map((s: { name: string }) => s.name)).toEqual(['Alpha']);
    const byContact = await api().get(`${base}?search=+36 20`).set(bearer(owner.id));
    expect(byContact.body.map((s: { name: string }) => s.name)).toEqual(['Mid']);
    const byCategorySearch = await api().get(`${base}?search=cater`).set(bearer(owner.id));
    expect(byCategorySearch.body.map((s: { name: string }) => s.name)).toEqual(['Mid']);
    const filtered = await api().get(`${base}?category=venue`).set(bearer(owner.id));
    expect(filtered.body.map((s: { name: string }) => s.name)).toEqual(['Alpha', 'Zed']);
  });

  it('FR-14: member reads suppliers (200) but writes get 403', async () => {
    const { member, owner, base, wedding } = await setup();
    const s = await createSupplier(wedding.id);
    expect((await api().get(base).set(bearer(member.id))).status).toBe(200);
    expect((await api().post(base).set(bearer(member.id)).send({ name: 'x', category: 'y' })).status).toBe(403);
    expect((await api().patch(`${base}/${s.id}`).set(bearer(member.id)).send({ name: 'x' })).status).toBe(403);
    expect((await api().delete(`${base}/${s.id}`).set(bearer(member.id))).status).toBe(403);
    expect((await api().get(base).set(bearer(owner.id))).body[0].name).toBe('Supplier');
  });

  it('BR-14: non-member gets 404 on every supplier route', async () => {
    const { stranger, base, wedding } = await setup();
    const s = await createSupplier(wedding.id);
    expect((await api().get(base).set(bearer(stranger.id))).status).toBe(404);
    expect((await api().post(base).set(bearer(stranger.id)).send({ name: 'x', category: 'y' })).status).toBe(404);
    expect((await api().patch(`${base}/${s.id}`).set(bearer(stranger.id)).send({ name: 'x' })).status).toBe(404);
    expect((await api().delete(`${base}/${s.id}`).set(bearer(stranger.id))).status).toBe(404);
  });

  it('BR-14: a supplier of another wedding (or unknown/malformed id) → 404 and stays untouched', async () => {
    const { owner, base } = await setup();
    const other = await createWedding(owner.id);
    const foreign = await createSupplier(other.id, { name: 'Foreign' });
    expect((await api().patch(`${base}/${foreign.id}`).set(bearer(owner.id)).send({ name: 'Hacked' })).status).toBe(404);
    expect((await api().delete(`${base}/${foreign.id}`).set(bearer(owner.id))).status).toBe(404);
    expect((await api().patch(`${base}/${RANDOM_ID}`).set(bearer(owner.id)).send({ name: 'x' })).status).toBe(404);
    expect((await api().delete(`${base}/not-a-uuid`).set(bearer(owner.id))).status).toBe(404);
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe('Foreign');
  });

  it('BR-13: suppliers of an archived wedding are read-only (409)', async () => {
    const { owner, base, wedding } = await setup();
    await prisma.wedding.update({ where: { id: wedding.id }, data: { status: 'ARCHIVED' } });
    expect((await api().post(base).set(bearer(owner.id)).send({ name: 'x', category: 'y' })).status).toBe(409);
    expect((await api().get(base).set(bearer(owner.id))).status).toBe(200);
  });
});

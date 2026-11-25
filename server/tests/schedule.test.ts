import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { createScheduleItem } from './helpers/planningFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function setup() {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const { user: stranger } = await createUser();
  const wedding = await createWedding(owner.id);
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  const base = `/api/weddings/${wedding.id}/schedule`;
  return { owner, member, stranger, wedding, base };
}

const RANDOM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const at = (hm: string) => `2027-06-19T${hm}:00Z`;
const post = (base: string, userId: string, title: string, s: string, e: string) =>
  api().post(base).set(bearer(userId)).send({ title, startTime: at(s), endTime: at(e) });

describe('schedule', () => {
  it('AC-10: schedule is shown chronologically and an overlap triggers a warning', async () => {
    const { owner, base } = await setup();
    await post(base, owner.id, 'Dinner', '17:00', '19:00');
    const cocktail = await post(base, owner.id, 'Cocktail hour', '15:00', '16:00');
    expect(cocktail.status).toBe(201);
    expect(cocktail.body.warnings).toEqual([]);
    const photos = await post(base, owner.id, 'Photos', '15:30', '16:30');
    expect(photos.status).toBe(201);
    expect(photos.body.warnings).toEqual([
      {
        type: 'OVERLAP',
        itemId: cocktail.body.item.id,
        title: 'Cocktail hour',
        startTime: at('15:00').replace(':00Z', ':00.000Z'),
        endTime: '2027-06-19T16:00:00.000Z',
        message: 'Overlaps with "Cocktail hour".',
      },
    ]);
    expect(photos.body.item.overlapsWith).toEqual([cocktail.body.item.id]);

    const list = await api().get(base).set(bearer(owner.id));
    expect(list.status).toBe(200);
    expect(list.body.map((i: { title: string }) => i.title)).toEqual(['Cocktail hour', 'Photos', 'Dinner']);
    expect(list.body[0].overlapsWith).toEqual([photos.body.item.id]);
    expect(list.body[1].overlapsWith).toEqual([cocktail.body.item.id]);
    expect(list.body[2].overlapsWith).toEqual([]);
  });

  it('BR-12: overlapping items are saved (warning, not an error)', async () => {
    const { owner, base, wedding } = await setup();
    await post(base, owner.id, 'A', '10:00', '12:00');
    const b = await post(base, owner.id, 'B', '11:00', '13:00');
    expect(b.status).toBe(201);
    expect(b.body.warnings).toHaveLength(1);
    expect(await prisma.scheduleItem.count({ where: { weddingId: wedding.id } })).toBe(2);
  });

  it('BR-12: back-to-back items do not overlap', async () => {
    const { owner, base } = await setup();
    await post(base, owner.id, 'A', '10:00', '11:00');
    const b = await post(base, owner.id, 'B', '11:00', '12:00');
    expect(b.body.warnings).toEqual([]);
    expect(b.body.item.overlapsWith).toEqual([]);
  });

  it('BR-12: a contained item overlaps and overlapsWith is symmetric for several items', async () => {
    const { owner, base } = await setup();
    const big = await post(base, owner.id, 'Big', '10:00', '14:00');
    const x = await post(base, owner.id, 'X', '10:30', '11:00');
    const y = await post(base, owner.id, 'Y', '12:00', '13:00');
    expect(y.body.warnings.map((w: { itemId: string }) => w.itemId)).toEqual([big.body.item.id]);
    const list = (await api().get(base).set(bearer(owner.id))).body as { id: string; overlapsWith: string[] }[];
    const byId = Object.fromEntries(list.map((i) => [i.id, i.overlapsWith.sort()]));
    expect(byId[big.body.item.id]).toEqual([x.body.item.id, y.body.item.id].sort());
    expect(byId[x.body.item.id]).toEqual([big.body.item.id]);
    expect(byId[y.body.item.id]).toEqual([big.body.item.id]);
  });

  it('FR-55: PATCH that creates or removes an overlap updates warnings and overlapsWith', async () => {
    const { owner, base } = await setup();
    const a = await post(base, owner.id, 'A', '10:00', '11:00');
    const b = await post(base, owner.id, 'B', '12:00', '13:00');
    const move = await api().patch(`${base}/${b.body.item.id}`).set(bearer(owner.id)).send({ startTime: at('10:30') });
    expect(move.status).toBe(200);
    expect(move.body.item.overlapsWith).toEqual([a.body.item.id]);
    expect(move.body.warnings).toHaveLength(1);
    expect(move.body.warnings[0].message).toBe('Overlaps with "A".');
    const back = await api().patch(`${base}/${b.body.item.id}`).set(bearer(owner.id)).send({ startTime: at('11:00'), title: 'B2' });
    expect(back.body.item.title).toBe('B2');
    expect(back.body.warnings).toEqual([]);
    expect(back.body.item.overlapsWith).toEqual([]);
    const list = (await api().get(base).set(bearer(owner.id))).body;
    expect(list.every((i: { overlapsWith: string[] }) => i.overlapsWith.length === 0)).toBe(true);
  });

  it('UC-11: start == end and start > end → 400 fields.endTime', async () => {
    const { owner, base } = await setup();
    for (const [s, e] of [['10:00', '10:00'], ['11:00', '10:00']] as const) {
      const res = await post(base, owner.id, 'Bad', s, e);
      expect(res.status).toBe(400);
      expect(res.body.error.fields.endTime).toBe('End time must be after start time.');
    }
  });

  it('UC-11: PATCH validates the merged values', async () => {
    const { owner, base } = await setup();
    const a = await post(base, owner.id, 'A', '10:00', '11:00');
    const res = await api().patch(`${base}/${a.body.item.id}`).set(bearer(owner.id)).send({ startTime: at('11:30') });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.endTime).toBe('End time must be after start time.');
    const ok = await api().patch(`${base}/${a.body.item.id}`).set(bearer(owner.id)).send({ startTime: at('11:30'), endTime: at('12:00') });
    expect(ok.status).toBe(200);
  });

  it('NFR-04: offset-less, malformed and out-of-range date-times → 400', async () => {
    const { owner, base } = await setup();
    const send = (startTime: unknown, endTime: unknown) => api().post(base).set(bearer(owner.id)).send({ title: 'T', startTime, endTime });
    const noOffset = await send('2027-06-19T10:00:00', '2027-06-19T11:00:00Z');
    expect(noOffset.status).toBe(400);
    expect(noOffset.body.error.fields.startTime).toBeDefined();
    expect((await send('2027-06-19T10:00:00Z', '2027-06-19')).status).toBe(400);
    expect((await send('2027-02-31T10:00:00Z', '2027-03-01T10:00:00Z')).status).toBe(400);
    expect((await send('1999-06-19T10:00:00Z', '2027-06-19T10:00:00Z')).status).toBe(400);
    expect((await send('2027-06-19T10:00:00Z', '2101-01-01T00:00:00Z')).status).toBe(400);
    expect((await send(12345, null)).status).toBe(400);
    expect((await send('2027-06-19T10:00Z', '2027-06-19T14:00:00+02:00')).status).toBe(201);
  });

  it('FR-53: offsets are normalised to UTC', async () => {
    const { owner, base } = await setup();
    const res = await api()
      .post(base)
      .set(bearer(owner.id))
      .send({ title: 'Ceremony', startTime: '2027-06-19T14:00:00+02:00', endTime: '2027-06-19T14:45:00+02:00', location: ' Garden ' });
    expect(res.status).toBe(201);
    expect(res.body.item).toEqual({
      id: expect.any(String),
      title: 'Ceremony',
      startTime: '2027-06-19T12:00:00.000Z',
      endTime: '2027-06-19T12:45:00.000Z',
      location: 'Garden',
      notes: null,
      overlapsWith: [],
    });
  });

  it('FR-54: equal start times are ordered by endTime then title', async () => {
    const { owner, base } = await setup();
    await post(base, owner.id, 'Zeta', '10:00', '11:00');
    await post(base, owner.id, 'Beta', '10:00', '12:00');
    await post(base, owner.id, 'Alpha', '10:00', '11:00');
    const list = (await api().get(base).set(bearer(owner.id))).body;
    expect(list.map((i: { title: string }) => i.title)).toEqual(['Alpha', 'Zeta', 'Beta']);
  });

  it('FR-52: owner deletes an item and the overlap disappears', async () => {
    const { owner, base } = await setup();
    const a = await post(base, owner.id, 'A', '10:00', '12:00');
    const b = await post(base, owner.id, 'B', '11:00', '12:30');
    expect((await api().delete(`${base}/${a.body.item.id}`).set(bearer(owner.id))).status).toBe(204);
    const list = (await api().get(base).set(bearer(owner.id))).body;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.body.item.id);
    expect(list[0].overlapsWith).toEqual([]);
  });

  it('FR-14: member reads schedule (200) but writes get 403', async () => {
    const { owner, member, base } = await setup();
    const a = await post(base, owner.id, 'A', '10:00', '11:00');
    expect((await api().get(base).set(bearer(member.id))).status).toBe(200);
    expect((await post(base, member.id, 'B', '12:00', '13:00')).status).toBe(403);
    expect((await api().patch(`${base}/${a.body.item.id}`).set(bearer(member.id)).send({ title: 'x' })).status).toBe(403);
    expect((await api().delete(`${base}/${a.body.item.id}`).set(bearer(member.id))).status).toBe(403);
  });

  it('BR-14: non-member gets 404 on every schedule route', async () => {
    const { owner, stranger, base } = await setup();
    const a = await post(base, owner.id, 'A', '10:00', '11:00');
    expect((await api().get(base).set(bearer(stranger.id))).status).toBe(404);
    expect((await post(base, stranger.id, 'B', '12:00', '13:00')).status).toBe(404);
    expect((await api().patch(`${base}/${a.body.item.id}`).set(bearer(stranger.id)).send({ title: 'x' })).status).toBe(404);
    expect((await api().delete(`${base}/${a.body.item.id}`).set(bearer(stranger.id))).status).toBe(404);
  });

  it('BR-14: an item of another wedding (or unknown/malformed id) → 404 and is untouched', async () => {
    const { owner, base } = await setup();
    const other = await createWedding(owner.id);
    const foreign = await createScheduleItem(other.id, 'Foreign', '2027-06-19T10:00:00Z', '2027-06-19T11:00:00Z');
    expect((await api().patch(`${base}/${foreign.id}`).set(bearer(owner.id)).send({ title: 'Hacked' })).status).toBe(404);
    expect((await api().delete(`${base}/${foreign.id}`).set(bearer(owner.id))).status).toBe(404);
    expect((await api().patch(`${base}/${RANDOM_ID}`).set(bearer(owner.id)).send({ title: 'x' })).status).toBe(404);
    expect((await api().delete(`${base}/nope`).set(bearer(owner.id))).status).toBe(404);
    expect((await prisma.scheduleItem.findUniqueOrThrow({ where: { id: foreign.id } })).title).toBe('Foreign');
  });

  it('BR-14: another wedding’s items never appear in overlaps', async () => {
    const { owner, base } = await setup();
    const other = await createWedding(owner.id);
    await createScheduleItem(other.id, 'Other', '2027-06-19T10:00:00Z', '2027-06-19T12:00:00Z');
    const a = await post(base, owner.id, 'A', '10:30', '11:30');
    expect(a.body.warnings).toEqual([]);
  });

  it('BR-13: schedule of an archived wedding is read-only (409)', async () => {
    const { owner, base, wedding } = await setup();
    await prisma.wedding.update({ where: { id: wedding.id }, data: { status: 'ARCHIVED' } });
    expect((await post(base, owner.id, 'A', '10:00', '11:00')).status).toBe(409);
    expect((await api().get(base).set(bearer(owner.id))).status).toBe(200);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createExpense, createGuest, createInvitation, createUser, createWedding } from './helpers/factories.js';
import { createScheduleItem, createSupplier } from './helpers/planningFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
beforeEach(() => setMailTransportForTests({ sendMail: async () => ({ messageId: '<t@local>' }) }));
afterEach(() => setMailTransportForTests(undefined));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ARCHIVED = "This wedding is archived and can't be changed.";

type Res = { status: number; body: any };

/**
 * Deterministic interleaving: an archive transaction has UPDATEd the wedding row but not yet
 * committed. The route middleware (no lock) still reads the committed status ACTIVE, so only the
 * in-transaction check (FOR SHARE) can stop the write. The request must BLOCK on that row lock,
 * and once the archive commits it must answer 409 and write nothing.
 */
async function writeRacingArchive(weddingId: string, issue: () => PromiseLike<Res>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  const archive = prisma.$transaction(
    async (tx) => {
      await tx.wedding.update({ where: { id: weddingId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      started();
      await gate;
    },
    { timeout: 30_000 },
  );
  await ready;
  let settled = false;
  const pending = Promise.resolve(issue()).then((r) => {
    settled = true;
    return r;
  });
  await sleep(600);
  const blockedWhileArchiveOpen = !settled;
  release();
  await archive;
  return { res: await pending, blockedWhileArchiveOpen };
}

async function setup() {
  const { user: owner } = await createUser();
  const wedding = await createWedding(owner.id);
  return { owner, wedding, auth: bearer(owner.id), base: `/api/weddings/${wedding.id}` };
}

function expectArchivedConflict(r: { res: Res; blockedWhileArchiveOpen: boolean }) {
  expect(r.blockedWhileArchiveOpen).toBe(true);
  expect(r.res.status).toBe(409);
  expect(r.res.body.error).toMatchObject({ code: 'CONFLICT', message: ARCHIVED });
}

describe('BR-13: writes cannot land after an archive commits (race with archive)', () => {
  it('BR-13: guest create racing an archive -> waits, then 409, no guest row', async () => {
    const { wedding, auth, base } = await setup();
    const r = await writeRacingArchive(wedding.id, () => api().post(`${base}/guests`).set(auth).send({ name: 'Late Guest', email: 'late@test.local' }));
    expectArchivedConflict(r);
    expect(await prisma.guest.count({ where: { weddingId: wedding.id } })).toBe(0);
    expect((await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } })).status).toBe('ARCHIVED');
  });

  it('BR-13: guest update and delete racing an archive -> 409, guest unchanged', async () => {
    const { wedding, auth, base } = await setup();
    const g = await createGuest(wedding.id, { name: 'Keep Me' });
    expectArchivedConflict(await writeRacingArchive(wedding.id, () => api().patch(`${base}/guests/${g.id}`).set(auth).send({ name: 'Changed' })));
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: g.id } })).name).toBe('Keep Me');

    const s2 = await setup();
    const g2 = await createGuest(s2.wedding.id);
    expectArchivedConflict(await writeRacingArchive(s2.wedding.id, () => api().delete(`${s2.base}/guests/${g2.id}`).set(s2.auth)));
    expect(await prisma.guest.count({ where: { id: g2.id } })).toBe(1);
  });

  it('BR-13: invitation send and revoke racing an archive -> 409, no invitation written', async () => {
    const { wedding, auth, base } = await setup();
    const g = await createGuest(wedding.id);
    expectArchivedConflict(await writeRacingArchive(wedding.id, () => api().post(`${base}/guests/${g.id}/invitation/send`).set(auth)));
    expect(await prisma.invitation.count({ where: { guestId: g.id } })).toBe(0);

    const s2 = await setup();
    const g2 = await createGuest(s2.wedding.id);
    await createInvitation(g2.id);
    expectArchivedConflict(await writeRacingArchive(s2.wedding.id, () => api().post(`${s2.base}/guests/${g2.id}/invitation/revoke`).set(s2.auth)));
    expect((await prisma.invitation.findUniqueOrThrow({ where: { guestId: g2.id } })).revokedAt).toBeNull();
  });

  it('BR-13: expense create / update / delete racing an archive -> 409, nothing changed', async () => {
    const { wedding, auth, base } = await setup();
    const body = { description: 'Cake', category: 'Food', agreedAmount: '100.00', dueDate: '2030-01-01' };
    expectArchivedConflict(await writeRacingArchive(wedding.id, () => api().post(`${base}/expenses`).set(auth).send(body)));
    expect(await prisma.expense.count({ where: { weddingId: wedding.id } })).toBe(0);

    const s2 = await setup();
    const e = await createExpense(s2.wedding.id);
    expectArchivedConflict(await writeRacingArchive(s2.wedding.id, () => api().patch(`${s2.base}/expenses/${e.id}`).set(s2.auth).send({ description: 'Changed' })));
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: e.id } })).description).toBe('Venue');

    const s3 = await setup();
    const e3 = await createExpense(s3.wedding.id);
    expectArchivedConflict(await writeRacingArchive(s3.wedding.id, () => api().delete(`${s3.base}/expenses/${e3.id}`).set(s3.auth)));
    expect(await prisma.expense.count({ where: { id: e3.id } })).toBe(1);
  });

  it('BR-13: payment create / edit / delete racing an archive -> 409, balance unchanged', async () => {
    const { wedding, auth, base } = await setup();
    const e = await createExpense(wedding.id, '1000.00');
    expectArchivedConflict(
      await writeRacingArchive(wedding.id, () =>
        api().post(`${base}/expenses/${e.id}/payments`).set(auth).send({ amount: '100.00', paymentDate: '2026-01-01' }),
      ),
    );
    expect(await prisma.payment.count({ where: { expenseId: e.id } })).toBe(0);

    const s2 = await setup();
    const e2 = await createExpense(s2.wedding.id, '1000.00');
    const p = await prisma.payment.create({ data: { expenseId: e2.id, amount: '50.00', paymentDate: new Date('2026-01-01T00:00:00Z') } });
    expectArchivedConflict(
      await writeRacingArchive(s2.wedding.id, () => api().patch(`${s2.base}/expenses/${e2.id}/payments/${p.id}`).set(s2.auth).send({ amount: '60.00' })),
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).amount.toFixed(2)).toBe('50.00');

    const s3 = await setup();
    const e3 = await createExpense(s3.wedding.id, '1000.00');
    const p3 = await prisma.payment.create({ data: { expenseId: e3.id, amount: '50.00', paymentDate: new Date('2026-01-01T00:00:00Z') } });
    expectArchivedConflict(await writeRacingArchive(s3.wedding.id, () => api().delete(`${s3.base}/expenses/${e3.id}/payments/${p3.id}`).set(s3.auth)));
    expect(await prisma.payment.count({ where: { id: p3.id } })).toBe(1);
  });

  it('BR-13: supplier create / update / delete racing an archive -> 409, nothing changed', async () => {
    const { wedding, auth, base } = await setup();
    expectArchivedConflict(await writeRacingArchive(wedding.id, () => api().post(`${base}/suppliers`).set(auth).send({ name: 'Late', category: 'Music' })));
    expect(await prisma.supplier.count({ where: { weddingId: wedding.id } })).toBe(0);

    const s2 = await setup();
    const s = await createSupplier(s2.wedding.id, { name: 'Original' });
    expectArchivedConflict(await writeRacingArchive(s2.wedding.id, () => api().patch(`${s2.base}/suppliers/${s.id}`).set(s2.auth).send({ name: 'Changed' })));
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).name).toBe('Original');

    const s3 = await setup();
    const sup3 = await createSupplier(s3.wedding.id);
    expectArchivedConflict(await writeRacingArchive(s3.wedding.id, () => api().delete(`${s3.base}/suppliers/${sup3.id}`).set(s3.auth)));
    expect(await prisma.supplier.count({ where: { id: sup3.id } })).toBe(1);
  });

  it('BR-13: schedule create / update / delete racing an archive -> 409, nothing changed', async () => {
    const { wedding, auth, base } = await setup();
    const item = { title: 'Late', startTime: '2030-06-01T10:00:00.000Z', endTime: '2030-06-01T11:00:00.000Z' };
    expectArchivedConflict(await writeRacingArchive(wedding.id, () => api().post(`${base}/schedule`).set(auth).send(item)));
    expect(await prisma.scheduleItem.count({ where: { weddingId: wedding.id } })).toBe(0);

    const s2 = await setup();
    const i2 = await createScheduleItem(s2.wedding.id, 'Original', '2030-06-01T10:00:00.000Z', '2030-06-01T11:00:00.000Z');
    expectArchivedConflict(await writeRacingArchive(s2.wedding.id, () => api().patch(`${s2.base}/schedule/${i2.id}`).set(s2.auth).send({ title: 'Changed' })));
    expect((await prisma.scheduleItem.findUniqueOrThrow({ where: { id: i2.id } })).title).toBe('Original');

    const s3 = await setup();
    const i3 = await createScheduleItem(s3.wedding.id, 'Keep', '2030-06-01T10:00:00.000Z', '2030-06-01T11:00:00.000Z');
    expectArchivedConflict(await writeRacingArchive(s3.wedding.id, () => api().delete(`${s3.base}/schedule/${i3.id}`).set(s3.auth)));
    expect(await prisma.scheduleItem.count({ where: { id: i3.id } })).toBe(1);
  });

  it('BR-13: a write that holds the wedding lock first lands, and the archive then follows it', async () => {
    const { wedding, auth, base } = await setup();
    // A write transaction holds the wedding row lock (FOR SHARE) while the archive request is issued.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const ready = new Promise<void>((r) => (held = r));
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "status" FROM "Wedding" WHERE "id" = ${wedding.id} FOR SHARE`;
        await tx.supplier.create({ data: { weddingId: wedding.id, name: 'First', category: 'Music' } });
        held();
        await gate;
      },
      { timeout: 30_000 },
    );
    await ready;
    let archived = false;
    const archive = Promise.resolve(api().post(`${base}/archive`).set(auth)).then((r) => {
      archived = true;
      return r;
    });
    await sleep(600);
    expect(archived).toBe(false); // the archive waits for the in-flight write
    release();
    await writer;
    expect((await archive).status).toBe(200);
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { weddingId: wedding.id } });
    const w = await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } });
    expect(w.status).toBe('ARCHIVED');
    expect(w.archivedAt!.getTime()).toBeGreaterThanOrEqual(supplier.createdAt.getTime());
  });
});

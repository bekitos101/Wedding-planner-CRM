import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import {
  createExpense,
  createGuest,
  createInvitation,
  createTask,
  createUser,
  createWedding,
} from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((e as Prisma.PrismaClientKnownRequestError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Prisma error ${code} but the call succeeded`);
}

describe('schema constraints', () => {
  it('BR-02: duplicate WeddingMember for same wedding+user is rejected', async () => {
    const { user: owner } = await createUser();
    const { user: member } = await createUser();
    const wedding = await createWedding(owner.id);
    await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
    await expectCode(
      prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } }),
      'P2002',
    );
    expect(await prisma.weddingMember.count({ where: { weddingId: wedding.id, userId: member.id } })).toBe(1);
  });

  it('BR-05: a guest can have at most one Invitation', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const guest = await createGuest(wedding.id);
    await createInvitation(guest.id);
    await expectCode(createInvitation(guest.id), 'P2002');
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('NFR-03: invitation tokenHash is unique', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const g1 = await createGuest(wedding.id);
    const g2 = await createGuest(wedding.id);
    await createInvitation(g1.id, 'same-hash');
    await expectCode(createInvitation(g2.id, 'same-hash'), 'P2002');
  });

  it('NFR-16: duplicate Notification (taskId,userId,type,channel,scheduledAt) is rejected', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const task = await createTask(wedding.id, { assigneeId: user.id });
    const scheduledAt = new Date('2030-01-01T10:00:00Z');
    const data = {
      taskId: task.id,
      userId: user.id,
      type: 'TASK_DEADLINE_REMINDER' as const,
      channel: 'EMAIL' as const,
      scheduledAt,
    };
    await prisma.notification.create({ data });
    await expectCode(prisma.notification.create({ data }), 'P2002');
  });

  it('NFR-16: upsert on the notification compound key run twice leaves exactly one row', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const task = await createTask(wedding.id, { assigneeId: user.id });
    const scheduledAt = new Date('2030-02-02T10:00:00Z');
    const key = {
      taskId: task.id,
      userId: user.id,
      type: 'TASK_DEADLINE_REMINDER' as const,
      channel: 'IN_APP' as const,
      scheduledAt,
    };
    const run = () =>
      prisma.notification.upsert({
        where: { taskId_userId_type_channel_scheduledAt: key },
        create: key,
        update: {},
      });
    await run();
    await run();
    expect(await prisma.notification.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('BR-01: wedding has exactly one owner (ownerId is required and must reference a user)', async () => {
    const { user } = await createUser();
    const base = {
      coupleNames: 'X & Y',
      weddingDate: new Date(),
      location: 'Somewhere',
      totalBudget: '1.00',
      rsvpDeadline: new Date(),
    };
    // Missing owner is rejected (validation error from Prisma client).
    await expect(prisma.wedding.create({ data: base as never })).rejects.toThrow();
    // Non-existent owner is rejected by the FK.
    await expectCode(prisma.wedding.create({ data: { ...base, ownerId: 'no-such-user' } }), 'P2003');
    // Owner cannot be deleted while owning a wedding (no cascade on owner relation).
    const wedding = await createWedding(user.id);
    await expectCode(prisma.user.delete({ where: { id: user.id } }), 'P2003');
    expect((await prisma.wedding.findUnique({ where: { id: wedding.id } }))?.ownerId).toBe(user.id);
  });

  it('money: Expense.agreedAmount round-trips 1250.10 exactly as Decimal', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const expense = await createExpense(wedding.id, '1250.10');
    const found = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(found.agreedAmount).toBeInstanceOf(Prisma.Decimal);
    expect(found.agreedAmount.toFixed(2)).toBe('1250.10');
    expect(found.agreedAmount.equals(new Prisma.Decimal('1250.10'))).toBe(true);
  });

  it('money: Decimal sum of payments 0.10 + 0.20 equals 0.30 (no float drift)', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const expense = await createExpense(wedding.id, '5.00');
    for (const amount of ['0.10', '0.20']) {
      await prisma.payment.create({ data: { expenseId: expense.id, amount, paymentDate: new Date() } });
    }
    const payments = await prisma.payment.findMany({ where: { expenseId: expense.id } });
    const sum = payments.reduce((acc, p) => acc.plus(p.amount), new Prisma.Decimal(0));
    expect(sum.toFixed(2)).toBe('0.30');
    const agg = await prisma.payment.aggregate({ where: { expenseId: expense.id }, _sum: { amount: true } });
    expect(agg._sum.amount?.toFixed(2)).toBe('0.30');
  });

  it('cascade: deleting a guest deletes its invitation', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const guest = await createGuest(wedding.id);
    const inv = await createInvitation(guest.id);
    await prisma.guest.delete({ where: { id: guest.id } });
    expect(await prisma.invitation.findUnique({ where: { id: inv.id } })).toBeNull();
  });

  it('cascade: deleting an expense deletes its payments', async () => {
    const { user } = await createUser();
    const wedding = await createWedding(user.id);
    const expense = await createExpense(wedding.id);
    await prisma.payment.create({ data: { expenseId: expense.id, amount: '10.00', paymentDate: new Date() } });
    await prisma.expense.delete({ where: { id: expense.id } });
    expect(await prisma.payment.count({ where: { expenseId: expense.id } })).toBe(0);
  });

  it('set null: deleting the assignee user sets Task.assigneeId to null', async () => {
    const { user: owner } = await createUser();
    const { user: assignee } = await createUser();
    const wedding = await createWedding(owner.id);
    const task = await createTask(wedding.id, { assigneeId: assignee.id });
    await prisma.user.delete({ where: { id: assignee.id } });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.assigneeId).toBeNull();
  });
});

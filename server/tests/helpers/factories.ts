import bcrypt from 'bcryptjs';
import { prisma } from '../../src/lib/prisma.js';

let counter = 0;

/** Test-only factory (bcrypt cost 4 for speed). */
export async function createUser(overrides: { name?: string; email?: string; password?: string } = {}) {
  counter += 1;
  const password = overrides.password ?? 'Password123!';
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? `User ${counter}`,
      email: (overrides.email ?? `user${counter}@test.local`).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  return { user, password };
}

export async function createGuest(weddingId: string, overrides: { name?: string; email?: string } = {}) {
  counter += 1;
  return prisma.guest.create({
    data: {
      weddingId,
      name: overrides.name ?? `Guest ${counter}`,
      email: overrides.email ?? `guest${counter}@test.local`,
    },
  });
}

export async function createInvitation(guestId: string, tokenHash?: string) {
  counter += 1;
  return prisma.invitation.create({
    data: { guestId, tokenHash: tokenHash ?? `hash-${counter}-${Math.random().toString(36).slice(2)}` },
  });
}

export async function createTask(
  weddingId: string,
  overrides: { assigneeId?: string | null; title?: string; dueDate?: Date } = {},
) {
  return prisma.task.create({
    data: {
      weddingId,
      assigneeId: overrides.assigneeId ?? null,
      title: overrides.title ?? 'Task',
      dueDate: overrides.dueDate ?? new Date(Date.now() + 7 * 86400000),
    },
  });
}

export async function createExpense(weddingId: string, agreedAmount = '1000.00') {
  return prisma.expense.create({
    data: { weddingId, description: 'Venue', category: 'Venue', agreedAmount, dueDate: new Date(Date.now() + 86400000) },
  });
}

export async function createWedding(
  ownerId: string,
  overrides: Partial<{ coupleNames: string; totalBudget: string }> = {},
) {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  const deadline = new Date(date);
  deadline.setMonth(deadline.getMonth() - 1);
  return prisma.wedding.create({
    data: {
      ownerId,
      coupleNames: overrides.coupleNames ?? 'Anna & Ben',
      weddingDate: date,
      location: 'Budapest',
      totalBudget: overrides.totalBudget ?? '10000.00',
      rsvpDeadline: deadline,
    },
  });
}

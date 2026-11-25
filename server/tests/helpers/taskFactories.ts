import type { TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createUser, createWedding } from './factories.js';

export const day = (offsetDays: number): Date => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offsetDays));
};
export const dateStr = (offsetDays: number): string => day(offsetDays).toISOString().slice(0, 10);

/** Owner + active team member + a wedding with that member. */
export async function setupTaskWedding() {
  const { user: owner } = await createUser();
  const { user: member } = await createUser();
  const { user: other } = await createUser(); // active member too: for "another member's task"
  const wedding = await createWedding(owner.id);
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: member.id } });
  await prisma.weddingMember.create({ data: { weddingId: wedding.id, userId: other.id } });
  return { owner, member, other, wedding };
}

export function makeTask(
  weddingId: string,
  o: Partial<{
    title: string;
    assigneeId: string | null;
    dueDate: Date;
    status: TaskStatus;
    priority: TaskPriority;
    progressNotes: string | null;
  }> = {},
) {
  return prisma.task.create({
    data: {
      weddingId,
      title: o.title ?? 'Task',
      assigneeId: o.assigneeId ?? null,
      dueDate: o.dueDate ?? day(10),
      status: o.status ?? 'TODO',
      priority: o.priority ?? 'MEDIUM',
      progressNotes: o.progressNotes ?? null,
      completedAt: o.status === 'COMPLETED' ? new Date() : null,
    },
  });
}

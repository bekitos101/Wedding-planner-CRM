import type { Prisma, WeddingMember } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { reminderTx, type ReminderTx } from './notificationRepository.js';

const withUser = { user: { select: { id: true, name: true, email: true } } } satisfies Prisma.WeddingMemberInclude;

export type MemberWithUser = Prisma.WeddingMemberGetPayload<{ include: typeof withUser }>;

export const memberRepository = {
  find(weddingId: string, userId: string): Promise<WeddingMember | null> {
    return prisma.weddingMember.findUnique({ where: { weddingId_userId: { weddingId, userId } } });
  },

  listByWedding(weddingId: string): Promise<MemberWithUser[]> {
    return prisma.weddingMember.findMany({ where: { weddingId }, include: withUser });
  },

  create(weddingId: string, userId: string): Promise<MemberWithUser> {
    return prisma.weddingMember.create({ data: { weddingId, userId }, include: withUser });
  },

  reactivate(weddingId: string, userId: string): Promise<MemberWithUser> {
    return prisma.weddingMember.update({
      where: { weddingId_userId: { weddingId, userId } },
      data: { status: 'ACTIVE', revokedAt: null },
      include: withUser,
    });
  },

  /**
   * One transaction: revoke the ACTIVE membership, cancel the user's PENDING notifications for
   * tasks of this wedding, and unassign their tasks in this wedding. Nothing is deleted.
   * Returns false when there was no active membership (nothing changed).
   */
  revokeAndCleanUp(
    weddingId: string,
    userId: string,
    now: Date,
    /** Runs in the same transaction with the ids of the tasks that were just unassigned (reminders move to the owner). */
    afterUnassign?: (reminders: ReminderTx, unassignedTaskIds: string[]) => Promise<void>,
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.weddingMember.updateMany({
        where: { weddingId, userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now },
      });
      if (revoked.count === 0) return false;
      // LOCK ORDER (everywhere): Wedding / WeddingMember -> Task -> Notification. Task writes and
      // syncTask lock the Task row before touching its notifications, so this transaction does the
      // same: unassign the tasks FIRST (one atomic UPDATE ... RETURNING, no read-then-write gap).
      const tasks = await tx.task.updateManyAndReturn({ where: { weddingId, assigneeId: userId }, data: { assigneeId: null }, select: { id: true } });
      await tx.notification.updateMany({
        where: { userId, status: 'PENDING', task: { weddingId } },
        data: { status: 'CANCELLED' },
      });
      if (afterUnassign) {
        await afterUnassign(reminderTx(tx), tasks.map((t) => t.id));
      }
      return true;
    });
  },
};

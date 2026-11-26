import { Prisma, type WeddingStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { reminderTx, type ReminderTx } from './notificationRepository.js';

const withOwner = { owner: { select: { id: true, name: true } } } satisfies Prisma.WeddingInclude;

export type WeddingWithOwner = Prisma.WeddingGetPayload<{ include: typeof withOwner }>;

export interface WeddingFields {
  coupleNames: string;
  weddingDate: Date;
  location: string;
  totalBudget: Prisma.Decimal | string;
  rsvpDeadline: Date;
}

export interface WeddingAccessRow {
  id: string;
  ownerId: string;
  status: WeddingStatus;
  hasActiveMembership: boolean;
}

export const weddingRepository = {
  create(ownerId: string, data: WeddingFields): Promise<WeddingWithOwner> {
    return prisma.wedding.create({ data: { ownerId, ...data }, include: withOwner });
  },

  findById(id: string): Promise<WeddingWithOwner | null> {
    return prisma.wedding.findUnique({ where: { id }, include: withOwner });
  },

  /** Minimal row for the authorization middleware: wedding + whether `userId` is an ACTIVE member. */
  async findAccess(id: string, userId: string): Promise<WeddingAccessRow | null> {
    const w = await prisma.wedding.findUnique({
      where: { id },
      select: { id: true, ownerId: true, status: true, members: { where: { userId, status: 'ACTIVE' }, select: { id: true } } },
    });
    return w ? { id: w.id, ownerId: w.ownerId, status: w.status, hasActiveMembership: w.members.length > 0 } : null;
  },

  /** Writes only while the wedding is ACTIVE (guards the race with archive). False = nothing written. */
  async updateIfActive(id: string, data: Partial<WeddingFields>): Promise<boolean> {
    const r = await prisma.wedding.updateMany({ where: { id, status: 'ACTIVE' }, data });
    return r.count > 0;
  },

  /**
   * Archives only an ACTIVE wedding. False = it was already archived (or gone). `inSameTx` runs in
   * the archive's own transaction after the write (phase 5: cancel the wedding's PENDING reminders).
   */
  archiveIfActive(id: string, archivedAt: Date, inSameTx?: (reminders: ReminderTx) => Promise<void>): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const r = await tx.wedding.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'ARCHIVED', archivedAt } });
      if (r.count === 0) return false;
      if (inSameTx) await inSameTx(reminderTx(tx));
      return true;
    });
  },

  /** Weddings owned by the user or where the user is an ACTIVE member, sorted by wedding date. */
  listForUser(userId: string, status: WeddingStatus): Promise<WeddingWithOwner[]> {
    return prisma.wedding.findMany({
      where: { status, OR: [{ ownerId: userId }, { members: { some: { userId, status: 'ACTIVE' } } }] },
      include: withOwner,
      orderBy: [{ weddingDate: 'asc' }, { createdAt: 'asc' }],
    });
  },

  /** Task counts per wedding in one query (no N+1). */
  async taskCounts(weddingIds: string[]): Promise<Map<string, { total: number; completed: number }>> {
    const result = new Map<string, { total: number; completed: number }>();
    if (weddingIds.length === 0) return result;
    const rows = await prisma.task.groupBy({
      by: ['weddingId', 'status'],
      where: { weddingId: { in: weddingIds } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const entry = result.get(r.weddingId) ?? { total: 0, completed: 0 };
      entry.total += r._count._all;
      if (r.status === 'COMPLETED') entry.completed += r._count._all;
      result.set(r.weddingId, entry);
    }
    return result;
  },
};

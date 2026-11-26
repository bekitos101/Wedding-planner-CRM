import { Prisma, type NotificationChannel, type NotificationStatus, type TaskStatus, type WeddingStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

// Data access for reminders and in-app notifications (phase 5). Prisma only, no business rules:
// reminderService / notificationService decide what to write.

/** What the reminder rules need to know about a task. */
export interface ReminderTask {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: Date;
  assigneeId: string | null;
  weddingId: string;
  wedding: { ownerId: string; status: WeddingStatus };
}

export interface ReminderRow {
  id: string;
  userId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  scheduledAt: Date;
}

export interface NewReminder {
  taskId: string;
  userId: string;
  channel: NotificationChannel;
  scheduledAt: Date;
}

/** Reminder writes inside ONE database transaction (the task's write transaction, a revoke, an archive). */
export interface ReminderTx {
  findTask(taskId: string): Promise<ReminderTask | null>;
  listForTask(taskId: string): Promise<ReminderRow[]>;
  /** PENDING or FAILED -> CANCELLED for these ids (delivered rows are never touched). */
  cancel(ids: string[]): Promise<void>;
  /** INSERT ... ON CONFLICT DO NOTHING on the unique key (NFR-16). */
  insertMissing(rows: NewReminder[]): Promise<void>;
  /** CANCELLED -> PENDING with attemptCount 0 and sentAt/lastError cleared. */
  revive(ids: string[]): Promise<void>;
  cancelPendingForWedding(weddingId: string): Promise<number>;
}

const deliveryInclude = {
  user: { select: { id: true, name: true, email: true } },
  task: {
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      assigneeId: true,
      wedding: { select: { id: true, coupleNames: true, ownerId: true, status: true } },
    },
  },
} satisfies Prisma.NotificationInclude;

export type DeliveryRow = Prisma.NotificationGetPayload<{ include: typeof deliveryInclude }>;

export interface DeliveryResult {
  status: 'SENT' | 'FAILED' | 'CANCELLED';
  sentAt?: Date | null;
  attemptCount?: number;
  lastError?: string | null;
}

/** A claim older than this is considered abandoned (crash, hung SMTP) and may be claimed again. */
export const LEASE_MS = 10 * 60_000;

async function loadDelivery(ids: string[]): Promise<DeliveryRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.notification.findMany({ where: { id: { in: ids } }, include: deliveryInclude });
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export function reminderTx(tx: Prisma.TransactionClient): ReminderTx {
  return {
    async findTask(taskId) {
      // Serialises concurrent syncs of the same task (startup backfill vs. a task write, two server
      // processes): the second waits, then sees the first one's rows. Without this, two late reminders
      // computed a few milliseconds apart would get different scheduledAt keys and both be inserted.
      // NO KEY UPDATE does not block inserts of Notification rows (they only need FOR KEY SHARE).
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`;
      if (locked.length === 0) return null;
      return tx.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          assigneeId: true,
          weddingId: true,
          wedding: { select: { ownerId: true, status: true } },
        },
      });
    },

    listForTask: (taskId) =>
      tx.notification.findMany({
        where: { taskId, type: 'TASK_DEADLINE_REMINDER' },
        select: { id: true, userId: true, channel: true, status: true, scheduledAt: true },
      }),

    async cancel(ids) {
      if (ids.length === 0) return;
      await tx.notification.updateMany({ where: { id: { in: ids }, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED' } });
    },

    async insertMissing(rows) {
      if (rows.length === 0) return;
      await tx.notification.createMany({
        data: rows.map((r) => ({ ...r, type: 'TASK_DEADLINE_REMINDER' as const })),
        skipDuplicates: true,
      });
    },

    async revive(ids) {
      if (ids.length === 0) return;
      await tx.notification.updateMany({
        where: { id: { in: ids }, status: 'CANCELLED' },
        data: { status: 'PENDING', attemptCount: 0, sentAt: null, lastError: null, claimedAt: null },
      });
    },

    async cancelPendingForWedding(weddingId) {
      const r = await tx.notification.updateMany({
        where: { status: 'PENDING', task: { weddingId } },
        data: { status: 'CANCELLED' },
      });
      return r.count;
    },
  };
}

// ---- notifications API (read side) ----

const apiInclude = {
  task: {
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
      wedding: { select: { id: true, coupleNames: true } },
    },
  },
} satisfies Prisma.NotificationInclude;

export type NotificationApiRow = Prisma.NotificationGetPayload<{ include: typeof apiInclude }>;

/** Delivered IN_APP notifications of this user, for weddings they can still access (owner or ACTIVE member). */
function visibleWhere(userId: string, unreadOnly: boolean): Prisma.NotificationWhereInput {
  return {
    userId,
    channel: 'IN_APP',
    status: 'SENT',
    ...(unreadOnly ? { readAt: null } : {}),
    task: { wedding: { OR: [{ ownerId: userId }, { members: { some: { userId, status: 'ACTIVE' } } }] } },
  };
}

export const notificationRepository = {
  forTx: reminderTx,

  /** Runs `fn` in one transaction with a tx-bound reminder writer. */
  reminderTransaction<T>(fn: (tx: ReminderTx) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => fn(reminderTx(tx)));
  },

  /**
   * LEASE claim (no long transaction): one short UPDATE ... RETURNING marks up to `limit` due PENDING
   * rows as claimed (claimedAt = a fresh timestamp shared by the batch). `FOR UPDATE SKIP LOCKED`
   * keeps concurrent claimers off each other's rows; rows whose lease is older than LEASE_MS are
   * claimable again. The caller then sends OUTSIDE any transaction and records each result with
   * `recordClaimed` (compare-and-set on status, claimedAt and attemptCount).
   */
  async claimDue(now: Date, limit: number): Promise<DeliveryRow[]> {
    const claimedAt = new Date();
    const cutoff = new Date(claimedAt.getTime() - LEASE_MS);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification" SET "claimedAt" = ${claimedAt}
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "status" = 'PENDING'::"NotificationStatus" AND "scheduledAt" <= ${now}
          AND ("claimedAt" IS NULL OR "claimedAt" < ${cutoff})
        ORDER BY "scheduledAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;
    return loadDelivery(rows.map((r) => r.id));
  },

  /** Same lease claim for FAILED EMAIL rows below the attempt limit (retry job). */
  async claimFailedEmails(maxAttempts: number, excludeIds: string[], limit: number): Promise<DeliveryRow[]> {
    const claimedAt = new Date();
    const cutoff = new Date(claimedAt.getTime() - LEASE_MS);
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Notification" SET "claimedAt" = ${claimedAt}
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "status" = 'FAILED'::"NotificationStatus" AND "channel" = 'EMAIL'::"NotificationChannel"
          AND "attemptCount" < ${maxAttempts}
          AND NOT ("id" = ANY(${excludeIds}::text[]))
          AND ("claimedAt" IS NULL OR "claimedAt" < ${cutoff})
        ORDER BY "updatedAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;
    return loadDelivery(rows.map((r) => r.id));
  },

  /**
   * Records the outcome of a claimed row ONLY if it is still the same claim: status unchanged
   * (not cancelled / delivered meanwhile), same claimedAt (not re-claimed after a lease expiry) and
   * same attemptCount. Clears the lease. False = nothing written (cancelled or re-claimed).
   */
  async recordClaimed(row: DeliveryRow, result: DeliveryResult): Promise<boolean> {
    const r = await prisma.notification.updateMany({
      where: { id: row.id, status: row.status, claimedAt: row.claimedAt, attemptCount: row.attemptCount },
      data: {
        status: result.status,
        claimedAt: null,
        ...(result.sentAt !== undefined ? { sentAt: result.sentAt } : {}),
        ...(result.attemptCount !== undefined ? { attemptCount: result.attemptCount } : {}),
        ...(result.lastError !== undefined ? { lastError: result.lastError } : {}),
      },
    });
    return r.count > 0;
  },

  /** Tasks the backfill must look at: still eligible-looking tasks, plus any task holding PENDING reminders. */
  async backfillTaskIds(today: Date): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: {
        OR: [
          { status: { not: 'COMPLETED' }, dueDate: { gte: today }, wedding: { status: 'ACTIVE' } },
          { notifications: { some: { status: 'PENDING' } } },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  },

  listVisible(userId: string, unreadOnly: boolean, limit: number): Promise<NotificationApiRow[]> {
    return prisma.notification.findMany({
      where: visibleWhere(userId, unreadOnly),
      include: apiInclude,
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  },

  countUnread(userId: string): Promise<number> {
    return prisma.notification.count({ where: visibleWhere(userId, true) });
  },

  findVisible(userId: string, id: string): Promise<NotificationApiRow | null> {
    return prisma.notification.findFirst({ where: { id, ...visibleWhere(userId, false) }, include: apiInclude });
  },

  /** Sets readAt only when it is still empty (idempotent: keeps the first read time). */
  async markRead(userId: string, id: string, now: Date): Promise<void> {
    await prisma.notification.updateMany({ where: { id, ...visibleWhere(userId, true) }, data: { readAt: now } });
  },

  async markAllRead(userId: string, now: Date): Promise<void> {
    await prisma.notification.updateMany({ where: visibleWhere(userId, true), data: { readAt: now } });
  },
};

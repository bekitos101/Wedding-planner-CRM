import { Prisma, type DeliveryStatus, type RsvpStatus, type WeddingStatus } from '@prisma/client';
import { toDateOnly } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { budgetFiguresIn, type BudgetFigures } from './expenseRepository.js';
import { withAssignee, type TaskRow } from './taskRepository.js';

export interface WeddingFacts {
  id: string;
  coupleNames: string;
  weddingDate: Date;
  location: string;
  status: WeddingStatus;
}

export interface GuestCounts {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
  notSent: number;
  sent: number;
  failed: number;
  revoked: number;
}

export interface TaskCounts {
  total: number;
  todo: number;
  inProgress: number;
  completed: number;
  overdue: number;
  dueNext7Days: number;
  myOpenTasks: number;
}

export interface ReportGuestRow {
  name: string;
  email: string;
  rsvpStatus: RsvpStatus;
  respondedAt: Date | null;
  dietaryRequirements: string | null;
  invitation: { revokedAt: Date | null; deliveryStatus: DeliveryStatus } | null;
}

export interface CategoryRow {
  category: string;
  expenseCount: number;
  committed: Prisma.Decimal;
  paid: Prisma.Decimal;
}

/** Read-only queries bound to ONE REPEATABLE READ transaction: everything read through it is one snapshot. */
export interface SnapshotReader {
  wedding(weddingId: string): Promise<WeddingFacts | null>;
  guestCounts(weddingId: string): Promise<GuestCounts>;
  /** `today` and `weekEnd` (today + 7) are UTC dates. */
  taskCounts(weddingId: string, userId: string, today: Date, weekEnd: Date): Promise<TaskCounts>;
  /** Unfinished tasks, soonest due first (same order as the task list). */
  upcomingTasks(weddingId: string, limit: number): Promise<TaskRow[]>;
  budgetFigures(weddingId: string, today: Date): Promise<BudgetFigures>;
  supplierCount(weddingId: string): Promise<number>;
  /** Items in display order (start, end, title, id): what the overlap computation needs. */
  scheduleTimes(weddingId: string): Promise<{ id: string; startTime: Date; endTime: Date }[]>;
  guestsForReport(weddingId: string): Promise<ReportGuestRow[]>;
  /** One row per exact (trimmed) category spelling; the service merges spellings. */
  categoryTotals(weddingId: string): Promise<CategoryRow[]>;
}

type RawCounts = Record<string, bigint | number | null>;
const n = (v: bigint | number | null | undefined): number => Number(v ?? 0);

function makeReader(tx: Prisma.TransactionClient): SnapshotReader {
  return {
    wedding: (weddingId) =>
      tx.wedding.findUnique({
        where: { id: weddingId },
        select: { id: true, coupleNames: true, weddingDate: true, location: true, status: true },
      }),

    // One pass over the wedding's guests (+ their invitation): RSVP counts and invitation counts.
    // notSent = no invitation row OR delivery PENDING (and not revoked).
    async guestCounts(weddingId) {
      const rows = await tx.$queryRaw<RawCounts[]>`
        SELECT COUNT(*) AS "total",
          COUNT(*) FILTER (WHERE g."rsvpStatus" = 'PENDING') AS "pending",
          COUNT(*) FILTER (WHERE g."rsvpStatus" = 'ACCEPTED') AS "accepted",
          COUNT(*) FILTER (WHERE g."rsvpStatus" = 'DECLINED') AS "declined",
          COUNT(*) FILTER (WHERE i."revokedAt" IS NULL AND (i."id" IS NULL OR i."deliveryStatus" = 'PENDING')) AS "notSent",
          COUNT(*) FILTER (WHERE i."revokedAt" IS NULL AND i."deliveryStatus" = 'SENT') AS "sent",
          COUNT(*) FILTER (WHERE i."revokedAt" IS NULL AND i."deliveryStatus" = 'FAILED') AS "failed",
          COUNT(*) FILTER (WHERE i."revokedAt" IS NOT NULL) AS "revoked"
        FROM "Guest" g LEFT JOIN "Invitation" i ON i."guestId" = g."id"
        WHERE g."weddingId" = ${weddingId}`;
      const r = rows[0] ?? {};
      return {
        total: n(r.total),
        pending: n(r.pending),
        accepted: n(r.accepted),
        declined: n(r.declined),
        notSent: n(r.notSent),
        sent: n(r.sent),
        failed: n(r.failed),
        revoked: n(r.revoked),
      };
    },

    async taskCounts(weddingId, userId, today, weekEnd) {
      // Bind plain 'YYYY-MM-DD' strings so the cast never depends on the session TimeZone.
      const todayStr = toDateOnly(today);
      const weekEndStr = toDateOnly(weekEnd);
      const rows = await tx.$queryRaw<RawCounts[]>`
        SELECT COUNT(*) AS "total",
          COUNT(*) FILTER (WHERE "status" = 'TODO') AS "todo",
          COUNT(*) FILTER (WHERE "status" = 'IN_PROGRESS') AS "inProgress",
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED') AS "completed",
          COUNT(*) FILTER (WHERE "status" <> 'COMPLETED' AND "dueDate" < ${todayStr}::date) AS "overdue",
          COUNT(*) FILTER (WHERE "status" <> 'COMPLETED' AND "dueDate" >= ${todayStr}::date AND "dueDate" <= ${weekEndStr}::date) AS "dueNext7Days",
          COUNT(*) FILTER (WHERE "status" <> 'COMPLETED' AND "assigneeId" = ${userId}) AS "myOpenTasks"
        FROM "Task" WHERE "weddingId" = ${weddingId}`;
      const r = rows[0] ?? {};
      return {
        total: n(r.total),
        todo: n(r.todo),
        inProgress: n(r.inProgress),
        completed: n(r.completed),
        overdue: n(r.overdue),
        dueNext7Days: n(r.dueNext7Days),
        myOpenTasks: n(r.myOpenTasks),
      };
    },

    upcomingTasks: (weddingId, limit) =>
      tx.task.findMany({
        where: { weddingId, status: { not: 'COMPLETED' } },
        include: withAssignee,
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { title: 'asc' }, { id: 'asc' }],
        take: limit,
      }),

    budgetFigures: (weddingId, today) => budgetFiguresIn(tx, weddingId, today),

    supplierCount: (weddingId) => tx.supplier.count({ where: { weddingId } }),

    scheduleTimes: (weddingId) =>
      tx.scheduleItem.findMany({
        where: { weddingId },
        select: { id: true, startTime: true, endTime: true },
        orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { title: 'asc' }, { id: 'asc' }],
      }),

    guestsForReport: (weddingId) =>
      tx.guest.findMany({
        where: { weddingId },
        select: {
          name: true,
          email: true,
          rsvpStatus: true,
          respondedAt: true,
          dietaryRequirements: true,
          invitation: { select: { revokedAt: true, deliveryStatus: true } },
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),

    async categoryTotals(weddingId) {
      const rows = await tx.$queryRaw<
        { category: string; expenseCount: bigint | number; committed: Prisma.Decimal; paid: Prisma.Decimal | null }[]
      >`
        SELECT btrim(e."category") AS "category", COUNT(*) AS "expenseCount",
               SUM(e."agreedAmount") AS "committed", COALESCE(SUM(p."paid"), 0) AS "paid"
        FROM "Expense" e
        LEFT JOIN (
          SELECT "expenseId", SUM("amount") AS "paid" FROM "Payment"
          WHERE "expenseId" IN (SELECT "id" FROM "Expense" WHERE "weddingId" = ${weddingId})
          GROUP BY "expenseId"
        ) p ON p."expenseId" = e."id"
        WHERE e."weddingId" = ${weddingId}
        GROUP BY btrim(e."category")`;
      return rows.map((r) => ({
        category: r.category,
        expenseCount: n(r.expenseCount),
        committed: new Prisma.Decimal(r.committed),
        paid: new Prisma.Decimal(r.paid ?? 0),
      }));
    },
  };
}

export const dashboardRepository = {
  /** Runs `work` against ONE consistent snapshot (REPEATABLE READ): all figures agree (FR-59, NFR-14). */
  snapshot<T>(work: (db: SnapshotReader) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => work(makeReader(tx)), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  },
};

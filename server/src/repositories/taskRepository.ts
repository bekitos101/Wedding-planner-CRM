import { Prisma, type MemberStatus, type TaskPriority, type TaskStatus, type WeddingStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const withAssignee = { assignee: { select: { id: true, name: true } } } satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof withAssignee }>;

export interface TaskListFilter {
  /** user id, or 'unassigned' */
  assignee?: string | 'unassigned';
  status?: TaskStatus;
  /** dueDate < overdueBefore AND status != COMPLETED */
  overdueBefore?: Date;
}

export interface NewTaskData {
  title: string;
  description: string | null;
  dueDate: Date;
  priority: TaskPriority;
  status: TaskStatus;
  progressNotes?: string | null;
  assigneeId: string | null;
  completedAt: Date | null;
  sourceTemplateItemId?: string | null;
}

export type TaskUpdateData = Partial<Omit<NewTaskData, 'sourceTemplateItemId'>>;

/** Data access inside ONE database transaction. No business rules here: the service decides. */
export interface TaskTx {
  /** Locks the wedding row (FOR SHARE) so a concurrent archive waits for this transaction; returns its status (null = gone). */
  lockWeddingStatus(weddingId: string): Promise<WeddingStatus | null>;
  /**
   * Locks the user's membership row (FOR SHARE) so a concurrent revoke waits for this transaction.
   * Returns the wedding's ownerId and the user's membership status (null = no membership row);
   * null when the wedding doesn't exist. The service decides who may be assigned.
   */
  lockWeddingAndMembership(weddingId: string, userId: string): Promise<{ ownerId: string; memberStatus: MemberStatus | null } | null>;
  findById(weddingId: string, id: string): Promise<TaskRow | null>;
  create(weddingId: string, data: NewTaskData): Promise<TaskRow>;
  createMany(weddingId: string, data: NewTaskData[]): Promise<TaskRow[]>;
  /** Scoped by id AND weddingId. Null = no such task in this wedding. */
  update(weddingId: string, id: string, data: TaskUpdateData): Promise<TaskRow | null>;
  /** True when a row was deleted. */
  delete(weddingId: string, id: string): Promise<boolean>;
}

function makeTx(tx: Prisma.TransactionClient): TaskTx {
  const self: TaskTx = {
    async lockWeddingStatus(weddingId) {
      const rows = await tx.$queryRaw<{ status: WeddingStatus }[]>`
        SELECT "status"::text AS "status" FROM "Wedding" WHERE "id" = ${weddingId} FOR SHARE`;
      return rows[0]?.status ?? null;
    },

    async lockWeddingAndMembership(weddingId, userId) {
      const wedding = await tx.wedding.findUnique({ where: { id: weddingId }, select: { ownerId: true } });
      if (!wedding) return null;
      const rows = await tx.$queryRaw<{ status: MemberStatus }[]>`
        SELECT "status"::text AS "status" FROM "WeddingMember"
        WHERE "weddingId" = ${weddingId} AND "userId" = ${userId} FOR SHARE`;
      return { ownerId: wedding.ownerId, memberStatus: rows[0]?.status ?? null };
    },

    findById: (weddingId, id) => tx.task.findFirst({ where: { id, weddingId }, include: withAssignee }),

    create: (weddingId, data) => tx.task.create({ data: { weddingId, ...data }, include: withAssignee }),

    async createMany(weddingId, data) {
      const created: TaskRow[] = [];
      for (const d of data) created.push(await self.create(weddingId, d));
      return created;
    },

    async update(weddingId, id, data) {
      const r = await tx.task.updateMany({ where: { id, weddingId }, data });
      if (r.count === 0) return null;
      return self.findById(weddingId, id);
    },

    async delete(weddingId, id) {
      const r = await tx.task.deleteMany({ where: { id, weddingId } });
      return r.count > 0;
    },
  };
  return self;
}

export const taskRepository = {
  list(weddingId: string, filter: TaskListFilter): Promise<TaskRow[]> {
    const where: Prisma.TaskWhereInput = { weddingId };
    if (filter.assignee === 'unassigned') where.assigneeId = null;
    else if (filter.assignee) where.assigneeId = filter.assignee;
    if (filter.status) where.status = filter.status;
    if (filter.overdueBefore) {
      where.dueDate = { lt: filter.overdueBefore };
      where.status = filter.status ? filter.status : { not: 'COMPLETED' };
      if (filter.status === 'COMPLETED') where.id = { in: [] }; // overdue AND completed is empty
    }
    // Postgres orders enums by declaration order (LOW, MEDIUM, HIGH), so desc = HIGH first.
    return prisma.task.findMany({
      where,
      include: withAssignee,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }, { title: 'asc' }, { id: 'asc' }],
    });
  },

  /** Runs `fn` in one transaction with a tx-bound data-access object. */
  transaction<T>(fn: (tx: TaskTx) => Promise<T>): Promise<T> {
    return prisma.$transaction((tx) => fn(makeTx(tx)));
  },
};

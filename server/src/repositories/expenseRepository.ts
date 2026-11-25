import { Prisma, type Expense } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface ExpenseFields {
  description: string;
  category: string;
  agreedAmount: Prisma.Decimal;
  dueDate: Date;
  notes: string | null;
}

export interface PaymentTotals {
  total: Prisma.Decimal;
  count: number;
}

export interface OverdueRow {
  id: string;
  description: string;
  category: string;
  dueDate: Date;
  outstanding: Prisma.Decimal;
}

export interface BudgetFigures {
  totalBudget: Prisma.Decimal;
  committed: Prisma.Decimal;
  paid: Prisma.Decimal;
  overdue: OverdueRow[];
}

export const expenseRepository = {
  /** Expenses of a wedding sorted by dueDate then description. */
  listByWedding(weddingId: string): Promise<Expense[]> {
    return prisma.expense.findMany({ where: { weddingId }, orderBy: [{ dueDate: 'asc' }, { description: 'asc' }] });
  },

  /** Payment sum + count per expense of a wedding, aggregated in the database. */
  async paymentTotalsByExpense(weddingId: string): Promise<Map<string, PaymentTotals>> {
    const rows = await prisma.payment.groupBy({
      by: ['expenseId'],
      where: { expense: { weddingId } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.expenseId, { total: r._sum.amount ?? new Prisma.Decimal(0), count: r._count._all }]));
  },

  /**
   * Everything the budget summary / dashboard needs, read in ONE REPEATABLE READ transaction so
   * the figures always agree with each other (NFR-14). Overdue expenses are computed in SQL:
   * dueDate before `today` and agreedAmount > sum of payments.
   */
  budgetFigures(weddingId: string, today: Date): Promise<BudgetFigures> {
    return prisma.$transaction(
      async (tx) => {
        const [wedding, e, p, overdue] = await Promise.all([
          tx.wedding.findUnique({ where: { id: weddingId }, select: { totalBudget: true } }),
          tx.expense.aggregate({ where: { weddingId }, _sum: { agreedAmount: true } }),
          tx.payment.aggregate({ where: { expense: { weddingId } }, _sum: { amount: true } }),
          tx.$queryRaw<OverdueRow[]>`
            SELECT e."id", e."description", e."category", e."dueDate",
                   e."agreedAmount" - COALESCE(SUM(p."amount"), 0) AS "outstanding"
            FROM "Expense" e LEFT JOIN "Payment" p ON p."expenseId" = e."id"
            WHERE e."weddingId" = ${weddingId} AND e."dueDate" < ${today}::date
            GROUP BY e."id"
            HAVING e."agreedAmount" > COALESCE(SUM(p."amount"), 0)
            ORDER BY e."dueDate" ASC, e."description" ASC`,
        ]);
        return {
          totalBudget: wedding?.totalBudget ?? new Prisma.Decimal(0),
          committed: e._sum.agreedAmount ?? new Prisma.Decimal(0),
          paid: p._sum.amount ?? new Prisma.Decimal(0),
          overdue,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  },

  /** Scoped by weddingId AND id. */
  find(weddingId: string, expenseId: string): Promise<Expense | null> {
    return prisma.expense.findFirst({ where: { id: expenseId, weddingId } });
  },

  create(weddingId: string, data: ExpenseFields): Promise<Expense> {
    return prisma.expense.create({ data: { weddingId, ...data } });
  },

  async delete(weddingId: string, expenseId: string): Promise<boolean> {
    const r = await prisma.expense.deleteMany({ where: { id: expenseId, weddingId } });
    return r.count > 0;
  },

  /**
   * Runs `work` in a transaction holding a row lock on the expense (SELECT ... FOR UPDATE), so two
   * concurrent payment/agreedAmount changes on the same expense are serialised (NFR-14). Resolves
   * null when the expense does not exist in this wedding.
   */
  runLocked<T>(
    weddingId: string,
    expenseId: string,
    work: (tx: Prisma.TransactionClient, expense: Expense) => Promise<T>,
  ): Promise<T | null> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Expense" WHERE "id" = ${expenseId} AND "weddingId" = ${weddingId} FOR UPDATE`;
      if (locked.length === 0) return null;
      const expense = await tx.expense.findFirst({ where: { id: expenseId, weddingId } });
      if (!expense) return null;
      return work(tx, expense);
    });
  },

  /** Consistent read (one transaction, no lock) of an expense scoped by wedding. Null when not found. */
  readWithTx<T>(weddingId: string, expenseId: string, work: (tx: Prisma.TransactionClient, expense: Expense) => Promise<T>): Promise<T | null> {
    return prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id: expenseId, weddingId } });
      return expense ? work(tx, expense) : null;
    });
  },

  findInTx(tx: Prisma.TransactionClient, expenseId: string): Promise<Expense | null> {
    return tx.expense.findUnique({ where: { id: expenseId } });
  },

  updateInTx(tx: Prisma.TransactionClient, expenseId: string, data: Partial<ExpenseFields>): Promise<Expense> {
    return tx.expense.update({ where: { id: expenseId }, data });
  },
};

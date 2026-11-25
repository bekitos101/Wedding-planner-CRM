import { Prisma, type Payment } from '@prisma/client';

const Decimal = Prisma.Decimal;

/** Payment data access. Every function takes the (transaction) client so callers can compose them atomically. */
type Db = Prisma.TransactionClient;

export interface PaymentFields {
  amount: Prisma.Decimal;
  paymentDate: Date;
  notes: string | null;
}

export const paymentRepository = {
  async sumForExpense(db: Db, expenseId: string): Promise<Prisma.Decimal> {
    const r = await db.payment.aggregate({ where: { expenseId }, _sum: { amount: true } });
    return r._sum.amount ?? new Decimal(0);
  },

  create(db: Db, expenseId: string, data: PaymentFields): Promise<Payment> {
    return db.payment.create({ data: { expenseId, ...data } });
  },

  /** Scoped by expenseId (the caller already proved the expense belongs to the wedding). */
  find(db: Db, expenseId: string, paymentId: string): Promise<Payment | null> {
    return db.payment.findFirst({ where: { id: paymentId, expenseId } });
  },

  update(db: Db, paymentId: string, data: Partial<PaymentFields>): Promise<Payment> {
    return db.payment.update({ where: { id: paymentId }, data });
  },

  async delete(db: Db, expenseId: string, paymentId: string): Promise<boolean> {
    const r = await db.payment.deleteMany({ where: { id: paymentId, expenseId } });
    return r.count > 0;
  },

  listForExpense(db: Db, expenseId: string): Promise<Payment[]> {
    return db.payment.findMany({ where: { expenseId }, orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }] });
  },
};

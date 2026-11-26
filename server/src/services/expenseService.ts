import { Prisma, type Expense, type Payment } from '@prisma/client';

type Db = Prisma.TransactionClient;
import { todayUtc } from '../lib/dates.js';
import { notFound, validationError } from '../lib/errors.js';
import { formatDateOnly, formatMoney } from '../lib/schemas.js';
import { expenseRepository, type ExpenseFields } from '../repositories/expenseRepository.js';
import { paymentRepository, type PaymentFields } from '../repositories/paymentRepository.js';
import { assertWeddingActive, inActiveWedding } from './weddingGuard.js';

const ZERO = new Prisma.Decimal(0);

export interface PaymentDto {
  id: string;
  amount: string;
  paymentDate: string;
  notes: string | null;
  createdAt: Date;
}

export interface ExpenseDto {
  id: string;
  description: string;
  category: string;
  agreedAmount: string;
  dueDate: string;
  notes: string | null;
  totalPaid: string;
  outstanding: string;
  isOverdue: boolean;
  paymentCount: number;
  createdAt: Date;
  payments?: PaymentDto[];
}

const expenseNotFound = () => notFound('Expense not found.');
const paymentNotFound = () => notFound('Payment not found.');

/** Derived values are computed on every read (FR-59, BR-07). */
export function toExpenseDto(e: Expense, totalPaid: Prisma.Decimal, paymentCount: number, today = todayUtc()): ExpenseDto {
  const outstanding = e.agreedAmount.minus(totalPaid);
  return {
    id: e.id,
    description: e.description,
    category: e.category,
    agreedAmount: formatMoney(e.agreedAmount)!,
    dueDate: formatDateOnly(e.dueDate)!,
    notes: e.notes,
    totalPaid: formatMoney(totalPaid)!,
    outstanding: formatMoney(outstanding)!,
    isOverdue: outstanding.gt(0) && e.dueDate.getTime() < today.getTime(),
    paymentCount,
    createdAt: e.createdAt,
  };
}

const toPaymentDto = (p: Payment): PaymentDto => ({
  id: p.id,
  amount: formatMoney(p.amount)!,
  paymentDate: formatDateOnly(p.paymentDate)!,
  notes: p.notes,
  createdAt: p.createdAt,
});

function overpaid(outstanding: Prisma.Decimal): never {
  const msg = `This payment is more than the outstanding balance (${formatMoney(outstanding)}).`;
  throw validationError(msg, { amount: msg });
}

export const expenseService = {
  async list(weddingId: string): Promise<ExpenseDto[]> {
    const [expenses, totals] = await Promise.all([
      expenseRepository.listByWedding(weddingId),
      expenseRepository.paymentTotalsByExpense(weddingId),
    ]);
    const today = todayUtc();
    return expenses.map((e) => {
      const t = totals.get(e.id);
      return toExpenseDto(e, t?.total ?? ZERO, t?.count ?? 0, today);
    });
  },

  async get(weddingId: string, expenseId: string): Promise<ExpenseDto> {
    const res = await expenseRepository.readWithTx(weddingId, expenseId, (tx, e) => withPayments(tx, e));
    if (!res) throw expenseNotFound();
    return res;
  },

  async create(weddingId: string, data: ExpenseFields): Promise<ExpenseDto> {
    const e = await inActiveWedding(weddingId, (tx) => expenseRepository.create(weddingId, data, tx));
    return toExpenseDto(e, ZERO, 0);
  },

  async update(weddingId: string, expenseId: string, data: Partial<ExpenseFields>): Promise<ExpenseDto> {
    const res = await expenseRepository.runLocked(weddingId, expenseId, async (tx, current) => {
      const paid = await paymentRepository.sumForExpense(tx, expenseId);
      if (data.agreedAmount && data.agreedAmount.lt(paid)) {
        const msg = `The agreed amount can't be less than what has already been paid (${formatMoney(paid)}).`;
        throw validationError(msg, { agreedAmount: msg });
      }
      const updated = Object.keys(data).length ? await expenseRepository.updateInTx(tx, expenseId, data) : current;
      return withPayments(tx, updated);
    }, (tx) => assertWeddingActive(tx, weddingId));
    if (!res) throw expenseNotFound();
    const { payments: _omit, ...plain } = res;
    return plain;
  },

  async remove(weddingId: string, expenseId: string): Promise<void> {
    if (!(await inActiveWedding(weddingId, (tx) => expenseRepository.delete(weddingId, expenseId, tx)))) throw expenseNotFound();
  },

  async addPayment(weddingId: string, expenseId: string, data: PaymentFields): Promise<ExpenseDto> {
    const res = await expenseRepository.runLocked(weddingId, expenseId, async (tx, e) => {
      const paid = await paymentRepository.sumForExpense(tx, expenseId);
      if (paid.plus(data.amount).gt(e.agreedAmount)) overpaid(e.agreedAmount.minus(paid));
      await paymentRepository.create(tx, expenseId, data);
      return withPayments(tx, e);
    }, (tx) => assertWeddingActive(tx, weddingId));
    if (!res) throw expenseNotFound();
    return res;
  },

  async updatePayment(weddingId: string, expenseId: string, paymentId: string, data: Partial<PaymentFields>): Promise<ExpenseDto> {
    const res = await expenseRepository.runLocked(weddingId, expenseId, async (tx, e) => {
      const payment = await paymentRepository.find(tx, expenseId, paymentId);
      if (!payment) throw paymentNotFound();
      if (data.amount) {
        const others = (await paymentRepository.sumForExpense(tx, expenseId)).minus(payment.amount);
        if (others.plus(data.amount).gt(e.agreedAmount)) overpaid(e.agreedAmount.minus(others));
      }
      if (Object.keys(data).length) await paymentRepository.update(tx, paymentId, data);
      return withPayments(tx, e);
    }, (tx) => assertWeddingActive(tx, weddingId));
    if (!res) throw expenseNotFound();
    return res;
  },

  async removePayment(weddingId: string, expenseId: string, paymentId: string): Promise<ExpenseDto> {
    const res = await expenseRepository.runLocked(weddingId, expenseId, async (tx, e) => {
      if (!(await paymentRepository.delete(tx, expenseId, paymentId))) throw paymentNotFound();
      return withPayments(tx, e);
    }, (tx) => assertWeddingActive(tx, weddingId));
    if (!res) throw expenseNotFound();
    return res;
  },
};

async function withPayments(tx: Db, e: Expense): Promise<ExpenseDto> {
  const [fresh, payments, total] = await Promise.all([
    expenseRepository.findInTx(tx, e.id),
    paymentRepository.listForExpense(tx, e.id),
    paymentRepository.sumForExpense(tx, e.id),
  ]);
  return { ...toExpenseDto(fresh ?? e, total, payments.length), payments: payments.map(toPaymentDto) };
}

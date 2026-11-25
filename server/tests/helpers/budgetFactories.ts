import { prisma } from '../../src/lib/prisma.js';

export async function makeExpense(
  weddingId: string,
  o: Partial<{ description: string; category: string; agreedAmount: string; dueDate: string }> = {},
) {
  return prisma.expense.create({
    data: {
      weddingId,
      description: o.description ?? 'Venue',
      category: o.category ?? 'Venue',
      agreedAmount: o.agreedAmount ?? '1000.00',
      dueDate: new Date(`${o.dueDate ?? '2099-01-01'}T00:00:00.000Z`),
    },
  });
}

export async function makePayment(expenseId: string, amount: string, paymentDate = '2026-01-01') {
  return prisma.payment.create({ data: { expenseId, amount, paymentDate: new Date(`${paymentDate}T00:00:00.000Z`) } });
}

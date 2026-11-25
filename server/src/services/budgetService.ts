import { todayUtc } from '../lib/dates.js';
import { formatDateOnly, formatMoney } from '../lib/schemas.js';
import { expenseRepository } from '../repositories/expenseRepository.js';

export interface BudgetSummary {
  totalBudget: string;
  committed: string;
  paid: string;
  outstanding: string;
  remaining: string;
  overdueExpenses: { id: string; description: string; category: string; outstanding: string; dueDate: string }[];
}

export const budgetService = {
  /**
   * FR-45/46: computed from stored rows on every call (FR-59), from one consistent snapshot
   * (NFR-14). The phase 4 dashboard can call this directly.
   */
  async summary(weddingId: string, today: Date = todayUtc()): Promise<BudgetSummary> {
    const { totalBudget, committed, paid, overdue } = await expenseRepository.budgetFigures(weddingId, today);
    return {
      totalBudget: formatMoney(totalBudget)!,
      committed: formatMoney(committed)!,
      paid: formatMoney(paid)!,
      outstanding: formatMoney(committed.minus(paid))!,
      remaining: formatMoney(totalBudget.minus(committed))!,
      overdueExpenses: overdue.map((e) => ({
        id: e.id,
        description: e.description,
        category: e.category,
        outstanding: formatMoney(e.outstanding)!,
        dueDate: formatDateOnly(e.dueDate)!,
      })),
    };
  },
};

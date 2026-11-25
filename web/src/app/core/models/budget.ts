import { DateOnly } from './wedding';

export interface Payment {
  id: string;
  amount: string;
  paymentDate: DateOnly;
  notes: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  agreedAmount: string;
  dueDate: DateOnly;
  notes: string | null;
  totalPaid: string;
  outstanding: string;
  isOverdue: boolean;
  paymentCount: number;
  createdAt: string;
  /** Only on the detail / payment endpoints. */
  payments?: Payment[];
}

export interface ExpenseInput {
  description: string;
  category: string;
  agreedAmount: string;
  dueDate: DateOnly;
  notes?: string;
}

export interface PaymentInput {
  amount: string;
  paymentDate: DateOnly;
  notes?: string;
}

export interface BudgetSummary {
  totalBudget: string;
  committed: string;
  paid: string;
  outstanding: string;
  remaining: string;
  overdueExpenses: { id: string; description: string; category: string; outstanding: string; dueDate: DateOnly }[];
}

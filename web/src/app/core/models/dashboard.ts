import { DateOnly, WeddingStatus } from './wedding';
import { Task } from './task';

export interface Dashboard {
  wedding: {
    id: string;
    coupleNames: string;
    weddingDate: DateOnly;
    location: string;
    status: WeddingStatus;
    daysUntilWedding: number;
  };
  guests: {
    total: number;
    pending: number;
    accepted: number;
    declined: number;
    responseRate: number;
    invitations: { notSent: number; sent: number; failed: number; revoked: number };
  };
  tasks: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    unfinished: number;
    overdue: number;
    dueNext7Days: number;
    percentComplete: number;
    myOpenTasks: number;
  };
  budget: {
    totalBudget: string;
    committed: string;
    paid: string;
    outstanding: string;
    remaining: string;
    overdueExpenseCount: number;
  };
  suppliers: { total: number };
  schedule: { items: number; overlappingItems: number };
  upcomingTasks: Task[];
}

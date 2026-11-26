import { todayUtc, toDateOnly } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { percentOf } from '../lib/percent.js';
import { dashboardRepository } from '../repositories/dashboardRepository.js';
import { toBudgetSummary } from './budgetService.js';
import { computeOverlaps } from './scheduleService.js';
import { toTaskDto } from './taskService.js';

const DAY_MS = 86_400_000;
const UPCOMING_LIMIT = 5;


export const dashboardService = {
  /** FR-57..60: every figure computed from stored rows in one snapshot; same for owner and members. */
  async get(weddingId: string, userId: string, today: Date = todayUtc()) {
    const weekEnd = new Date(today.getTime() + 7 * DAY_MS);
    return dashboardRepository.snapshot(async (db) => {
      const wedding = await db.wedding(weddingId);
      if (!wedding) throw notFound('Wedding not found.');
      const guests = await db.guestCounts(weddingId);
      const tasks = await db.taskCounts(weddingId, userId, today, weekEnd);
      const upcoming = await db.upcomingTasks(weddingId, UPCOMING_LIMIT);
      const { overdueExpenses, ...budgetTotals } = toBudgetSummary(await db.budgetFigures(weddingId, today));
      const supplierTotal = await db.supplierCount(weddingId);
      const items = await db.scheduleTimes(weddingId);
      const overlaps = computeOverlaps(items);

      return {
        wedding: {
          id: wedding.id,
          coupleNames: wedding.coupleNames,
          weddingDate: toDateOnly(wedding.weddingDate),
          location: wedding.location,
          status: wedding.status,
          daysUntilWedding: Math.round((wedding.weddingDate.getTime() - today.getTime()) / DAY_MS),
        },
        guests: {
          total: guests.total,
          pending: guests.pending,
          accepted: guests.accepted,
          declined: guests.declined,
          responseRate: percentOf(guests.accepted + guests.declined, guests.total),
          invitations: { notSent: guests.notSent, sent: guests.sent, failed: guests.failed, revoked: guests.revoked },
        },
        tasks: {
          total: tasks.total,
          todo: tasks.todo,
          inProgress: tasks.inProgress,
          completed: tasks.completed,
          unfinished: tasks.todo + tasks.inProgress,
          overdue: tasks.overdue,
          dueNext7Days: tasks.dueNext7Days,
          percentComplete: percentOf(tasks.completed, tasks.total),
          myOpenTasks: tasks.myOpenTasks,
        },
        budget: { ...budgetTotals, overdueExpenseCount: overdueExpenses.length },
        suppliers: { total: supplierTotal },
        schedule: {
          items: items.length,
          overlappingItems: [...overlaps.values()].filter((ids) => ids.length > 0).length,
        },
        upcomingTasks: upcoming.map((t) => toTaskDto(t, today)),
      };
    });
  },
};

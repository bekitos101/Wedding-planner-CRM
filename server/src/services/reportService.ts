import { Prisma } from '@prisma/client';
import { todayUtc } from '../lib/dates.js';
import { percentOf } from '../lib/percent.js';
import { formatMoney } from '../lib/schemas.js';
import { dashboardRepository, type CategoryRow } from '../repositories/dashboardRepository.js';
import { toBudgetSummary } from './budgetService.js';
import { invitationStatusOf } from './guestService.js';

type InvitationStatus = 'NOT_SENT' | 'SENT' | 'FAILED' | 'REVOKED';

/** Same rule as the dashboard counts: no invitation or delivery PENDING = NOT_SENT; REVOKED wins. */
function reportInvitationStatus(
  inv: { revokedAt: Date | null; deliveryStatus: 'SENT' | 'FAILED' | 'PENDING' } | null,
): InvitationStatus {
  if (!inv) return 'NOT_SENT';
  const s = invitationStatusOf(inv);
  return s === 'PENDING' ? 'NOT_SENT' : s;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Merges exact spellings into case-insensitive groups; label = most common spelling (ties: alphabetical). */
function groupCategories(rows: CategoryRow[]) {
  const groups = new Map<string, CategoryRow[]>();
  for (const r of rows) {
    const key = r.category.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()].map((spellings) => {
    const label = [...spellings].sort((a, b) => b.expenseCount - a.expenseCount || compare(a.category, b.category))[0]!.category;
    return {
      category: label,
      expenseCount: spellings.reduce((s, r) => s + r.expenseCount, 0),
      committed: spellings.reduce((s, r) => s.plus(r.committed), new Prisma.Decimal(0)),
      paid: spellings.reduce((s, r) => s.plus(r.paid), new Prisma.Decimal(0)),
    };
  });
}

export const reportService = {
  /** FR-58: guest responses (counts + dietary list + printable guest list). One snapshot. */
  async guests(weddingId: string) {
    return dashboardRepository.snapshot(async (db) => {
      const rows = await db.guestsForReport(weddingId);
      const accepted = rows.filter((g) => g.rsvpStatus === 'ACCEPTED').length;
      const declined = rows.filter((g) => g.rsvpStatus === 'DECLINED').length;
      const total = rows.length;
      return {
        summary: { total, pending: total - accepted - declined, accepted, declined, responseRate: percentOf(accepted + declined, total) },
        dietary: rows
          .filter((g) => (g.dietaryRequirements ?? '').trim() !== '')
          .map((g) => ({ name: g.name, rsvpStatus: g.rsvpStatus, dietaryRequirements: g.dietaryRequirements!.trim() })),
        guests: rows.map((g) => ({
          name: g.name,
          email: g.email,
          rsvpStatus: g.rsvpStatus,
          respondedAt: g.respondedAt ? g.respondedAt.toISOString() : null,
          dietaryRequirements: g.dietaryRequirements?.trim() || null,
          invitationStatus: reportInvitationStatus(g.invitation),
        })),
      };
    });
  },

  /** FR-58: budget status overall and by category (Decimal math, floor percentages). One snapshot. */
  async budget(weddingId: string, today: Date = todayUtc()) {
    return dashboardRepository.snapshot(async (db) => {
      const figures = await db.budgetFigures(weddingId, today);
      const rows = await db.categoryTotals(weddingId);
      const { totalBudget, committed, paid, outstanding, remaining } = toBudgetSummary(figures);
      const byCategory = groupCategories(rows)
        .sort((a, b) => b.committed.comparedTo(a.committed) || compare(a.category, b.category))
        .map((c) => ({
          category: c.category,
          expenseCount: c.expenseCount,
          committed: formatMoney(c.committed)!,
          paid: formatMoney(c.paid)!,
          outstanding: formatMoney(c.committed.minus(c.paid))!,
          shareOfCommitted: figures.committed.gt(0) ? c.committed.times(100).div(figures.committed).floor().toNumber() : 0,
        }));
      return { totals: { totalBudget, committed, paid, outstanding, remaining }, byCategory };
    });
  },
};

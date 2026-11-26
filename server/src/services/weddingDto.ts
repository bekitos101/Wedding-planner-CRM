import type { Prisma } from '@prisma/client';
import { toDateOnly } from '../lib/dates.js';
import { percentOf } from '../lib/percent.js';
import type { WeddingWithOwner } from '../repositories/weddingRepository.js';

export type WeddingRole = 'OWNER' | 'TEAM_MEMBER';

export interface Progress {
  completed: number;
  total: number;
  percent: number;
}

export const toMoney = (d: Prisma.Decimal): string => d.toFixed(2);

/** percent = floor(completed / total * 100) using integer math, so 100 only when everything is done. */
export function toProgress(counts?: { total: number; completed: number }): Progress {
  const total = counts?.total ?? 0;
  const completed = counts?.completed ?? 0;
  return { completed, total, percent: percentOf(completed, total) };
}

export function toWeddingDto(w: WeddingWithOwner, role: WeddingRole, progress: Progress) {
  return {
    id: w.id,
    coupleNames: w.coupleNames,
    weddingDate: toDateOnly(w.weddingDate),
    location: w.location,
    totalBudget: toMoney(w.totalBudget),
    rsvpDeadline: toDateOnly(w.rsvpDeadline),
    status: w.status,
    archivedAt: w.archivedAt ? w.archivedAt.toISOString() : null,
    createdAt: w.createdAt.toISOString(),
    owner: { id: w.owner.id, name: w.owner.name },
    role,
    progress,
  };
}
export type WeddingDto = ReturnType<typeof toWeddingDto>;

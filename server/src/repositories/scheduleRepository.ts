import type { Prisma, ScheduleItem } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const scheduleRepository = {
  /** All items of a wedding in display order (startTime, endTime, title, id). */
  list(weddingId: string): Promise<ScheduleItem[]> {
    return prisma.scheduleItem.findMany({
      where: { weddingId },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    });
  },

  find(weddingId: string, id: string): Promise<ScheduleItem | null> {
    return prisma.scheduleItem.findFirst({ where: { id, weddingId } });
  },

  create(weddingId: string, data: Omit<Prisma.ScheduleItemUncheckedCreateInput, 'weddingId'>): Promise<ScheduleItem> {
    return prisma.scheduleItem.create({ data: { ...data, weddingId } });
  },

  async update(weddingId: string, id: string, data: Prisma.ScheduleItemUncheckedUpdateInput): Promise<ScheduleItem | null> {
    const res = await prisma.scheduleItem.updateMany({ where: { id, weddingId }, data });
    return res.count === 0 ? null : this.find(weddingId, id);
  },

  async delete(weddingId: string, id: string): Promise<boolean> {
    return (await prisma.scheduleItem.deleteMany({ where: { id, weddingId } })).count > 0;
  },
};

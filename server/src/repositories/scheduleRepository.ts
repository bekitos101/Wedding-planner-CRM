import type { Prisma, ScheduleItem } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type Db = Prisma.TransactionClient | typeof prisma;

export const scheduleRepository = {
  /** All items of a wedding in display order (startTime, endTime, title, id). */
  list(weddingId: string): Promise<ScheduleItem[]> {
    return prisma.scheduleItem.findMany({
      where: { weddingId },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    });
  },

  find(weddingId: string, id: string, db: Db = prisma): Promise<ScheduleItem | null> {
    return db.scheduleItem.findFirst({ where: { id, weddingId } });
  },

  create(weddingId: string, data: Omit<Prisma.ScheduleItemUncheckedCreateInput, 'weddingId'>, db: Db = prisma): Promise<ScheduleItem> {
    return db.scheduleItem.create({ data: { ...data, weddingId } });
  },

  async update(weddingId: string, id: string, data: Prisma.ScheduleItemUncheckedUpdateInput, db: Db = prisma): Promise<ScheduleItem | null> {
    const res = await db.scheduleItem.updateMany({ where: { id, weddingId }, data });
    return res.count === 0 ? null : this.find(weddingId, id, db);
  },

  async delete(weddingId: string, id: string, db: Db = prisma): Promise<boolean> {
    return (await db.scheduleItem.deleteMany({ where: { id, weddingId } })).count > 0;
  },
};

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const withItems = {
  items: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ChecklistTemplateInclude;

export type TemplateRow = Prisma.ChecklistTemplateGetPayload<{ include: typeof withItems }>;

export const checklistRepository = {
  listTemplates(): Promise<TemplateRow[]> {
    return prisma.checklistTemplate.findMany({ include: withItems, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  },

  findTemplate(id: string): Promise<TemplateRow | null> {
    return prisma.checklistTemplate.findUnique({ where: { id }, include: withItems });
  },

  async findWeddingDate(weddingId: string): Promise<Date | null> {
    const w = await prisma.wedding.findUnique({ where: { id: weddingId }, select: { weddingDate: true } });
    return w?.weddingDate ?? null;
  },
};

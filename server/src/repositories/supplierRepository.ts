import type { Prisma, Supplier } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface SupplierFilter {
  search?: string;
  category?: string;
}

export const supplierRepository = {
  list(weddingId: string, filter: SupplierFilter): Promise<Supplier[]> {
    const where: Prisma.SupplierWhereInput = { weddingId };
    if (filter.category) where.category = { equals: filter.category, mode: 'insensitive' };
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { category: { contains: filter.search, mode: 'insensitive' } },
        { contactInfo: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return prisma.supplier.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
  },

  find(weddingId: string, id: string): Promise<Supplier | null> {
    return prisma.supplier.findFirst({ where: { id, weddingId } });
  },

  create(weddingId: string, data: Omit<Prisma.SupplierUncheckedCreateInput, 'weddingId'>): Promise<Supplier> {
    return prisma.supplier.create({ data: { ...data, weddingId } });
  },

  async update(weddingId: string, id: string, data: Prisma.SupplierUncheckedUpdateInput): Promise<Supplier | null> {
    const res = await prisma.supplier.updateMany({ where: { id, weddingId }, data });
    return res.count === 0 ? null : this.find(weddingId, id);
  },

  async delete(weddingId: string, id: string): Promise<boolean> {
    return (await prisma.supplier.deleteMany({ where: { id, weddingId } })).count > 0;
  },
};

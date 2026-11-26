import type { Prisma, Supplier } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type Db = Prisma.TransactionClient | typeof prisma;

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

  find(weddingId: string, id: string, db: Db = prisma): Promise<Supplier | null> {
    return db.supplier.findFirst({ where: { id, weddingId } });
  },

  create(weddingId: string, data: Omit<Prisma.SupplierUncheckedCreateInput, 'weddingId'>, db: Db = prisma): Promise<Supplier> {
    return db.supplier.create({ data: { ...data, weddingId } });
  },

  async update(weddingId: string, id: string, data: Prisma.SupplierUncheckedUpdateInput, db: Db = prisma): Promise<Supplier | null> {
    const res = await db.supplier.updateMany({ where: { id, weddingId }, data });
    return res.count === 0 ? null : this.find(weddingId, id, db);
  },

  async delete(weddingId: string, id: string, db: Db = prisma): Promise<boolean> {
    return (await db.supplier.deleteMany({ where: { id, weddingId } })).count > 0;
  },
};

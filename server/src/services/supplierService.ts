import type { Prisma, Supplier } from '@prisma/client';
import { notFound } from '../lib/errors.js';
import { formatMoney } from '../lib/schemas.js';
import { supplierRepository } from '../repositories/supplierRepository.js';
import { inActiveWedding } from './weddingGuard.js';

export function toSupplierDto(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    contactInfo: s.contactInfo,
    quotedPrice: formatMoney(s.quotedPrice),
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  };
}
export type SupplierDto = ReturnType<typeof toSupplierDto>;

export interface SupplierInput {
  name: string;
  category: string;
  contactInfo: string | null;
  quotedPrice: Prisma.Decimal | null;
  notes: string | null;
}

const NOT_FOUND = 'Supplier not found.';

export const supplierService = {
  async list(weddingId: string, filter: { search?: string; category?: string }): Promise<SupplierDto[]> {
    return (await supplierRepository.list(weddingId, filter)).map(toSupplierDto);
  },

  async create(weddingId: string, input: SupplierInput): Promise<SupplierDto> {
    return toSupplierDto(await inActiveWedding(weddingId, (tx) => supplierRepository.create(weddingId, input, tx)));
  },

  async update(weddingId: string, id: string, patch: Partial<SupplierInput>): Promise<SupplierDto> {
    const row = await inActiveWedding(weddingId, (tx) => supplierRepository.update(weddingId, id, patch, tx));
    if (!row) throw notFound(NOT_FOUND);
    return toSupplierDto(row);
  },

  async remove(weddingId: string, id: string): Promise<void> {
    if (!(await inActiveWedding(weddingId, (tx) => supplierRepository.delete(weddingId, id, tx)))) throw notFound(NOT_FOUND);
  },
};

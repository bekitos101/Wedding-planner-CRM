import { prisma } from '../../src/lib/prisma.js';

export async function createSupplier(
  weddingId: string,
  o: { name?: string; category?: string; contactInfo?: string | null; quotedPrice?: string | null } = {},
) {
  return prisma.supplier.create({
    data: {
      weddingId,
      name: o.name ?? 'Supplier',
      category: o.category ?? 'Venue',
      contactInfo: o.contactInfo ?? null,
      quotedPrice: o.quotedPrice ?? null,
    },
  });
}

export async function createScheduleItem(weddingId: string, title: string, startIso: string, endIso: string) {
  return prisma.scheduleItem.create({
    data: { weddingId, title, startTime: new Date(startIso), endTime: new Date(endIso) },
  });
}

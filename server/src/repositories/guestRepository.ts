import type { Prisma, RsvpStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** Client for writes: the shared one, or a transaction client when the service owns the transaction. */
type Db = Prisma.TransactionClient | typeof prisma;

// The token hash is deliberately NOT selected: planner endpoints never see it.
const invitationSelect = {
  deliveryStatus: true,
  attemptCount: true,
  lastSentAt: true,
  lastError: true,
  revokedAt: true,
} satisfies Prisma.InvitationSelect;

const withInvitation = { invitation: { select: invitationSelect } } satisfies Prisma.GuestInclude;

export type GuestRow = Prisma.GuestGetPayload<{ include: typeof withInvitation }>;

export interface GuestCreate {
  name: string;
  email: string;
  dietaryRequirements: string | null;
}
export interface GuestUpdate {
  name?: string;
  email?: string;
  dietaryRequirements?: string | null;
  rsvpStatus?: RsvpStatus;
  respondedAt?: Date | null;
}

export const guestRepository = {
  list(weddingId: string, filter: { search?: string; rsvpStatus?: RsvpStatus }): Promise<GuestRow[]> {
    const where: Prisma.GuestWhereInput = { weddingId };
    if (filter.rsvpStatus) where.rsvpStatus = filter.rsvpStatus;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return prisma.guest.findMany({ where, include: withInvitation, orderBy: [{ name: 'asc' }, { createdAt: 'asc' }] });
  },

  async countByStatus(weddingId: string): Promise<Record<RsvpStatus, number>> {
    const rows = await prisma.guest.groupBy({ by: ['rsvpStatus'], where: { weddingId }, _count: { _all: true } });
    const out: Record<RsvpStatus, number> = { PENDING: 0, ACCEPTED: 0, DECLINED: 0 };
    for (const r of rows) out[r.rsvpStatus] = r._count._all;
    return out;
  },

  find(weddingId: string, guestId: string, db: Db = prisma): Promise<GuestRow | null> {
    return db.guest.findFirst({ where: { id: guestId, weddingId }, include: withInvitation });
  },

  create(weddingId: string, data: GuestCreate, db: Db = prisma): Promise<GuestRow> {
    return db.guest.create({ data: { weddingId, ...data }, include: withInvitation });
  },

  /** Scoped by weddingId; null when the guest is not in this wedding. */
  async update(weddingId: string, guestId: string, data: GuestUpdate, db: Db = prisma): Promise<GuestRow | null> {
    const r = await db.guest.updateMany({ where: { id: guestId, weddingId }, data });
    if (r.count === 0) return null;
    return guestRepository.find(weddingId, guestId, db);
  },

  /** The invitation row cascades. False when nothing was deleted. */
  async delete(weddingId: string, guestId: string, db: Db = prisma): Promise<boolean> {
    const r = await db.guest.deleteMany({ where: { id: guestId, weddingId } });
    return r.count > 0;
  },
};

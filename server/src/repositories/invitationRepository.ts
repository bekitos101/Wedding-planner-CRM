import type { DeliveryStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface InvitationWedding {
  coupleNames: string;
  weddingDate: Date;
  location: string;
  rsvpDeadline: Date;
}

const rsvpInclude = {
  guest: {
    select: {
      id: true,
      name: true,
      rsvpStatus: true,
      dietaryRequirements: true,
      wedding: {
        select: { coupleNames: true, weddingDate: true, location: true, rsvpDeadline: true, status: true },
      },
    },
  },
} satisfies Prisma.InvitationInclude;

export type InvitationWithContext = Prisma.InvitationGetPayload<{ include: typeof rsvpInclude }>;

export const invitationRepository = {
  findWedding(weddingId: string): Promise<InvitationWedding | null> {
    return prisma.wedding.findUnique({
      where: { id: weddingId },
      select: { coupleNames: true, weddingDate: true, location: true, rsvpDeadline: true },
    });
  },

  /** One invitation per guest (BR-05): create it or rotate its token, resetting the delivery state. */
  async upsertForSend(guestId: string, tokenHash: string): Promise<void> {
    const fresh = { tokenHash, deliveryStatus: 'PENDING' as const, attemptCount: 1, lastError: null, revokedAt: null };
    await prisma.invitation.upsert({
      where: { guestId },
      create: { guestId, ...fresh },
      update: fresh,
    });
  },

  /** Records the outcome only if this token is still the current one (a concurrent resend wins). */
  async recordDelivery(
    guestId: string,
    tokenHash: string,
    result: { deliveryStatus: DeliveryStatus; lastError: string | null; lastSentAt: Date | null },
  ): Promise<void> {
    await prisma.invitation.updateMany({
      where: { guestId, tokenHash },
      data: {
        deliveryStatus: result.deliveryStatus,
        lastError: result.lastError,
        ...(result.lastSentAt ? { lastSentAt: result.lastSentAt } : {}),
      },
    });
  },

  /** Sets revokedAt once (keeps the first revocation time). False when the guest has no invitation. */
  async revoke(guestId: string, now: Date): Promise<boolean> {
    const inv = await prisma.invitation.findUnique({ where: { guestId }, select: { revokedAt: true } });
    if (!inv) return false;
    if (!inv.revokedAt) await prisma.invitation.updateMany({ where: { guestId, revokedAt: null }, data: { revokedAt: now } });
    return true;
  },

  findByTokenHash(tokenHash: string): Promise<InvitationWithContext | null> {
    return prisma.invitation.findUnique({ where: { tokenHash }, include: rsvpInclude });
  },

  /**
   * Stores the guest's answer ONLY while this exact token is still current and unrevoked, the
   * wedding is active and the deadline (>= `today`) is open: one atomic conditional write, so a
   * concurrent revoke / resend / delete / archive cannot be overtaken. False = nothing written.
   */
  async saveResponse(
    guestId: string,
    tokenHash: string,
    today: Date,
    data: { rsvpStatus: 'ACCEPTED' | 'DECLINED'; respondedAt: Date; dietaryRequirements?: string | null },
  ): Promise<boolean> {
    const r = await prisma.guest.updateMany({
      where: {
        id: guestId,
        invitation: { is: { tokenHash, revokedAt: null } },
        wedding: { status: 'ACTIVE', rsvpDeadline: { gte: today } },
      },
      data: {
        rsvpStatus: data.rsvpStatus,
        respondedAt: data.respondedAt,
        ...(data.dietaryRequirements !== undefined ? { dietaryRequirements: data.dietaryRequirements } : {}),
      },
    });
    return r.count > 0;
  },
};

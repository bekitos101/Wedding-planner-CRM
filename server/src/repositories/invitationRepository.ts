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

const retryInclude = {
  guest: {
    select: {
      name: true,
      email: true,
      wedding: { select: { coupleNames: true, weddingDate: true, location: true, rsvpDeadline: true } },
    },
  },
} satisfies Prisma.InvitationInclude;

export type RetryCandidate = Prisma.InvitationGetPayload<{ include: typeof retryInclude }>;

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

  /**
   * FAILED invitations the retry job may try again (FR-64, BR-11): below the attempt limit, not
   * revoked, guest still exists (FK), wedding ACTIVE and the RSVP still open on `today`.
   */
  listRetryCandidates(today: Date, maxAttempts: number, excludeIds: string[], limit: number): Promise<RetryCandidate[]> {
    return prisma.invitation.findMany({
      where: {
        deliveryStatus: 'FAILED',
        attemptCount: { lt: maxAttempts },
        revokedAt: null,
        id: { notIn: excludeIds },
        guest: { wedding: { status: 'ACTIVE', rsvpDeadline: { gte: today } } },
      },
      include: retryInclude,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  },

  /**
   * Claims a retry with one compare-and-set write: rotates the token and increments attemptCount,
   * but only while the invitation is still FAILED, unrevoked, with the attempt count AND token hash we saw
   * (a manual resend in between changes the token, so the retry backs off). Of two
   * concurrent runs (or a run and a manual resend) exactly one wins. False = lost the race.
   */
  async rotateForRetry(id: string, seenAttempts: number, seenTokenHash: string, tokenHash: string): Promise<boolean> {
    const r = await prisma.invitation.updateMany({
      where: { id, deliveryStatus: 'FAILED', attemptCount: seenAttempts, tokenHash: seenTokenHash, revokedAt: null },
      data: { tokenHash, attemptCount: seenAttempts + 1 },
    });
    return r.count > 0;
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

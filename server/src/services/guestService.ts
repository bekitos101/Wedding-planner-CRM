import type { RsvpStatus } from '@prisma/client';
import { notFound } from '../lib/errors.js';
import { guestRepository, type GuestCreate, type GuestRow, type GuestUpdate } from '../repositories/guestRepository.js';

export interface GuestDto {
  id: string;
  name: string;
  email: string;
  rsvpStatus: RsvpStatus;
  dietaryRequirements: string | null;
  respondedAt: string | null;
  createdAt: string;
  invitation: {
    status: 'SENT' | 'FAILED' | 'PENDING' | 'REVOKED';
    deliveryStatus: 'SENT' | 'FAILED' | 'PENDING';
    attemptCount: number;
    lastSentAt: string | null;
    lastError: string | null;
    revokedAt: string | null;
  } | null;
}

export interface GuestSummary {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
}

/** One rule for the invitation state (guest list, dashboard, guest report): REVOKED wins over the delivery status. */
export function invitationStatusOf(inv: { revokedAt: Date | null; deliveryStatus: 'SENT' | 'FAILED' | 'PENDING' }): 'SENT' | 'FAILED' | 'PENDING' | 'REVOKED' {
  return inv.revokedAt ? 'REVOKED' : inv.deliveryStatus;
}

export function toGuestDto(g: GuestRow): GuestDto {
  const inv = g.invitation;
  return {
    id: g.id,
    name: g.name,
    email: g.email,
    rsvpStatus: g.rsvpStatus,
    dietaryRequirements: g.dietaryRequirements,
    respondedAt: g.respondedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    invitation: inv
      ? {
          status: invitationStatusOf(inv),
          deliveryStatus: inv.deliveryStatus,
          attemptCount: inv.attemptCount,
          lastSentAt: inv.lastSentAt?.toISOString() ?? null,
          lastError: inv.lastError,
          revokedAt: inv.revokedAt?.toISOString() ?? null,
        }
      : null,
  };
}

const guestNotFound = () => notFound('Guest not found.');

export interface GuestPatch {
  name?: string;
  email?: string;
  dietaryRequirements?: string | null;
  rsvpStatus?: RsvpStatus;
}

export const guestService = {
  /** Summary counts cover the whole wedding and are computed on every read (FR-28, FR-59). */
  async list(weddingId: string, filter: { search?: string; rsvpStatus?: RsvpStatus }) {
    const [rows, counts] = await Promise.all([guestRepository.list(weddingId, filter), guestRepository.countByStatus(weddingId)]);
    const summary: GuestSummary = {
      total: counts.PENDING + counts.ACCEPTED + counts.DECLINED,
      pending: counts.PENDING,
      accepted: counts.ACCEPTED,
      declined: counts.DECLINED,
    };
    return { guests: rows.map(toGuestDto), summary };
  },

  async create(weddingId: string, input: GuestCreate): Promise<GuestDto> {
    return toGuestDto(await guestRepository.create(weddingId, input));
  },

  async update(weddingId: string, guestId: string, patch: GuestPatch): Promise<GuestDto> {
    const existing = await guestRepository.find(weddingId, guestId);
    if (!existing) throw guestNotFound();
    const data: GuestUpdate = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.email !== undefined) data.email = patch.email;
    if (patch.dietaryRequirements !== undefined) data.dietaryRequirements = patch.dietaryRequirements;
    if (patch.rsvpStatus !== undefined) {
      data.rsvpStatus = patch.rsvpStatus;
      if (patch.rsvpStatus === 'PENDING') data.respondedAt = null;
      else if (patch.rsvpStatus !== existing.rsvpStatus || !existing.respondedAt) data.respondedAt = new Date();
    }
    const updated = await guestRepository.update(weddingId, guestId, data);
    if (!updated) throw guestNotFound();
    return toGuestDto(updated);
  },

  async remove(weddingId: string, guestId: string): Promise<void> {
    if (!(await guestRepository.delete(weddingId, guestId))) throw guestNotFound();
  },

  /** Used by the invitation service: the guest as the planner sees it, or 404. */
  async get(weddingId: string, guestId: string): Promise<GuestRow> {
    const g = await guestRepository.find(weddingId, guestId);
    if (!g) throw guestNotFound();
    return g;
  },
};

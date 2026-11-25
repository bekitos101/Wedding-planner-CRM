import type { WeddingStatus } from '@prisma/client';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { weddingRepository, type WeddingFields, type WeddingWithOwner } from '../repositories/weddingRepository.js';
import { toProgress, toWeddingDto, type WeddingDto, type WeddingRole } from './weddingDto.js';

export interface WeddingAccess {
  wedding: { id: string; ownerId: string; status: WeddingStatus };
  role: WeddingRole;
}

export const ARCHIVED_MESSAGE = "This wedding is archived and can't be changed.";

function assertDateOrder(weddingDate: Date, rsvpDeadline: Date): void {
  if (rsvpDeadline.getTime() > weddingDate.getTime()) {
    throw validationError('The RSVP deadline must be on or before the wedding date.', {
      rsvpDeadline: 'Must be on or before the wedding date',
    });
  }
}

const roleFor = (w: { ownerId: string }, userId: string): WeddingRole => (w.ownerId === userId ? 'OWNER' : 'TEAM_MEMBER');

async function present(w: WeddingWithOwner, userId: string): Promise<WeddingDto> {
  const counts = await weddingRepository.taskCounts([w.id]);
  return toWeddingDto(w, roleFor(w, userId), toProgress(counts.get(w.id)));
}

export const weddingService = {
  /**
   * Authorization core (BR-14, FR-11): owner or ACTIVE member, otherwise null.
   * Callers must answer null with the same 404 whether the wedding exists or not.
   */
  async resolveAccess(weddingId: string, userId: string): Promise<WeddingAccess | null> {
    const row = await weddingRepository.findAccess(weddingId, userId);
    if (!row) return null;
    const wedding = { id: row.id, ownerId: row.ownerId, status: row.status };
    if (row.ownerId === userId) return { wedding, role: 'OWNER' };
    if (row.hasActiveMembership) return { wedding, role: 'TEAM_MEMBER' };
    return null;
  },

  async create(ownerId: string, input: WeddingFields): Promise<WeddingDto> {
    assertDateOrder(input.weddingDate, input.rsvpDeadline);
    const w = await weddingRepository.create(ownerId, input);
    return present(w, ownerId);
  },

  async get(weddingId: string, userId: string): Promise<WeddingDto> {
    const w = await weddingRepository.findById(weddingId);
    if (!w) throw notFound('Wedding not found.');
    return present(w, userId);
  },

  async list(userId: string, status: WeddingStatus): Promise<WeddingDto[]> {
    const weddings = await weddingRepository.listForUser(userId, status);
    const counts = await weddingRepository.taskCounts(weddings.map((w) => w.id));
    return weddings.map((w) => toWeddingDto(w, roleFor(w, userId), toProgress(counts.get(w.id))));
  },

  /** Owner-only (enforced by the route middleware). The date rule uses the merged values. */
  async update(weddingId: string, userId: string, patch: Partial<WeddingFields>): Promise<WeddingDto> {
    const existing = await weddingRepository.findById(weddingId);
    if (!existing) throw notFound('Wedding not found.');
    assertDateOrder(patch.weddingDate ?? existing.weddingDate, patch.rsvpDeadline ?? existing.rsvpDeadline);
    if (Object.keys(patch).length === 0) return present(existing, userId);
    // Conditional write: if the wedding was archived in the meantime, nothing is changed.
    if (!(await weddingRepository.updateIfActive(weddingId, patch))) throw conflict(ARCHIVED_MESSAGE);
    const w = await weddingRepository.findById(weddingId);
    if (!w) throw notFound('Wedding not found.');
    return present(w, userId);
  },

  /** Idempotent: archiving an archived wedding returns it unchanged (200). */
  async archive(weddingId: string, userId: string): Promise<WeddingDto> {
    // TODO(phase 5): cancel PENDING notifications on archive (BR-13, FR-62)
    const existing = await weddingRepository.findById(weddingId);
    if (!existing) throw notFound('Wedding not found.');
    if (existing.status === 'ACTIVE') {
      await weddingRepository.archiveIfActive(weddingId, new Date()); // false = a concurrent archive won: fine
    }
    const w = await weddingRepository.findById(weddingId);
    if (!w) throw notFound('Wedding not found.');
    return present(w, userId);
  },
};

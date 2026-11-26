import { conflict, notFound, validationError } from '../lib/errors.js';
import { memberRepository, type MemberWithUser } from '../repositories/memberRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { reminderService } from './reminderService.js';

const ALREADY_MEMBER = 'This person is already a team member.';

export function toMemberDto(m: MemberWithUser) {
  return {
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    status: m.status,
    addedAt: m.createdAt.toISOString(),
    revokedAt: m.revokedAt ? m.revokedAt.toISOString() : null,
  };
}
export type MemberDto = ReturnType<typeof toMemberDto>;

export const memberService = {
  /** Active first, then by name. */
  async list(weddingId: string): Promise<MemberDto[]> {
    const rows = await memberRepository.listByWedding(weddingId);
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
      return a.user.name.localeCompare(b.user.name) || a.userId.localeCompare(b.userId);
    });
    return rows.map(toMemberDto);
  },

  async add(wedding: { id: string; ownerId: string }, rawEmail: string): Promise<{ member: MemberDto; created: boolean }> {
    const user = await userRepository.findByEmail(rawEmail.trim().toLowerCase());
    if (!user) {
      throw validationError('No registered planner with this email.', { email: 'No registered planner with this email.' });
    }
    // BR-01: the owner is never stored as a member row.
    if (user.id === wedding.ownerId) {
      throw validationError('You already own this wedding.', { email: 'You already own this wedding.' });
    }
    const existing = await memberRepository.find(wedding.id, user.id);
    if (existing?.status === 'ACTIVE') throw conflict(ALREADY_MEMBER);
    // BR-02: a revoked member is re-activated (same row), never duplicated.
    if (existing) return { member: toMemberDto(await memberRepository.reactivate(wedding.id, user.id)), created: false };
    try {
      return { member: toMemberDto(await memberRepository.create(wedding.id, user.id)), created: true };
    } catch (err) {
      // Lost a race with a concurrent add (unique weddingId+userId): same friendly 409, no column names.
      if ((err as { code?: string } | null)?.code === 'P2002') throw conflict(ALREADY_MEMBER);
      throw err;
    }
  },

  async revoke(weddingId: string, userId: string): Promise<void> {
    // The member's tasks become unassigned, so their reminders move to the owner (same transaction).
    const done = await memberRepository.revokeAndCleanUp(weddingId, userId, new Date(), async (reminders, taskIds) => {
      for (const id of taskIds) await reminderService.syncTask(reminders, id);
    });
    if (!done) throw notFound('Team member not found.');
  },
};

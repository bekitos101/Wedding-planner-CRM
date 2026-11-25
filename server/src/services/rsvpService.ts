import { isRsvpOpen, todayUtc } from '../lib/dates.js';
import { notFound, rsvpClosed } from '../lib/errors.js';
import { formatDateOnly } from '../lib/schemas.js';
import { hashToken, looksLikeToken } from '../lib/tokens.js';
import { invitationRepository, type InvitationWithContext } from '../repositories/invitationRepository.js';

/** Public view (NFR-08, FR-30): only this guest's own data, no ids. */
export interface RsvpView {
  guestName: string;
  coupleNames: string;
  weddingDate: string | null;
  location: string;
  rsvpDeadline: string | null;
  rsvpStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  dietaryRequirements: string | null;
}

function toView(inv: InvitationWithContext): RsvpView {
  const { guest } = inv;
  return {
    guestName: guest.name,
    coupleNames: guest.wedding.coupleNames,
    weddingDate: formatDateOnly(guest.wedding.weddingDate),
    location: guest.wedding.location,
    rsvpDeadline: formatDateOnly(guest.wedding.rsvpDeadline),
    rsvpStatus: guest.rsvpStatus,
    dietaryRequirements: guest.dietaryRequirements,
  };
}

/** 404 invalid, 410 revoked / archived / past the deadline (BR-06, AC-07). Messages never echo the token. */
async function resolve(token: string): Promise<InvitationWithContext> {
  if (!looksLikeToken(token)) throw notFound('This invitation link is not valid.');
  const inv = await invitationRepository.findByTokenHash(hashToken(token));
  if (!inv) throw notFound('This invitation link is not valid.');
  if (inv.revokedAt || inv.guest.wedding.status === 'ARCHIVED') throw rsvpClosed('This invitation is no longer valid.');
  if (!isRsvpOpen(inv.guest.wedding.rsvpDeadline)) throw rsvpClosed('The RSVP deadline has passed.');
  return inv;
}

export const rsvpService = {
  async view(token: string): Promise<RsvpView> {
    return toView(await resolve(token));
  },

  async respond(
    token: string,
    answer: { rsvpStatus: 'ACCEPTED' | 'DECLINED'; dietaryRequirements?: string | null },
  ): Promise<RsvpView> {
    const inv = await resolve(token);
    const now = new Date();
    const ok = await invitationRepository.saveResponse(inv.guest.id, hashToken(token), todayUtc(now), {
      ...answer,
      respondedAt: now,
    });
    if (!ok) {
      // Lost a race (revoke / resend / delete / archive / deadline): re-evaluate for the right 404 or 410.
      await resolve(token);
      throw notFound('This invitation link is not valid.');
    }
    return toView(await resolve(token));
  },
};

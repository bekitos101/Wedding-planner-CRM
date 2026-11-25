import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { isRsvpOpen } from '../lib/dates.js';
import { conflict, notFound } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { formatDateOnly } from '../lib/schemas.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { guestRepository } from '../repositories/guestRepository.js';
import { invitationRepository, type InvitationWedding } from '../repositories/invitationRepository.js';
import { guestService, toGuestDto, type GuestDto } from './guestService.js';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Single line (names go into a greeting and the subject, never allowed to break headers). */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ');

export function buildInvitationEmail(guestName: string, w: InvitationWedding, link: string) {
  const date = formatDateOnly(w.weddingDate) ?? '';
  const deadline = formatDateOnly(w.rsvpDeadline) ?? '';
  const name = oneLine(guestName);
  const text = [
    `Dear ${name},`,
    '',
    `You are invited to the wedding of ${w.coupleNames}.`,
    `Date: ${date}`,
    `Location: ${w.location}`,
    '',
    `Please let us know whether you can come by ${deadline}:`,
    link,
    '',
    'You can change your answer through the same link until that date.',
  ].join('\n');
  const html = [
    `<p>Dear ${escapeHtml(name)},</p>`,
    `<p>You are invited to the wedding of <strong>${escapeHtml(w.coupleNames)}</strong>.</p>`,
    `<p>Date: ${escapeHtml(date)}<br>Location: ${escapeHtml(w.location)}</p>`,
    `<p>Please let us know whether you can come by ${escapeHtml(deadline)}:</p>`,
    `<p><a href="${escapeHtml(link)}">Respond to this invitation</a></p>`,
    '<p>You can change your answer through the same link until that date.</p>',
  ].join('\n');
  return { text, html };
}

/** Planner-facing reason (NFR-10). The raw transport error stays in the server log only. */
export function friendlyMailError(raw: string): string {
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ESOCKET|EHOSTUNREACH|ENETUNREACH/i.test(raw)) return 'The email server could not be reached.';
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out/i.test(raw)) return 'The email server did not respond in time.';
  if (/EAUTH|auth|535|534|credentials/i.test(raw)) return 'The email server rejected our login.';
  if (/EENVELOPE|recipient|mailbox|550|553|invalid address/i.test(raw)) return 'The recipient address was refused.';
  return 'The email could not be delivered.';
}

const isGuestGone = (err: unknown): boolean =>
  !!err && typeof err === 'object' && ['P2003', 'P2025'].includes(String((err as { code?: unknown }).code));

export const invitationService = {
  /**
   * Create or rotate the guest's single invitation (BR-05), then email the link.
   * A mail failure is recorded as FAILED and still returns the guest (NFR-17, BR-11).
   */
  async send(weddingId: string, guestId: string, log: Logger): Promise<GuestDto> {
    const guest = await guestService.get(weddingId, guestId);
    const wedding = await invitationRepository.findWedding(weddingId);
    if (!wedding) throw notFound('Wedding not found.');
    if (!isRsvpOpen(wedding.rsvpDeadline)) throw conflict('The RSVP deadline for this wedding has passed.');

    const token = generateToken();
    const tokenHash = hashToken(token);
    try {
      await invitationRepository.upsertForSend(guest.id, tokenHash);
    } catch (err) {
      // The guest was deleted between the lookup and the write.
      if (isGuestGone(err)) throw notFound('Guest not found.');
      throw err;
    }

    const link = `${env.APP_BASE_URL.replace(/\/+$/, '')}/rsvp/${token}`;
    const { text, html } = buildInvitationEmail(guest.name, wedding, link);
    const result = await sendMail({ to: guest.email, subject: `You're invited: ${oneLine(wedding.coupleNames)}`, text, html }, log);
    await invitationRepository.recordDelivery(
      guest.id,
      tokenHash,
      result.ok
        ? { deliveryStatus: 'SENT', lastError: null, lastSentAt: new Date() }
        : { deliveryStatus: 'FAILED', lastError: friendlyMailError(result.error), lastSentAt: null },
    );
    const updated = await guestRepository.find(weddingId, guestId);
    if (!updated) throw notFound('Guest not found.');
    return toGuestDto(updated);
  },

  async revoke(weddingId: string, guestId: string): Promise<GuestDto> {
    const guest = await guestService.get(weddingId, guestId);
    if (!(await invitationRepository.revoke(guest.id, new Date()))) throw notFound('Invitation not found.');
    return toGuestDto(await guestService.get(weddingId, guestId));
  },
};

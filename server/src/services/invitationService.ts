import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { isRsvpOpen, todayUtc } from '../lib/dates.js';
import { conflict, notFound } from '../lib/errors.js';
import { escapeHtml, oneLine } from '../lib/html.js';
import { sendMail } from '../lib/mailer.js';
import { MAX_EMAIL_ATTEMPTS } from '../lib/mailPolicy.js';
import { formatDateOnly } from '../lib/schemas.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { guestRepository } from '../repositories/guestRepository.js';
import { invitationRepository, type InvitationWedding, type RetryCandidate } from '../repositories/invitationRepository.js';
import { guestService, toGuestDto, type GuestDto } from './guestService.js';

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

  /**
   * Retry job (FR-64, BR-11): candidates are FAILED invitations below the attempt limit that are
   * unrevoked, with an open RSVP on an active wedding. Each retry rotates the token (the old link
   * was never delivered) and counts as one more attempt, then records SENT / FAILED. Never throws
   * for a mail problem (NFR-17). 'skipped' = another run or a manual resend got there first.
   */
  async retryDelivery(c: RetryCandidate, now: Date, log: Logger): Promise<'sent' | 'failed' | 'skipped'> {
    if (!isRsvpOpen(c.guest.wedding.rsvpDeadline, now)) return 'skipped';
    const token = generateToken();
    const tokenHash = hashToken(token);
    if (!(await invitationRepository.rotateForRetry(c.id, c.attemptCount, c.tokenHash, tokenHash))) return 'skipped';

    const link = `${env.APP_BASE_URL.replace(/\/+$/, '')}/rsvp/${token}`;
    const { text, html } = buildInvitationEmail(c.guest.name, c.guest.wedding, link);
    const result = await sendMail(
      { to: c.guest.email, subject: `You're invited: ${oneLine(c.guest.wedding.coupleNames)}`, text, html },
      log,
    );
    await invitationRepository.recordDelivery(
      c.guestId,
      tokenHash,
      result.ok
        ? { deliveryStatus: 'SENT', lastError: null, lastSentAt: now }
        : { deliveryStatus: 'FAILED', lastError: friendlyMailError(result.error), lastSentAt: null },
    );
    return result.ok ? 'sent' : 'failed';
  },

  /** Candidates for the retry job on the UTC day of `now`. */
  listRetryCandidates(now: Date, excludeIds: string[], limit: number): Promise<RetryCandidate[]> {
    return invitationRepository.listRetryCandidates(todayUtc(now), MAX_EMAIL_ATTEMPTS, excludeIds, limit);
  },

  async revoke(weddingId: string, guestId: string): Promise<GuestDto> {
    const guest = await guestService.get(weddingId, guestId);
    if (!(await invitationRepository.revoke(guest.id, new Date()))) throw notFound('Invitation not found.');
    return toGuestDto(await guestService.get(weddingId, guestId));
  },
};

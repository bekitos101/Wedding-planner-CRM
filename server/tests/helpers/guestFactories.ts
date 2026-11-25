import { prisma } from '../../src/lib/prisma.js';
import { createWedding } from './factories.js';

/** A wedding whose RSVP deadline is yesterday (UTC) -> invitations are expired. */
export async function createWeddingWithPastDeadline(ownerId: string) {
  const w = await createWedding(ownerId);
  const yesterday = new Date(Date.now() - 2 * 86400000);
  yesterday.setUTCHours(0, 0, 0, 0);
  return prisma.wedding.update({ where: { id: w.id }, data: { rsvpDeadline: yesterday } });
}

/** Pulls the RSVP token out of a captured email body (link is APP_BASE_URL/rsvp/<token>). */
export function tokenFromMail(text: string): string {
  const m = /\/rsvp\/([A-Za-z0-9_-]+)/.exec(text);
  if (!m) throw new Error('no RSVP link in mail');
  return m[1]!;
}

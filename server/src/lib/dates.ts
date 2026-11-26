// Calendar-date helpers (no time, no timezone). Wedding dates live in `@db.Date` columns and are
// exchanged as "YYYY-MM-DD"; everything here works in UTC so results never depend on the server's zone.

export const MIN_DATE = '2000-01-01';
export const MAX_DATE = '2100-12-31';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict "YYYY-MM-DD" -> Date at UTC midnight. Null for anything else, impossible dates or out of range. */
export function parseDateOnly(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (s < MIN_DATE || s > MAX_DATE) return null;
  return date;
}

/** Date -> "YYYY-MM-DD" (UTC). */
export const toDateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** The UTC calendar day of `now`, as a Date at UTC midnight. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * RSVPs are open through the WHOLE deadline day: closed only once the current UTC date
 * is after the deadline date (CLAUDE.md, API.md "RSVP deadline").
 */
export function isRsvpOpen(deadline: Date, now: Date = new Date()): boolean {
  return todayUtc(now).getTime() <= todayUtc(deadline).getTime();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date -> "19 Jun 2027" (UTC calendar day), the human form used in emails and notifications. */
export const formatHumanDate = (d: Date): string => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Whole days from `from` to `to` (both UTC-midnight dates); negative when `to` is earlier. */
export const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / 86_400_000);
